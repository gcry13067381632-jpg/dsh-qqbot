/**
 * PrefsStore — per-peer 模型偏好持久化
 *
 * 隔离文件 I/O 操作，便于单元测试时 mock。
 * 存储路径：~/.dsh-qqbot/model-prefs.json
 *
 * 2026-09-06 移植上游 tencent-connect/dsh-qqbot PR #41:
 *   - 写入改原子(先写 .tmp 再 renameSync 覆盖, 同卷 rename 由 OS 保证原子,
 *     避免写盘瞬间被 kill 留下半截 JSON);
 *   - load 解析失败不再静默吞掉: 损坏文件改名 .corrupt-<ts> 保留取证, 空偏好继续。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
export class PrefsStore {
    /** per-peer 模型偏好（内存态） */
    overrides = new Map();
    /** per-peer 最新 sessionId（fork 后更新，内存态） */
    sessionIds = new Map();
    /** per-peer 会话配置指纹（内存态） */
    sessionCfg = new Map();
    /** per-peer 会话 preset 覆盖（内存态, /new <preset> 用） */
    sessionPresets = new Map();
    /** 隔离偏好文件路径 */
    prefsPath;
    debugLog;
    /**
     * @param debugLog 调试日志回调
     * @param baseDir  存放目录。**强烈建议传 `{dataRoot}/.qqbot`** ——
     *   2026-09-24 修复：此前硬编码 `homedir()/.dsh-qqbot`，导致用户把 dataRoot 指到 D 盘后，
     *   这个偏好文件仍孤零零留在 C 盘用户目录（其他数据都在 dataRoot，就它漏了）。
     *   不传时回落到 `$DSH_HOME/.dsh-qqbot`（再退 `~/.dsh-qqbot`），保持向后兼容。
     */
    constructor(debugLog, baseDir) {
        const root = (baseDir && baseDir.trim())
            || resolve(process.env.DSH_HOME?.trim() || homedir(), '.dsh-qqbot');
        this.prefsPath = resolve(root, 'model-prefs.json');
        this.debugLog = debugLog;
        this.migrateLegacy();
        this.load();
    }
    /** 把老位置(`~/.dsh-qqbot/model-prefs.json`)的偏好**搬到新位置**（新位置没有时才搬，搬完保留原文件改名 .migrated） */
    migrateLegacy() {
        try {
            const legacy = resolve(homedir(), '.dsh-qqbot', 'model-prefs.json');
            if (legacy === this.prefsPath)
                return; // 目标就是老位置 → 不用搬
            if (!existsSync(legacy) || existsSync(this.prefsPath))
                return;
            mkdirSync(dirname(this.prefsPath), { recursive: true });
            copyFileSync(legacy, this.prefsPath);
            try {
                renameSync(legacy, legacy + '.migrated');
            }
            catch { /* 改不了名也无妨，反正已经复制 */ }
            this.debugLog?.(`prefs 已从旧位置迁移: ${legacy} → ${this.prefsPath}`);
        }
        catch (err) {
            this.debugLog?.(`prefs 迁移失败(不影响运行): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /** 每个 Map 的条目上限 —— 只增不减会让文件无限膨胀（2026-09-24 主人反馈"越写越长"）。 */
    static MAX_ENTRIES = 300;
    /**
     * 清理**孤儿 override**（2026-09-24 主人反馈"还是越写越多"）。
     *
     * override 的 key 是 `sessionKey@sessionId`，而每次新建会话（/new、cwd/preset 变更、
     * 重启后未 resume）都会产生**新 sessionId** → 新 key；`sessionIds` 只记该 key 的最新会话，
     * 于是旧 sessionId 的 override 永远没人删，一个群能攒出十几条。
     *
     * 判定：key 里的 sessionId ≠ `sessionIds` 记录的最新值 → 该 override 已失效（不可能再被读到）→ 删。
     * 老式 peer 级 key（不含 `@sessionId`）保持不动，避免误删兼容路径。
     */
    pruneOrphanOverrides() {
        for (const key of [...this.overrides.keys()]) {
            const at = key.lastIndexOf('@');
            if (at < 0)
                continue;
            const sessionKey = key.slice(0, at);
            const sid = key.slice(at + 1);
            const latest = this.sessionIds.get(sessionKey);
            if (latest && latest !== sid)
                this.overrides.delete(key);
        }
    }
    /** 超出上限时按插入顺序淘汰最旧（Map 保序；用过的键重新 set 会排到末尾，近似 LRU） */
    prune() {
        this.pruneOrphanOverrides();
        for (const m of [this.overrides, this.sessionIds, this.sessionCfg, this.sessionPresets]) {
            while (m.size > PrefsStore.MAX_ENTRIES) {
                const oldest = m.keys().next().value;
                if (oldest === undefined)
                    break;
                m.delete(oldest);
            }
        }
    }
    // ── Override 操作 ──
    getOverride(sessionKey) {
        return this.overrides.get(sessionKey);
    }
    setOverride(sessionKey, route) {
        this.overrides.set(sessionKey, route);
        this.write();
    }
    clearOverride(sessionKey) {
        const deleted = this.overrides.delete(sessionKey);
        if (deleted)
            this.write();
        return deleted;
    }
    hasOverride(sessionKey) {
        return this.overrides.has(sessionKey);
    }
    // ── SessionId 操作 ──
    getSessionId(sessionKey) {
        return this.sessionIds.get(sessionKey);
    }
    setSessionId(sessionKey, sessionId) {
        this.sessionIds.set(sessionKey, sessionId);
        this.write();
    }
    clearSessionId(sessionKey) {
        const deleted = this.sessionIds.delete(sessionKey);
        if (deleted)
            this.write();
        return deleted;
    }
    // ── 会话配置指纹操作 ──
    getSessionCfg(sessionKey) {
        return this.sessionCfg.get(sessionKey);
    }
    setSessionCfg(sessionKey, cfg) {
        this.sessionCfg.set(sessionKey, cfg);
        this.write();
    }
    /** 清 sessionId 时连带清指纹(重置会话 = 抛弃旧配置记录) */
    clearSessionCfg(sessionKey) {
        const deleted = this.sessionCfg.delete(sessionKey);
        if (deleted)
            this.write();
        return deleted;
    }
    // ── 会话 preset 覆盖操作(/new <preset> 2026-09-08) ──
    getSessionPreset(sessionKey) {
        return this.sessionPresets.get(sessionKey);
    }
    setSessionPreset(sessionKey, preset) {
        this.sessionPresets.set(sessionKey, preset);
        this.write();
    }
    clearSessionPreset(sessionKey) {
        const deleted = this.sessionPresets.delete(sessionKey);
        if (deleted)
            this.write();
        return deleted;
    }
    // ── 私有方法 ──
    load() {
        try {
            if (!existsSync(this.prefsPath))
                return;
            const content = readFileSync(this.prefsPath, 'utf8');
            const data = JSON.parse(content);
            if (data.overrides && typeof data.overrides === 'object') {
                for (const [key, route] of Object.entries(data.overrides)) {
                    if (route.provider && route.model) {
                        this.overrides.set(key, { provider: route.provider, model: route.model });
                    }
                }
            }
            if (data.sessionIds && typeof data.sessionIds === 'object') {
                for (const [key, sessionId] of Object.entries(data.sessionIds)) {
                    if (typeof sessionId === 'string' && sessionId) {
                        this.sessionIds.set(key, sessionId);
                    }
                }
            }
            if (data.sessionCfg && typeof data.sessionCfg === 'object') {
                for (const [key, cfg] of Object.entries(data.sessionCfg)) {
                    if (cfg && typeof cfg === 'object') {
                        this.sessionCfg.set(key, { cwd: cfg.cwd, preset: cfg.preset });
                    }
                }
            }
            if (data.sessionPresets && typeof data.sessionPresets === 'object') {
                for (const [key, preset] of Object.entries(data.sessionPresets)) {
                    if (typeof preset === 'string' && preset)
                        this.sessionPresets.set(key, preset);
                }
            }
        }
        catch (err) {
            // 2026-09-06 (PR #41): 解析失败不静默 —— 损坏文件改名 .corrupt-<ts> 保留取证, 空偏好继续。
            // 旧行为只在 debug 时打一行日志然后以空偏好继续, 坏文件会被下次 write 覆盖, 无法事后排查。
            this.debugLog?.(`loadPrefs failed: ${err instanceof Error ? err.message : String(err)}`);
            try {
                if (existsSync(this.prefsPath)) {
                    const quarantine = `${this.prefsPath}.corrupt-${Date.now()}`;
                    renameSync(this.prefsPath, quarantine);
                    this.debugLog?.(`prefs 文件损坏, 已隔离到 ${quarantine} 保留取证`);
                }
            }
            catch (qErr) {
                this.debugLog?.(`prefs 损坏文件隔离失败: ${qErr instanceof Error ? qErr.message : String(qErr)}`);
            }
        }
    }
    write() {
        try {
            this.prune(); // 防无限膨胀
            mkdirSync(dirname(this.prefsPath), { recursive: true });
            const data = {
                overrides: Object.fromEntries(this.overrides.entries()),
                sessionIds: Object.fromEntries(this.sessionIds.entries()),
                ...(this.sessionCfg.size > 0 ? { sessionCfg: Object.fromEntries(this.sessionCfg.entries()) } : {}),
                ...(this.sessionPresets.size > 0 ? { sessionPresets: Object.fromEntries(this.sessionPresets.entries()) } : {}),
            };
            // 2026-09-06 (PR #41): 原子写入 —— 先写 .tmp 再 renameSync 覆盖(同卷 rename 原子, OS 保证)。
            // 旧行为 writeFileSync 就地全量覆盖, 写盘瞬间进程被 kill → 留下半截 JSON, 下次 load 静默重置。
            const tmpPath = `${this.prefsPath}.tmp`;
            writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
            try {
                renameSync(tmpPath, this.prefsPath);
            }
            catch (renameErr) {
                // 极端情况下 rename 失败(如目标被占用): 清掉 tmp 残留, 避免堆积
                try {
                    if (existsSync(tmpPath))
                        renameSync(tmpPath, `${this.prefsPath}.stale-${Date.now()}`);
                }
                catch { /* ignore */ }
                throw renameErr;
            }
        }
        catch (err) {
            this.debugLog?.(`writePrefs failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
//# sourceMappingURL=prefs-store.js.map