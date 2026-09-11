/**
 * debounce.ts — 延迟聚合回复(2026-09-05 新增; 与"群冷却"融合的终版)
 *
 * 要解决的问题: 用户连发 N 句, AI 只回第一句 / 上下文顺序倒置。
 *
 * 链路位置: 插在群冷却中间件**之前**(middleware-setup 第6.6步)。所有群消息(普通/@)与私聊
 * 先聚合进 per-peer 窗口(peerKey = group:<groupOpenid> | c2c:<senderId>), 冷却中间件收不到被吞的消息。
 *
 * 窗口/触发: 有新消息(按 QQ 服务器时间戳更新)就重置计时; 静默 X 秒 或 攒满 Y 条 → 尝试派发。
 *
 * 派发判定(与群冷却融合):
 *  - 窗口含 @: @ 无视冷却, 随时整批派发(只多等 debounce 静默)。
 *  - 群普通(无@): 距上次普通派发不足 freeIntervalSec → 窗口保留继续攒, 冷却结束再整批
 *    按服务器时间序一次综合回(两次"批派发"仍 ≥60s, 防刷屏语义保留; 冷却是 60s 级的、聚合是 3s 级的, 不再打架)。
 *  - 私聊: 无冷却, 直接派发。
 *
 * 派发内容(防倒序): 以 store(mediaHistoryBuffer 记录的全量, 含被吞消息)为权威,
 * 与窗口合并去重后按服务器时间戳升序: current = 时间序最后一条; 窗口内更早的 @ 消息在 history 里补
 * " (@you)" 标注(与 current 同款 @ 事实标注, 回不回由 AI 按守则判, 插件不注入回复指令);
 * 其余按序进 [Chat history]。私聊无 store → 窗口文本按序拼接+合并附件成合成消息直连。
 *
 * 斜杠命令(以 / 开头)不聚合直放行: 保 /approve /bot-stop 等命令的即时性。
 * debounce.enabled=false 或 @ 秒回(mentionDelayed=false) → 直放行, 交回下方群冷却中间件与既有链路。
 *
 * 配置: config.behavior.debounce { enabled, silenceSec, maxMsgs, mentionDelayed } + behavior.freeIntervalSec, 每次现读(live 热更)。
 * ⚠️ 本地手改功能: 同步纪律同 middleware-setup.ts 内群冷却中间件(改完保持 src 与部署 dist 一致)。
 */
import type { Middleware, MiddlewareContext, HistoryEntry } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.js';
import { dataRootOf } from './data-root.js';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';
import { handleInbound } from '../transport/inbound.js';
import { getHistoryStore, historyGroupKey } from '../features/history-store.js';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

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
  /** 是否因「LLM 回合中」defer 过(主人定 2026-09-07): 只有这类聚合才带系统时间提示;
   *  原版 debounce 的"等用户连发完综合回"是正常对话, 不加提示。 */
  turnDeferred?: boolean;
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
 * 构造延迟聚合中间件(与群冷却融合, 2026-09-05 终版)。
 * 插在群冷却中间件**之前**: 所有群消息(普通/@)与私聊先聚合进 per-peer 窗口;
 * flush 时群普通消息仍受 60s 冷却约束(未过则窗口保留等冷却结束整批按时间序派发),
 * @ 消息无视冷却随时派发。
 * cooldownAt: 与 middleware-setup 群冷却中间件共享的 lastDispatchAt(groupOpenid -> 上次普通派发 ms)。
 */
