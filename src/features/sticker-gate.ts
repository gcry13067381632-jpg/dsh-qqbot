/**
 * sticker-gate.ts — 表情包主动发送闸门执行器（P1，2026-09-03 新增）
 *
 * 对应《表情包功能_设计v2_分模块定稿.md》模块C「触发信号与闸门(插件侧,出站收口)」。
 * 把 Web 设置里 sticker.gates 那排开关变成真正的"刹车线"：
 *   总开关 enabled / 禁发群 / 活性下限(热闹才发) / 窗口频率 / 每群日预算 /
 *   24h 同图去重 / 路径白名单(仅表情包库内图算 sticker)。
 *
 * 设计要点：
 *  - 配置现读: 单例绑定 live config getter(bindStickerGates), 每次判定现取,
 *    Web 设置热更新即时生效, 无需重启(与 behavior 冷却同款纪律)。
 *  - 判定咽喉: bootstrap 的 sender.sendMedia 一处调 checkMedia —— [MEDIA] 标记
 *    与 send_media 工具两条通道都汇于此, 天然全覆盖。被拒抛 StickerGateDenied:
 *    工具通道转 ok:false 给 LLM(不回执), [MEDIA] 通道记日志且不影响正文。
 *  - perTurnMax(每轮最多张数): "轮"只在整段回复文本(一次 sendRichOutbound)内存在,
 *    由 sendRichOutbound 循环内计数实现; 工具通道单次调用天然=1张不受限。
 *  - 活性计数: 中间件 stickerActivityRecorder 挂在 mentionGate 之前, 未@消息也流经,
 *    每群 RingBuffer<ts> 记群消息; 发送窗口频率用我方放行时间戳 ring(内存)。
 *
 * ⚠️ 本地手改功能（fork 新增）：维护清单见工作区根《插件改动维护注意事项.md》。
 * 运行数据与 sticker-store 共用 dataDir(默认 {agent cwd}/表情包)：
 *   state/used.json(同图去重,重启不丢) state/budget.json(日预算,重启不丢)
 *   log/sendlog.jsonl(发送流水,append-only)
 * 单例必须在启动早期按 config.cwd 解析的 dataDir 预初始化(防 C 盘幽灵库同款坑)。
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { StickerGatesConfig } from '../config.js';
import type { Logger } from '../types.js';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { MediaKind } from '../transport/rich-media.js';

/** 活性 RingBuffer 单群保留上限(超限裁剪, 防群轰炸撑爆内存) */
const ACTIVITY_RING_MAX = 2000;
/** 我方发送窗口 ring 单群上限 */
const SENT_RING_MAX = 500;

/** 未绑定配置时的回落(全部默认=不限制) */
const FALLBACK_GATES: StickerGatesConfig = {
  enabled: false,
  perTurnMax: 0,
  perWindowSec: 600,
  maxPerWindow: 0,
  dailyBudgetPerGroup: 0,
  dupTTLHours: 0,
  activityWindowSec: 3600,
  activityMinMsgs: 0,
  bannedGroups: [],
  libRoots: [],
};

/** 闸门拒绝信号: sender.sendMedia 抛此错; send_media 工具 catch 转 ok:false, [MEDIA] 通道记日志 */
export class StickerGateDenied extends Error {
  constructor(reason: string) {
    super(`[sticker-gate] ${reason}`);
    this.name = 'StickerGateDenied';
  }
}

export function isStickerGateDenied(err: unknown): err is StickerGateDenied {
  return err instanceof StickerGateDenied;
}

/** 单条媒体发送的判定上下文 */
export interface MediaGateCtx {
  /** group openid; 私聊(null/undefined)不闸 */
  groupId?: string;
  kind: MediaKind;
  /** 本地绝对路径(已 resolve); URL 发送不算 sticker, 不闸 */
  localPath?: string;
}

export interface MediaGateVerdict {
  allowed: boolean;
  /** 该发送是否属于"库内表情包图"(即便 allowed, 也用于调用方决定是否记录流水) */
  isSticker: boolean;
  /** 拒绝原因(中文, 给工具回执/日志) */
  reason?: string;
}

/** 判断路径是否位于 root 目录内(Windows 大小写不敏感) */
function isChildOf(p: string, root: string): boolean {
  const pp = resolve(p).toLowerCase();
  const rr = resolve(root).toLowerCase();
  return pp === rr || pp.startsWith(rr.endsWith(sep) ? rr : rr + sep);
}

