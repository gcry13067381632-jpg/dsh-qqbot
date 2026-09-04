/**
 * debounce.ts — 延迟聚合回复(2026-09-05 新增, 与"群冷却"并行的另一套机制)
 *
 * 要解决的问题: 用户连发 N 句, AI 只回第一句。
 * 机制:
 *  - 输入: 已经冷却中间件判定"本次可派发"的消息(@ / 私聊 / 冷却外群普通消息)。
 *  - 窗口: 这些消息不立即下发, 进 per-peer 窗口(peerKey = group:<groupOpenid> | c2c:<senderId>)。
 *  - 触发: 以"最近说话者"为基准 —— 有新消息就重置计时器; 静默 X 秒 或 窗口攒满 Y 条 → flush。
 *  - flush: 仿 scheduler fireTask —— 取窗口内"最后一条被@的消息"(窗口含@时; 它才是请求回复的那条,
 *           之后的补充消息留在历史里一起打包), 否则取最后一条真实消息, 直连 handleInbound 绕过中间件链;
 *           state 置 batchDispatch / mention + 现拉群历史 → 下游 includeHistory 把窗口期全部消息
 *           一次打包喂 AI 综合回复(不打假 (@you))。
 *  - 私聊: mediaHistoryBuffer 只管 group, 私聊消息没有历史缓冲 → 窗口自缓冲文本,
 *           flush 时按序拼接 content + 合并全部 attachments 成一条合成消息直连(附件/语音 ASR 走 handleInbound 原有组装)。
 *  - 斜杠命令(以 / 开头)不聚合直放行: 保 /approve /bot-stop 等命令的即时性。
 *  - 群消息进窗口时已被链第4步 mediaHistoryBuffer 记录(在 debounce 之前), 吞消息不丢历史。
 *
 * 配置: config.behavior.debounce { enabled, silenceSec, maxMsgs, mentionDelayed }, 每次现读(live 热更)。
 * ⚠️ 本地手改功能: 同步纪律同 middleware-setup.ts 内群冷却中间件(改完保持 src 与部署 dist 一致)。
 */
import type { Middleware, MiddlewareContext, HistoryEntry } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.js';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';
import { handleInbound } from '../transport/inbound.js';
import { getHistoryStore, historyGroupKey } from '../features/history-store.js';

/** 运行时可配字段(全部可缺省, 缺省回落默认值) */
interface DebounceCfg {
  enabled?: boolean;
  silenceSec?: number;
  maxMsgs?: number;
  mentionDelayed?: boolean;
}

const DEFAULTS: Required<DebounceCfg> = { enabled: true, silenceSec: 3, maxMsgs: 10, mentionDelayed: true };

/** 窗口内单条消息的最小形状(展开拷贝, 不持有中间件 ctx 引用) */
interface DebounceEntry {
  msg: Record<string, unknown>;
  wasMentioned: boolean;
  /** QQ 服务器下发时间戳(ms)。QQ 官方事件推送可能乱序, 窗口排序/计时一律以此为准 */
  ts: number;
}

interface DebounceWindow {
  entries: DebounceEntry[];
  timer: NodeJS.Timeout | null;
}

/** 解析消息服务器时间戳(ISO 字符串或 ms 数字; 解析失败回落"到达时刻"兜底) */
function msgTs(msg: Record<string, unknown>): number {
  const raw = msg.timestamp;
  const n = typeof raw === 'number' ? raw : Date.parse(String(raw ?? ''));
  return Number.isFinite(n) ? n : Date.now();
}

function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * 构造延迟聚合中间件。config 为 live 对象引用(behavior.debounce 每次现读, Web 设置热更新即时生效)。
 * 插在群冷却中间件之后、slash 之前。
 */
