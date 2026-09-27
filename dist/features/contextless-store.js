/**
 * contextless-store.ts — 「无上下文模式」的**按会话**开关存储（2026-09-27 主人定）。
 *
 * 需求（主人原话）：
 *   「无上下文模式，开启后自动删除历史对话，在 dock 页面但会话里开启」
 *   —— 在 dock 面板里对**某个会话**开启；开启后该会话**每轮都丢掉历史对话**
 *      （只保留系统规则 + 「@ 之前 N 条群消息」），用来大幅省 token。
 *
 * 与其他配置的区别：
 *   - 全局配置（`config.contextlessMode`）是"所有会话都这样"；
 *   - 本文件是"**只有这个会话**这样"（会话级覆盖，优先级高于全局）。
 *
 * 存储：`{dataRoot}/.qqbot/contextless.json`，结构 `{ "<sessionKey>": { enabled, window } }`。
 *   ⚠️ 只放"开关 + 条数"，不放任何消息内容 —— 群消息内容由既有的 mediaHistoryBuffer 管。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
const DEFAULT_SETTING = { enabled: false, window: 5 };
let storePath = '';
let loaded = false;
const table = new Map();
function ensureDir(p) {
    try {
        mkdirSync(dirname(p), { recursive: true });
    }
    catch { /* ignore */ }
}
/**
 * 兜底：若没人调过 initContextlessStore（例如"桥"那份模块实例与插件侧不是同一个），
 * 就按 DSH_HOME / 家目录推一个路径，**至少要能落盘**（2026-09-27 群聊AI排查发现：
 * storePath 为空时 persist() 直接 return，前端照样收到 ok，造成"开关永远存不上"）。
 */
function ensurePath() {
    if (storePath)
        return;
    try {
        // ⚠️ 这只是"最后兜底"：正常路径应由 bootstrap(插件侧) 或桥的 loadContextlessStore() 显式 init。
        //    兜底路径放在 {DSH_HOME} 下，若真的用到它，说明调用方没 init（两份模块实例的老问题）。
        const home = (process.env.DSH_HOME && process.env.DSH_HOME.trim())
            || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh');
        storePath = join(home, 'qqbot-contextless.json');
    }
    catch { /* ignore */ }
}
/** 绑定 dataRoot（apply 时调一次；之后所有读写都落在这里） */
export function initContextlessStore(dataRoot) {
    const next = join(dataRoot, '.qqbot', 'contextless.json');
    // ⚠️ 2026-09-27 修：多实例共享一个模块级 storePath 时，后 init 的会覆盖前面的
    //   （实测：A 实例读到了 B 实例的目录）。这里改为**记住多个根**，
    //   读的时候把各根合并（同一 key 取先出现的），写的时候写回"该 key 原来所在的根"。
    if (storePath && storePath !== next && !roots.includes(next)) {
        roots.push(next);
    }
    else if (!storePath) {
        roots.push(next);
    }
    storePath = next;
    loaded = false;
    table.clear();
    for (const p of roots)
        loadFrom(p);
}
/** 已知的数据根文件路径（多实例场景下不止一个） */
const roots = [];
/** 每个 key 归属哪个文件（写回时用它，避免把 A 实例的开关写到 B 实例目录） */
const keyOwner = new Map();
/** 从某个文件读入表（已存在的不覆盖，先到的优先） */
function loadFrom(p) {
    try {
        if (!p || !existsSync(p))
            return;
        const raw = JSON.parse(readFileSync(p, 'utf8'));
        if (!raw || typeof raw !== 'object')
            return;
        for (const [key, v] of Object.entries(raw)) {
            if (table.has(key))
                continue;
            const o = v;
            table.set(key, {
                enabled: o?.enabled === true,
                window: Number.isFinite(Number(o?.window)) ? Math.max(0, Math.trunc(Number(o.window))) : DEFAULT_SETTING.window,
            });
            keyOwner.set(key, p); // 记住这个 key 是从哪个文件读来的
        }
    }
    catch { /* 损坏的文件当空表 */ }
}
/** 所有已知文件路径（诊断用） */
export function describeStorePaths() {
    try {
        ensurePath();
        return [storePath, ...roots].filter(Boolean).join(' | ');
    }
    catch {
        return '(err)';
    }
}
function load() {
    if (loaded)
        return;
    loaded = true;
    ensurePath();
    const targets = [storePath, ...roots].filter(Boolean);
    for (const p of targets)
        loadFrom(p);
}
function persist() {
    try {
        ensurePath();
        if (!storePath)
            return;
        // 按"key 归属的文件"分组写回：避免多实例互相覆盖（A 实例的开关写进了 B 实例的目录）
        const byFile = new Map();
        for (const [k, v] of table) {
            const owner = keyOwner.get(k) || storePath;
            const bucket = byFile.get(owner) ?? {};
            bucket[k] = v;
            byFile.set(owner, bucket);
        }
        if (byFile.size === 0)
            byFile.set(storePath, {});
        for (const [file, obj] of byFile) {
            try {
                ensureDir(file);
                writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
            }
            catch { /* 单个文件失败不影响其它 */ }
        }
    }
    catch { /* 写失败不影响运行 */ }
}
/**
 * 落盘追踪（2026-09-27 加，专治"静默失败"）：
 * 这个功能前后踩了 9 个坑，其中 8 个都不报错 —— 全靠反复试探。
 * 现在把「被调用 / 跳过原因 / 结果 / 异常」统统追加到 {dataRoot}/.qqbot/contextless-trace.log，
 * 一出问题先看这个文件，别再猜。
 */