/** 是否库内表情包路径: roots = [dataDir/lib] + gates.libRoots(追加前缀) */
export function isStickerPath(p: string | undefined, dataDir: string, libRoots?: string[]): boolean {
  if (!p) return false;
  const roots = [join(dataDir, 'lib')];
  for (const r of libRoots ?? []) {
    if (r.trim()) roots.push(r.trim());
  }
  return roots.some((r) => isChildOf(p, r));
}

/** 今日日期键(本地时区 YYYY-MM-DD) */
function todayKey(now = Date.now()): string {
  const d = new Date(now);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 当前 live gates(getter 由 bootstrap 绑定到 config.sticker.gates, 每次现读) */
let _gatesGetter: (() => StickerGatesConfig) | null = null;

export function bindStickerGates(getter: () => StickerGatesConfig): void {
  _gatesGetter = getter;
}

function liveGates(): StickerGatesConfig {
  try {
    return _gatesGetter?.() ?? FALLBACK_GATES;
  } catch {
    return FALLBACK_GATES;
  }
}

/**
 * 闸门状态(跨重启持久: used 去重 / budget 日预算)。
 * 窗口频率 ring / 活性 ring 为内存态(窗口短, 重启重计可接受, 与定稿一致)。
 */
class StickerGate {
  /** 每群活性 RingBuffer: groupId -> 群消息时间戳(ms) */
  private readonly activity = new Map<string, number[]>();
  /** 每群我方发送窗口 ring: groupId -> 放行表情包时间戳(ms) */
  private readonly sentTimes = new Map<string, number[]>();
  /** 同图去重: 本地路径 -> 最近发送 ts(惰性按 dupTTL 清理) */
  private used = new Map<string, number>();
  /** 日预算: groupId -> {YYYY-MM-DD: 张数} */
  private budget = new Map<string, Map<string, number>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  public constructor(
    readonly dataDir: string,
    private readonly logger?: Logger,
  ) {
    mkdirSync(join(dataDir, 'state'), { recursive: true });
    mkdirSync(join(dataDir, 'log'), { recursive: true });
    this.load();
  }

  // ── 落盘 ──
  private usedPath(): string {
    return join(this.dataDir, 'state', 'used.json');
  }
  private budgetPath(): string {
    return join(this.dataDir, 'state', 'budget.json');
  }
  private sendlogPath(): string {
    return join(this.dataDir, 'log', 'sendlog.jsonl');
  }

  private load(): void {
    try {
      const raw = readFileSync(this.usedPath(), 'utf8');
      this.used = new Map(Object.entries(JSON.parse(raw) as Record<string, number>));
    } catch {
      this.used = new Map();
    }
    try {
      const raw = readFileSync(this.budgetPath(), 'utf8');
      const obj = JSON.parse(raw) as Record<string, Record<string, number>>;
      this.budget = new Map(Object.entries(obj).map(([g, days]) => [g, new Map(Object.entries(days))]));
    } catch {
      this.budget = new Map();
    }
  }

  /** 防抖落盘(发送低频, 1s 合并足够); 进程退出兜底走 flush() */
  private save(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 1000);
    this.saveTimer.unref?.();
  }

  /** 立即落盘(退出兜底) */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      writeFileSync(this.usedPath(), JSON.stringify(Object.fromEntries(this.used), null, 1), 'utf8');
    } catch (err) {
      this.logger?.warn?.(`[sticker-gate] used.json 写盘失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const obj: Record<string, Record<string, number>> = {};
      for (const [g, days] of this.budget) obj[g] = Object.fromEntries(days);
      writeFileSync(this.budgetPath(), JSON.stringify(obj, null, 1), 'utf8');
    } catch (err) {
      this.logger?.warn?.(`[sticker-gate] budget.json 写盘失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── 活性(入站群消息计数; 中间件在 mentionGate 之前喂) ──
  recordActivity(groupId: string, ts = Date.now()): void {
    let arr = this.activity.get(groupId);
    if (!arr) {
      arr = [];
      this.activity.set(groupId, arr);
    }
    arr.push(ts);
    // 裁剪: 只留最近 2h 的, 超上限截尾(防群轰炸撑爆)
    const cutoff = ts - 2 * 3600 * 1000;
    let i = 0;
    while (i < arr.length && (arr[i] ?? 0) < cutoff) i += 1;
    if (i > 0) arr.splice(0, i);
    if (arr.length > ACTIVITY_RING_MAX) arr.splice(0, arr.length - ACTIVITY_RING_MAX);
  }

  /** 近 windowSec 秒内的群消息条数 */
  countActivity(groupId: string, windowSec: number): number {
    const arr = this.activity.get(groupId);
    if (!arr?.length) return 0;
    const cutoff = Date.now() - windowSec * 1000;
    let n = 0;
    for (const ts of arr) if (ts >= cutoff) n += 1;
    return n;
  }

  // ── 我方发送窗口频率(内存) ──
  private countSentInWindow(groupId: string, windowSec: number): number {
    const arr = this.sentTimes.get(groupId);
    if (!arr?.length) return 0;
    const cutoff = Date.now() - windowSec * 1000;
    return arr.filter((ts) => ts >= cutoff).length;
  }

  /**
   * 单张媒体发送判定(配置现读)。规则顺序:
   *   非库内 image(URL/非库路径/非图)→放行; 总开关关→放行; 私聊→放行;
   *   禁发群 → 活性下限 → 窗口频率 → 日预算 → 同图去重。
   * 放行后发送成功再调 noteSent 记录(发送失败不占预算)。
   */
  checkMedia(ctx: MediaGateCtx): MediaGateVerdict {
    const gates = liveGates();
    const isSticker = ctx.kind === 'image'
      && !!ctx.localPath
      && isStickerPath(ctx.localPath, this.dataDir, gates.libRoots);
    if (!isSticker) return { allowed: true, isSticker: false };
    if (gates.enabled !== true) return { allowed: true, isSticker: true };
    if (!ctx.groupId) return { allowed: true, isSticker: true };

    if ((gates.bannedGroups ?? []).includes(ctx.groupId)) {
      return { allowed: false, isSticker: true, reason: '此群已列入表情包禁发名单' };
    }
    if ((gates.activityMinMsgs ?? 0) > 0) {
      const win = (gates.activityWindowSec ?? 3600) > 0 ? gates.activityWindowSec : 3600;
      const n = this.countActivity(ctx.groupId, win);
      if (n < gates.activityMinMsgs) {
        return { allowed: false, isSticker: true, reason: `群活跃度不足(近${Math.round(win / 60)}分钟仅${n}条, 需≥${gates.activityMinMsgs}条才许主动发)` };
      }
    }
    if ((gates.maxPerWindow ?? 0) > 0 && (gates.perWindowSec ?? 0) > 0) {
      const n = this.countSentInWindow(ctx.groupId, gates.perWindowSec);
      if (n >= gates.maxPerWindow) {
        return { allowed: false, isSticker: true, reason: `发送频率超限(每${Math.round(gates.perWindowSec / 60)}分钟≤${gates.maxPerWindow}张, 窗口内已${n}张)` };
      }
    }
    if ((gates.dailyBudgetPerGroup ?? 0) > 0) {
      const days = this.budget.get(ctx.groupId);
      const usedToday = days?.get(todayKey()) ?? 0;
      if (usedToday >= gates.dailyBudgetPerGroup) {
        return { allowed: false, isSticker: true, reason: `今日此群预算已用完(${usedToday}/${gates.dailyBudgetPerGroup}张)` };
      }
    }
    if ((gates.dupTTLHours ?? 0) > 0) {
      const last = this.used.get(ctx.localPath as string);
      if (last && Date.now() - last < gates.dupTTLHours * 3600 * 1000) {
        return { allowed: false, isSticker: true, reason: `同图去重(${gates.dupTTLHours}h 内已发过这张)` };
      }
    }
    return { allowed: true, isSticker: true };
  }

  /** 放行且发送成功后才调: 记发送窗口/日预算/同图去重 + 追加发送流水 */
  noteSent(groupId: string | undefined, localPath: string | undefined): void {
    if (!groupId || !localPath) return;
    const now = Date.now();
    let arr = this.sentTimes.get(groupId);
    if (!arr) {
      arr = [];
      this.sentTimes.set(groupId, arr);
    }
    arr.push(now);
    if (arr.length > SENT_RING_MAX) arr.splice(0, arr.length - SENT_RING_MAX);

    let days = this.budget.get(groupId);
    if (!days) {
      days = new Map();
      this.budget.set(groupId, days);
    }
    const tk = todayKey(now);
    days.set(tk, (days.get(tk) ?? 0) + 1);

    this.used.set(localPath, now);
    this.save();
    try {
      appendFileSync(this.sendlogPath(), JSON.stringify({ ts: now, group: groupId, path: localPath, day: tk }) + '\n', 'utf8');
    } catch { /* 流水失败不影响 */ }
  }

  // ── 每轮计数辅助(供 sendRichOutbound 判断该段是否算"本轮的库内表情包图") ──
  /** 把媒体段原文 source 归一到本地绝对路径; URL 返回 undefined */
  resolveLocalPath(rawSource: string, cwd: string | undefined): string | undefined {
    const s = (rawSource ?? '').trim();
    if (!s || /^https?:\/\//i.test(s)) return undefined;
    if (s.startsWith('file://')) return s.replace(/^file:\/\//, '');
    if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/')) return s;
    return cwd ? join(cwd, s) : s;
  }

  /** 某媒体段是否属于库内表情包图(perTurn 计数用; 不发只判) */
  isStickerMediaSegment(kind: MediaKind, rawSource: string, cwd: string | undefined): boolean {
    if (kind !== 'image') return false;
    const p = this.resolveLocalPath(rawSource, cwd);
    if (!p) return false;
    return isStickerPath(p, this.dataDir, liveGates().libRoots);
  }
}

// ── 多例注册表(多账号支持, 2026-09-03): 每账号实例一个 dataDir → 各自闸门状态/预算/日志。
const _gates = new Map<string, StickerGate>();
let _primaryGateDir: string | undefined;

/** 启动早期按 config.cwd 解析的 dataDir 预初始化(防目录分裂, 与 configureStickerStore 同款纪律) */
export function initStickerGate(dataDir: string, logger?: Logger): StickerGate {
  const key = resolve(dataDir);
  let g = _gates.get(key);
  if (!g) {
    g = new StickerGate(dataDir, logger);
    _gates.set(key, g);
  }
  if (!_primaryGateDir) _primaryGateDir = key;
  return g;
}

/** primary 是否已初始化(未初始化时不应无参调用以免误建目录) */
export function hasStickerGate(): boolean {
  return _primaryGateDir !== undefined && _gates.has(_primaryGateDir);
}

/** 获取闸门实例。带 dataDir → 按目录取; 无参 → primary(主账号)。 */
export function getStickerGate(dataDir?: string, logger?: Logger): StickerGate {
  if (dataDir) {
    const key = resolve(dataDir);
    let g = _gates.get(key);
    if (!g) {
      g = new StickerGate(dataDir, logger);
      _gates.set(key, g);
    }
    if (!_primaryGateDir) _primaryGateDir = key;
    return g;
  }
  if (_primaryGateDir) {
    const g = _gates.get(_primaryGateDir);
    if (g) return g;
  }
  if (_gates.size === 1) return _gates.values().next().value as StickerGate;
  const dir = join(process.cwd(), '表情包');
  const g = new StickerGate(dir, logger);
  _gates.set(resolve(dir), g);
  if (!_primaryGateDir) _primaryGateDir = resolve(dir);
  return g;
}

/** 出站侧把待落盘状态写盘(进程退出兜底; 全部实例都 flush) */
export function flushStickerGate(): void {
  for (const g of _gates.values()) {
    try { g.flush(); } catch { /* ignore */ }
  }
}

/**
 * sendRichOutbound 用: 组一个 perTurn(每轮张数)判定上下文。
 * 未初始化闸门(如单测/无 bot 场景) → perTurnMax=0 不限制, isSticker 恒 false, 不误建目录。
 */
export function stickerPerTurnCtx(cwd?: string): {
  perTurnMax: number;
  isSticker(kind: MediaKind, rawSource: string): boolean;
} {
  if (!hasStickerGate()) return { perTurnMax: 0, isSticker: () => false };
  const gate = getStickerGate();
  return {
    perTurnMax: liveGates().perTurnMax ?? 0,
    isSticker: (kind, raw) => gate.isStickerMediaSegment(kind, raw, cwd),
  };
}

// ── 中间件: 群消息活性记录(必须在 mentionGate 之前, 未@消息也流经; 由 setup 挂接) ──
// dataDir: 每账号实例传自己目录; 缺省走 primary(兼容旧调用)
export function stickerActivityRecorder(dataDir?: string) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    if (ctx.message.kind === 'group' && ctx.message.groupOpenid) {
      try {
        getStickerGate(dataDir).recordActivity(ctx.message.groupOpenid);
      } catch { /* 记录失败不影响主链 */ }
    }
    await next();
  };
}
