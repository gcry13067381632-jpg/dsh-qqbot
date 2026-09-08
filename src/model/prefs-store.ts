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
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { ModelRoute } from './types.js';

/** 日志回调（可选） */
type DebugFn = (msg: string) => void;

/** 会话创建时的配置指纹(2026-09-08, 响应上游 issue #43: cwd/preset 改了要能换新会话) */
export interface SessionCfgFingerprint {
  cwd?: string;
  preset?: string;
}

/** 隔离偏好文件结构 */
interface PrefsFile {
  overrides: Record<string, ModelRoute>;
  /** sessionKey → 最新 sessionId（fork 后更新，用于重启后恢复到 fork 后的会话） */
  sessionIds: Record<string, string>;
  /** sessionKey → 该会话创建时的 cwd/preset 指纹(判断配置变更, 变了就不 resume 旧会话) */
  sessionCfg?: Record<string, SessionCfgFingerprint>;
}

export class PrefsStore {
  /** per-peer 模型偏好（内存态） */
  private overrides = new Map<string, ModelRoute>();
  /** per-peer 最新 sessionId（fork 后更新，内存态） */
  private sessionIds = new Map<string, string>();
  /** per-peer 会话配置指纹（内存态） */
  private sessionCfg = new Map<string, SessionCfgFingerprint>();
  /** 隔离偏好文件路径 */
  private readonly prefsPath: string;
  private readonly debugLog?: DebugFn;

  constructor(debugLog?: DebugFn) {
    this.prefsPath = resolve(homedir(), '.dsh-qqbot', 'model-prefs.json');
    this.debugLog = debugLog;
    this.load();
  }

  // ── Override 操作 ──

  getOverride(sessionKey: string): ModelRoute | undefined {
    return this.overrides.get(sessionKey);
  }

  setOverride(sessionKey: string, route: ModelRoute): void {
    this.overrides.set(sessionKey, route);
    this.write();
  }

  clearOverride(sessionKey: string): boolean {
    const deleted = this.overrides.delete(sessionKey);
    if (deleted) this.write();
    return deleted;
  }

  hasOverride(sessionKey: string): boolean {
    return this.overrides.has(sessionKey);
  }

  // ── SessionId 操作 ──

  getSessionId(sessionKey: string): string | undefined {
    return this.sessionIds.get(sessionKey);
  }

  setSessionId(sessionKey: string, sessionId: string): void {
    this.sessionIds.set(sessionKey, sessionId);
    this.write();
  }

  clearSessionId(sessionKey: string): boolean {
    const deleted = this.sessionIds.delete(sessionKey);
    if (deleted) this.write();
    return deleted;
  }

  // ── 会话配置指纹操作 ──

  getSessionCfg(sessionKey: string): SessionCfgFingerprint | undefined {
    return this.sessionCfg.get(sessionKey);
  }

  setSessionCfg(sessionKey: string, cfg: SessionCfgFingerprint): void {
    this.sessionCfg.set(sessionKey, cfg);
    this.write();
  }

  /** 清 sessionId 时连带清指纹(重置会话 = 抛弃旧配置记录) */
  clearSessionCfg(sessionKey: string): boolean {
    const deleted = this.sessionCfg.delete(sessionKey);
    if (deleted) this.write();
    return deleted;
  }

  // ── 私有方法 ──

  private load(): void {
    try {
      if (!existsSync(this.prefsPath)) return;
      const content = readFileSync(this.prefsPath, 'utf8');
      const data = JSON.parse(content) as PrefsFile;
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
    } catch (err) {
      // 2026-09-06 (PR #41): 解析失败不静默 —— 损坏文件改名 .corrupt-<ts> 保留取证, 空偏好继续。
      // 旧行为只在 debug 时打一行日志然后以空偏好继续, 坏文件会被下次 write 覆盖, 无法事后排查。
      this.debugLog?.(`loadPrefs failed: ${err instanceof Error ? err.message : String(err)}`);
      try {
        if (existsSync(this.prefsPath)) {
          const quarantine = `${this.prefsPath}.corrupt-${Date.now()}`;
          renameSync(this.prefsPath, quarantine);
          this.debugLog?.(`prefs 文件损坏, 已隔离到 ${quarantine} 保留取证`);
        }
      } catch (qErr) {
        this.debugLog?.(`prefs 损坏文件隔离失败: ${qErr instanceof Error ? qErr.message : String(qErr)}`);
      }
    }
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.prefsPath), { recursive: true });
      const data: PrefsFile = {
        overrides: Object.fromEntries(this.overrides.entries()),
        sessionIds: Object.fromEntries(this.sessionIds.entries()),
        ...(this.sessionCfg.size > 0 ? { sessionCfg: Object.fromEntries(this.sessionCfg.entries()) } : {}),
      };
      // 2026-09-06 (PR #41): 原子写入 —— 先写 .tmp 再 renameSync 覆盖(同卷 rename 原子, OS 保证)。
      // 旧行为 writeFileSync 就地全量覆盖, 写盘瞬间进程被 kill → 留下半截 JSON, 下次 load 静默重置。
      const tmpPath = `${this.prefsPath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      try {
        renameSync(tmpPath, this.prefsPath);
      } catch (renameErr) {
        // 极端情况下 rename 失败(如目标被占用): 清掉 tmp 残留, 避免堆积
        try {
          if (existsSync(tmpPath)) renameSync(tmpPath, `${this.prefsPath}.stale-${Date.now()}`);
        } catch { /* ignore */ }
        throw renameErr;
      }
    } catch (err) {
      this.debugLog?.(`writePrefs failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