export function debounceLayer(
  config: ImQQBotConfig,
  manager: SessionManager,
  logger: Logger,
  cooldownAt: Map<string, number>,
): Middleware {
  const windows = new Map<string, DebounceWindow>();

  /** 调序调试日志(临时, 定位官方帧序用; 排查完删除): {dataRoot}/.qqbot/debounce-dbg.log */
  const dbgFile = join(dataRootOf(config), '.qqbot', 'debounce-dbg.log');
  function dbg(line: string): void {
    try {
      appendFileSync(dbgFile, `${new Date().toISOString()} ${line}\n`, 'utf8');
    } catch { /* ignore */ }
  }

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

  /** 尝试派发一批(窗口内全部消息 → AI 一次综合回复)。
   *  群普通(无@)受 60s 冷却约束: 未过冷却 → 窗口保留、重排计时器, 冷却结束再整批按时间序派发。
   *  @ 消息(窗口含@)/私聊: 随时派发。 */
  async function flush(key: string, w: DebounceWindow): Promise<void> {
    const pre = w.entries;
    if (pre.length === 0) {
      clearTimer(w);
      windows.delete(key);
      return;
    }
    const f0 = pre[0];
    if (!f0) {
      clearTimer(w);
      windows.delete(key);
      return;
    }
    const fKind = String(f0.msg.kind ?? '');
    const hasMention = pre.some(e => e.wasMentioned);

    // ── LLM 回合中聚合(2026-09-07 主人定, 2026-09-11 主人改): 我正在思考/输出时, 新消息全攒着,
    //    不派发不入站 —— 无时间限制, 必须等 turn/end(record.turnActive=false)后窗口才批量 flush;
    //    只受条数约束(窗口防御上限 + maxMsgs 攒满尝试派发)。──
    {
      const recPeer = fKind === 'group'
        ? String(f0.msg.groupOpenid ?? f0.msg.senderId ?? '')
        : String(f0.msg.senderId ?? '');
      if (recPeer) {
        const busyRec = manager.findByPeer(fKind === 'group' ? 'group' : 'c2c', recPeer);
        if (busyRec?.turnActive) {
          w.turnDeferred = true; // 本次窗口因回合忙被 defer → 派发时带系统时间提示
          clearTimer(w);
          w.timer = setTimeout(() => void flush(key, w), 800); // 回合中: 800ms 后重查(一直等到回合结束)
          w.timer.unref?.();
          dbg(`flush 回合忙 defer(等 turn/end, 无时间上限) key=${key} n=${pre.length}`);
          return; // 窗口保留, 不派发
        }
      }
    }

    if (fKind === 'group' && !hasMention) {
      // 群普通消息: 距上次普通派发不足 freeIntervalSec → 冷却中, 窗口保留继续攒
      const gid = String(f0.msg.groupOpenid ?? f0.msg.senderId ?? '');
      const freeSec = Math.max(0, num((config.behavior as { freeIntervalSec?: unknown })?.freeIntervalSec, 0));
      if (gid && freeSec > 0) {
        const nowMs = Date.now();
        const lastAt = cooldownAt.get(gid) ?? 0;
        const passedMs = nowMs - lastAt;
        if (passedMs < freeSec * 1000) {
          clearTimer(w);
          const retryMs = Math.max(500, freeSec * 1000 - passedMs);
          w.timer = setTimeout(() => void flush(key, w), retryMs);
          w.timer.unref?.();
          dbg(`flush 冷却中 defer ${Math.round(retryMs / 1000)}s key=${key} n=${pre.length}`);
          return; // 窗口保留, 不派发
        }
      }
    }
    clearTimer(w);
    windows.delete(key);
    const entries = w.entries;
    if (entries.length === 0) return;

    // QQ 官方推送可能乱序: 派发前统一按服务器时间戳升序排(旧→新)
    entries.sort((a, b) => a.ts - b.ts);

    // 触发消息形状(仅取 kind/gid 参考; 真正的 current 在群分支按时间序从 merged 里取)
    const trigger = entries[entries.length - 1];
    if (!trigger) return;
    const kind = String(trigger.msg.kind ?? '');
    dbg(`flush key=${key} n=${entries.length} sorted-order=[${entries.map(e => JSON.stringify(String(e.msg.content ?? '').slice(0, 24))).join(',')}] hasMention=${hasMention}`);

    try {
      if (kind === 'group') {
        const gid = String(trigger.msg.groupOpenid ?? trigger.msg.senderId ?? '');
        if (!gid) return;
        // 群冷却吞掉的消息也已被 mediaHistoryBuffer(链第4步, 冷却/debounce 之前)记录进 store。
        // 因此以 store 为权威全量: 与窗口合并去重、按服务器时间序排列后,
        // current 取"时间上真正最后一条"(窗口含@时取最后一条被@的), 其余按序进 history ——
        // 避免 current 取成"群冷却放行的第一条"导致上下文整体倒序。
        let storeHist: HistoryEntry[] = [];
        try {
          storeHist = await getHistoryStore(config.appId).list(historyGroupKey(config.appId, gid), num(config.historyLimit, 20));
        } catch (err) {
          logger.warn?.(`[debounce] 拉群历史失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        dbg(`  store-raw=[${storeHist.map(h => JSON.stringify(String(h.content).slice(0, 24))).join(',')}]`);

        interface MergedItem {
          messageId: string;
          ts: number;
          msg?: Record<string, unknown>;
          content?: string;
          senderId?: string;
          senderName?: string;
          wasMentioned?: boolean;
        }
        const merged: MergedItem[] = storeHist.map(h => ({
          messageId: h.messageId,
          ts: h.timestamp || 0,
          content: h.content,
          senderId: h.senderId,
          senderName: h.senderName,
        }));
        for (const e of entries) {
          const id = String(e.msg.messageId ?? '');
          const hit = merged.find(m => m.messageId === id);
          if (hit) {
            if (e.wasMentioned) hit.wasMentioned = true;
            // ⚠️ 2026-09-10 去重(主人实测: "图片链接重复两次, 那不是又回原来的长上下文咯?"):
            //   store 条目只带 foldMedia 折叠文本(`[图片: url]` / `[语音: url]`), **窗口条目才带
            //   原始 content + attachments**。命中时若不给 hit 补 msg, current 就会取 store 版本,
            //   于是附件 URL 在上下文里出现两次: 折叠文本一次 + Layer4 的 `- Image: 名 → url` 一次。
            //   补上后: current 走 cur.msg(原始 content, 附件交给 Layer4 描述), history 仍用折叠文本。
            if (!hit.msg) hit.msg = e.msg;
          } else {
            merged.push({ messageId: id, ts: e.ts, msg: e.msg, wasMentioned: e.wasMentioned });
          }
        }
        merged.sort((a, b) => a.ts - b.ts);

        // current 恒取时间序最后一条(纯时间序, 上下文永不倒置)。
        const cur = merged[merged.length - 1];
        if (!cur) return;

        // 忠实还原 store 原文进 history; 窗口内曾 @ 机器人的消息(时间上早于 current)
        // 补 " (@you)" 标注 —— 与 current 的 (@you) 同款格式, 还原"这条@了bot"的事实,
        // 由 AI 按自身守则决定是否开口(插件不注入回复指令, 保持通用)。
        const hist: HistoryEntry[] = merged
          .filter(m => m.messageId !== cur.messageId)
          .map(m => {
            const baseContent = m.content ?? String(m.msg?.content ?? '');
            return {
              senderId: m.senderId ?? '',
              senderName: m.senderName,
              content: m.wasMentioned ? `${baseContent} (@you)` : baseContent,
              timestamp: m.ts,
              messageId: m.messageId,
            };
          });

        // current 消息: 窗口条目有完整 msg; store 来源的只有 HistoryEntry 字段,
        // 从群窗口消息继承 kind/groupOpenid/attachments 等再补齐本人字段。
        const curMsg: Record<string, unknown> = cur.msg ?? {
          ...(entries[entries.length - 1] ?? trigger).msg,
          messageId: cur.messageId,
          content: cur.content ?? '',
          senderId: cur.senderId,
          senderName: cur.senderName,
          timestamp: new Date(cur.ts).toISOString(),
        };
        // 系统时间提示只在「LLM 回合中 defer 攒批」时带; 普通连发聚合(等用户停口)不带
        const state: Record<string, unknown> = { history: hist, aggregated: w.turnDeferred === true };
        if (cur.wasMentioned) {
          // current 本身就是 @ 消息 → 走正常 mention, AI 见 (@you)
          state.mention = { wasMentioned: true };
        } else {
          state.batchDispatch = true;
        }
        dbg(`  merged-order=[${merged.map(m => JSON.stringify(String(m.content ?? m.msg?.content ?? '').slice(0, 16))).join(',')}] cur=${JSON.stringify(String(cur.content ?? cur.msg?.content ?? '').slice(0, 16))} hasMention=${hasMention}`);
        // 群普通(无@)批派发 → 记冷却(与群冷却中间件共享 lastDispatchAt, 防刷屏语义保留)
        if (!hasMention) cooldownAt.set(gid, Date.now());
        logger.info(`[debounce] flush(group ${gid}) 窗口${entries.length}条/store${storeHist.length}条 → handleInbound`);
        await handleInbound(curMsg, manager, config, logger, state);
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
        await handleInbound(merged, manager, config, logger, { aggregated: w.turnDeferred === true });
      }
    } catch (err) {
      logger.error(`[debounce] flush 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    // 完全不思考(nothink, 2026-09-07 主人定): QQ 入站不唤醒 LLM, 但消息要照常进入上下文。
    // 这里直接交 handleInbound —— 它的 nothink 分支会把组装好的 user/message append 进会话
    // (不 followup 不唤醒), 下次 web/真人唤醒时 AI 看到完整记录。不走下方群冷却/派发链(防丢)。
    const outMode = (config as { outboundMode?: string }).outboundMode || 'adaptive';
    if (outMode === 'nothink') {
      const nm = ctx.message as unknown as Record<string, unknown>;
      const kind0 = String(nm.kind ?? '');
      const content0 = String(nm.content ?? '').trim();
      // 斜杠命令(/outmode 等)放行 → 走下方 slash 层(逃生通道: 主人可随时唤醒 nothink)
      if (content0.startsWith('/')) return next();
      if (kind0 === 'group' || kind0 === 'c2c') {
        try {
          await handleInbound(nm, manager, config, logger, ctx.state);
        } catch (err) {
          logger.error(`[nothink] handleInbound(append) 异常: ${err instanceof Error ? err.message : String(err)}`);
        }
        return; // 吞掉本消息(已 append 记录), 不触发任何回合
      }
      return next();
    }

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
    // 防御: 窗口保留等冷却期间可能持续进消息 → 超上限丢最老(只留最近 100 条)
    if (w.entries.length >= 100) {
      w.entries.splice(0, w.entries.length - 80);
    }
    const ts = msgTs(msg);
    const arrivedAt = Date.now();
    // 到达日志: 记录"到达本中间件的时刻"+"服务器时间戳", 用于对比官方帧序与真实发送序
    dbg(`arrive key=${key} at=${arrivedAt} ts=${String(msg.timestamp ?? '')} parsedTs=${ts} id=${String(msg.messageId ?? '').slice(0, 14)} mention=${wasMentioned} content=${JSON.stringify(content.slice(0, 30))}`);
    // 只有"比窗口现有消息更新"的消息才算最近说话者继续开口 → 重置静默计时;
    // 乱序补到的旧消息(服务器时间更早)只入窗口, 不延长等待。
    let maxTs = 0;
    for (let i = 0; i < w.entries.length; i++) {
      const e = w.entries[i];
      if (e && e.ts > maxTs) maxTs = e.ts;
    }
    const isNewer = ts >= maxTs;
    w.entries.push({ msg: { ...msg }, wasMentioned, ts });
    dbg(`  win=${w.entries.length} new=${isNewer} order=[${w.entries.map(e => JSON.stringify(String(e.msg.content ?? '').slice(0, 16))).join(',')}]`);
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