export function debounceLayer(
  config: ImQQBotConfig,
  manager: SessionManager,
  logger: Logger,
): Middleware {
  const windows = new Map<string, DebounceWindow>();

  const cfg = (): DebounceCfg => {
    const d = (config.behavior as { debounce?: DebounceCfg })?.debounce;
    return d ?? DEFAULTS;
  };

  function clearTimer(w: DebounceWindow): void {
    if (w.timer) {
      clearTimeout(w.timer);
      w.timer = null;
    }
  }

  /** 派发一批: 窗口内全部消息 → AI 一次综合回复 */
  async function flush(key: string, w: DebounceWindow): Promise<void> {
    clearTimer(w);
    windows.delete(key);
    const entries = w.entries;
    if (entries.length === 0) return;

    // QQ 官方推送可能乱序: 派发前统一按服务器时间戳升序排(旧→新)
    entries.sort((a, b) => a.ts - b.ts);

    // 当前触发消息: 窗口含被@的消息时用"最后一条被@的"(它才是请求回复的; 之后的补充在历史里),
    // 否则用窗口最后一条真实消息。
    let triggerIdx = entries.length - 1;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e && e.wasMentioned) {
        triggerIdx = i;
        break;
      }
    }
    const trigger = entries[triggerIdx];
    if (!trigger) return;
    const kind = String(trigger.msg.kind ?? '');

    try {
      if (kind === 'group') {
        const gid = String(trigger.msg.groupOpenid ?? trigger.msg.senderId ?? '');
        if (!gid) return;
        // 窗口期消息已被 mediaHistoryBuffer 记录进共享 store; 现拉历史并剔除"当前消息",
        // 交给 handleInbound 的 includeHistory 打包(与真实 @ 走链时拿到的一致)。
        let history: HistoryEntry[] = [];
        try {
          history = await getHistoryStore().list(historyGroupKey(config.appId, gid), num(config.historyLimit, 10));
        } catch (err) {
          logger.warn?.(`[debounce] 拉群历史失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        const curId = trigger.msg.messageId;
        // store 按到达序 append 也可能乱序 → 派发前按时间戳升序排
        const hist = history
          .filter(h => h.messageId !== curId)
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const state: Record<string, unknown> = { history: hist };
        if (trigger.wasMentioned) {
          state.mention = { wasMentioned: true };
        } else {
          state.batchDispatch = true;
        }
        logger.info(`[debounce] flush(group ${gid}) ${entries.length}条 → handleInbound`);
        await handleInbound(trigger.msg, manager, config, logger, state);
      } else {
        // 私聊: 无群历史缓冲, 窗口自缓冲 → 文本按序拼接 + 合并附件成一条合成消息
        const textLines = entries
          .map(e => String(e.msg.content ?? '').trim())
          .filter(Boolean);
        const allAtts: unknown[] = [];
        for (const e of entries) {
          const a = (e.msg as { attachments?: unknown[] }).attachments;
          if (Array.isArray(a) && a.length > 0) allAtts.push(...a);
        }
        const lastEntry = entries[entries.length - 1];
        const base = (lastEntry ?? trigger).msg;
        const merged: Record<string, unknown> = {
          ...base,
          content: textLines.join('\n'),
          attachments: allAtts.length > 0 ? allAtts : undefined,
        };
        logger.info(`[debounce] flush(c2c ${String(base.senderId ?? '')}) ${entries.length}条 → handleInbound`);
        await handleInbound(merged, manager, config, logger, undefined);
      }
    } catch (err) {
      logger.error(`[debounce] flush 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const c = cfg();
    if (!c.enabled) return next();

    const msg = ctx.message as unknown as Record<string, unknown>;
    const kind = String(msg.kind ?? '');
    if (kind !== 'group' && kind !== 'c2c') return next();

    // 斜杠命令不聚合: 保 /approve、/bot-stop、/help 等即时响应
    const content = String(msg.content ?? '').trim();
    if (content.startsWith('/')) return next();

    const wasMentioned =
      (ctx.state as { mention?: { wasMentioned?: boolean } })?.mention?.wasMentioned === true;
    // @ 可配置为不走延迟(秒回)
    if (wasMentioned && c.mentionDelayed === false) return next();

    const peerId = kind === 'group'
      ? (msg.groupOpenid ?? msg.senderId)
      : msg.senderId;
    if (!peerId) return next();
    const key = `${kind}:${String(peerId)}`;

    const silenceMs = Math.max(0, num(c.silenceSec, DEFAULTS.silenceSec)) * 1000;
    const maxMsgs = Math.max(1, Math.floor(num(c.maxMsgs, DEFAULTS.maxMsgs)));
    if (silenceMs <= 0) return next(); // 0=不停顿: 保持原链路立即派发

    let w = windows.get(key);
    if (!w) {
      w = { entries: [], timer: null };
      windows.set(key, w);
    }
    const ts = msgTs(msg);
    // 只有"比窗口现有消息更新"的消息才算最近说话者继续开口 → 重置静默计时;
    // 乱序补到的旧消息(服务器时间更早)只入窗口, 不延长等待。
    let maxTs = 0;
    for (let i = 0; i < w.entries.length; i++) {
      const e = w.entries[i];
      if (e && e.ts > maxTs) maxTs = e.ts;
    }
    const isNewer = ts >= maxTs;
    w.entries.push({ msg: { ...msg }, wasMentioned, ts });
    if (isNewer) {
      // 最近说话者(按服务器时间)刚又开口 → 重新等 ta 停口 silenceMs
      clearTimer(w);
      w.timer = setTimeout(() => void flush(key, w as DebounceWindow), silenceMs);
      w.timer.unref?.();
    }

    // 攒满上限立即发, 不等对方停
    if (w.entries.length >= maxMsgs) {
      void flush(key, w);
      return;
    }
    // 吞掉本消息(不调 next): 群消息已被链第4步 mediaHistoryBuffer 记录, 延迟到 flush 直连派发
  };
}