export function traceContextless(line) {
    const stamp = new Date().toISOString();
    const row = stamp + '  ' + line;
    // ① 终端（最可靠：dsh 控制台一定能看到；不影响协议输出，用 stderr）
    try {
        console.error('[contextless-trace] ' + row);
    }
    catch { /* ignore */ }
    // ② + ③ 两个文件路径都试，任何一个成功即可（不再依赖 storePath 是否已绑定）
    const targets = [];
    try {
        const home = (process.env.DSH_HOME && process.env.DSH_HOME.trim())
            || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh');
        targets.push(join(home, 'contextless-trace.log'));
    }
    catch { /* ignore */ }
    try {
        targets.push(join(temporaryDirectory(), 'contextless-trace.log'));
    }
    catch { /* ignore */ }
    if (storePath) {
        try {
            targets.push(join(dirname(storePath), 'contextless-trace.log'));
        }
        catch { /* ignore */ }
    }
    for (const file of targets) {
        try {
            try {
                mkdirSync(dirname(file), { recursive: true });
            }
            catch { /* ignore */ }
            writeFileSync(file, row + '\n', { flag: 'a' });
        }
        catch { /* 单路失败继续下一路 */ }
    }
}
/** 临时目录（os.tmpdir 的极简封装，避免额外 import 名称冲突） */
function temporaryDirectory() {
    try {
        const t = process.env.TEMP || process.env.TMP || '';
        if (t)
            return t;
    }
    catch { /* ignore */ }
    return '.';
}
/** 诊断：当前绑定的文件路径（trace 用） */
export function describeStorePath() {
    try {
        ensurePath();
        return storePath || '(empty)';
    }
    catch {
        return '(err)';
    }
}
/** 读某会话的设置（未设置 → 默认关） */
export function getContextless(sessionKey) {
    ensurePath();
    load();
    return table.get(sessionKey) ?? { ...DEFAULT_SETTING };
}
/** 写某会话的设置（dock 面板调用；只对有值的字段覆盖） */
export function setContextless(sessionKey, patch) {
    ensurePath();
    load();
    const cur = table.get(sessionKey) ?? { ...DEFAULT_SETTING };
    const next = {
        enabled: patch.enabled === undefined ? cur.enabled : patch.enabled === true,
        window: patch.window === undefined
            ? cur.window
            : Math.max(0, Math.trunc(Number(patch.window)) || 0),
    };
    table.set(sessionKey, next);
    if (!keyOwner.has(sessionKey)) {
        try {
            ensurePath();
            if (storePath)
                keyOwner.set(sessionKey, storePath);
        }
        catch { /* ignore */ }
    }
    persist();
    return next;
}
/** 全表（给 dock 面板列出来） */
export function listContextless() {
    load();
    const out = {};
    for (const [k, v] of table)
        out[k] = v;
    return out;
}
/** 删某会话的设置 */
export function clearContextless(sessionKey) {
    load();
    const ok = table.delete(sessionKey);
    if (ok)
        persist();
    return ok;
}
/** 会话是否处于"无上下文模式"（全局开 **或** 该会话单独开） */
export function isContextlessActive(sessionKey, globalEnabled) {
    if (globalEnabled === true)
        return true;
    return getContextless(sessionKey).enabled;
}
/** 该会话应携带的「@ 之前」群消息条数（会话级优先，其次全局默认 5） */
export function contextlessWindowOf(sessionKey, fallback = 5) {
    const s = getContextless(sessionKey);
    if (s.enabled)
        return s.window;
    return Math.max(0, Math.trunc(fallback) || 0);
}
//# sourceMappingURL=contextless-store.js.map