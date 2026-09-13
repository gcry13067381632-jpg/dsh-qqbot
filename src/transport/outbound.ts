/**
 * 出站处理器 — dsh session/event → QQ 消息发送
 *
 * 采用路由器模式：OutboundRouter 持有会话级状态（文本缓冲、工具调用记录），
 * 事件解析归一化在 events.ts，路由按事件类型分发到私有方法。
 */
import type { SessionManager, SessionRecord } from '../session/index.js';
import type { ImQQBotConfig } from '../config.js';
import type { Logger, ReplyTarget } from '../types.js';
import { OutboundBuffer, sendRichOutbound, type QQBotSender } from './outbound-buffer.js';
import { resolveMsgIndex } from './msg-index.js';
import { dataRootOf } from '../gateway/data-root.js';
import { formatToolResult, type ToolsRegistryLike, type ToolResultData } from './tool-presenter.js';
import {
  parseEvent,
  extractTurnError,
  type ChunkEvent,
  type MessageEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type TurnEndEvent,
  type RawSessionEvent,
} from './events.js';

export type { QQBotSender } from './outbound-buffer.js';
export type { ToolsRegistryLike } from './tool-presenter.js';

/** 出站处理器签名（注册到 ctx.on('session/event')） */
export type OutboundHandler = (session: SessionLike, event: RawSessionEvent) => void;

/** dsh Session 简化类型 */
export interface SessionLike {
  header: { id: string };
}

/** 工具调用记录（tool/call 建立，tool/result 消费） */
interface ToolCallRecord {
  name: string;
  args: string;
}

/** 不展示给用户的轮次错误码（底层传输/网络错误，对用户无意义，且常被重试兜住） */
const SILENT_TURN_ERROR_CODES = new Set(['STREAM_CLOSED']);

/** 适配主动: 同一入站消息(msg_id)最多被动回复条数(QQ 回复同一消息上限 ~4-5 条), 超出自动转主动 */
const ADAPTIVE_MAX_PASSIVE = 5;
/** 适配主动: 「最近收到消息」判据(距上次入站活动 N ms 内才算; 过期旧 msg_id 不再被动引用, 防引用失效丢消息) */
const ADAPTIVE_RECENT_MS = 5 * 60_000;

/**
 * 出站路由器：持有会话级状态，按事件类型分发到处理器
 */
class OutboundRouter {
  private readonly buffers = new Map<string, OutboundBuffer>();
  private readonly toolCalls = new Map<string, ToolCallRecord>();
  /** 适配主动状态: sessionKey → 当前入站 msg_id 及已被动回复条数 */
  private readonly adaptiveState = new Map<string, { msgId?: string; passiveCount: number }>();
  /** passive 收尾(2026-09-10 主人定 A 方案): **同一个 msg_id 下**已发出的正文块计数 + 最后一块文本。
   *  ⚠️ 必须按 msgId 分组: QQ 的被动回复 5 条上限是**按 msg_id 计**的, 群友中途发言会让
   *  record.replyTarget 换成新 msgId、配额随之重置 —— 那时后面的块本来就送得到, 不该再补发。 */
  private readonly turnBlocks = new Map<string, { msgId: string; count: number; last: string }>();
  /** 详细主动(detail, 2026-09-11 主人加): sessionKey → 聚合中的工具调用提示 */
  private readonly toolNotices = new Map<string, { record: SessionRecord; lines: string[]; timer: ReturnType<typeof setTimeout> }>();
  /** 详细主动: 工具调用提示的聚合窗口(ms) —— 一个回合连着调 10 个工具也只推一条, 防刷屏 */
  private static readonly TOOL_NOTICE_WINDOW_MS = 1200;
  /** 详细主动: 单条工具提示最多列几个工具(其余折叠成"等 N 个") */
  private static readonly TOOL_NOTICE_MAX = 8;

  public constructor(
    private readonly manager: SessionManager,
    private readonly bot: QQBotSender,
    private readonly config: ImQQBotConfig,
    private readonly logger: Logger,
    private readonly toolsRegistry: ToolsRegistryLike | undefined,
  ) {}

  /** 出站目标(每次实际发送前逐条调用, [RECALL] 除外):
   *  passive → 一律带 msg_id 回复(其余行为不变; 唯一例外: 回合主回复正文块>5 时
   *   第 6 块起转主动, 见 chunkTargetFn——2026-09-10 主人定);
   *  adaptive(默认)/active → 智能: 最近 5 分钟内收到过消息
   *  (lastActivity 新鲜)且同一条入站消息(msg_id)回复未超过 ADAPTIVE_MAX_PASSIVE 条 → 带 msg_id
   *  被动回复(有引用感); 超出/无近期入站(定时推送等) → 自动去 msg_id 转主动(防 QQ 吞/引用失效)。
   *  新入站消息(msg_id 变化)自动重置被动配额。 */
  private resolveTarget(record: SessionRecord): ReplyTarget {
    const rt = record.replyTarget;
    const mode = this.config.outboundMode || 'adaptive';
    if (mode === 'passive') return rt;
    if (!rt.msgId) return { scope: rt.scope, targetId: rt.targetId };
    // 仅真实入站(QQ 收到消息)后 5 分钟内算「最近收到消息」; 定时注入不刷新 lastInboundAt → 直接主动
    const recent = Date.now() - (record.lastInboundAt || 0) <= ADAPTIVE_RECENT_MS;
    if (!recent) return { scope: rt.scope, targetId: rt.targetId };
    const key = record.sessionKey;
    let st = this.adaptiveState.get(key);
    if (!st || st.msgId !== rt.msgId) {
      // 新入站消息(msg_id 变化)→ 重置被动配额
      st = { msgId: rt.msgId, passiveCount: 0 };
      this.adaptiveState.set(key, st);
    }
    if (st.passiveCount < ADAPTIVE_MAX_PASSIVE) {
      st.passiveCount += 1;
      return rt;
    }
    // 已连续被动 5 条 → 本条起转主动(去掉 msg_id, 不再被 QQ 回复上限吞)
    return { scope: rt.scope, targetId: rt.targetId };
  }

  /** 主动目标(去 msg_id 独立发送): 回合主回复正文块>5 时的收尾块用 */
  private activeTarget(record: SessionRecord): ReplyTarget {
    const rt = record.replyTarget;
    return { scope: rt.scope, targetId: rt.targetId };
  }

  /**
   * 引用短号查表(2026-09-13 主人定): 正文里 [rf:短号] → 完整 msg_id。
   * 台账按 peer 存({dataRoot}/.qqbot/msg-index/{peer}/refs.json, 见 transport/msg-index.ts)。
   */
  private refLookupFor(record: SessionRecord): (index: string) => string | undefined {
    const rt = record.replyTarget;
    const root = dataRootOf(this.config);
    return (index) => resolveMsgIndex(root, rt.scope, rt.targetId, index);
  }

  /**
   * 回合主回复的「块级目标」: passive 模式正文块>5 时仅最后一块(总结)转主动发送,
   * 中途不改模式(前 total-1 块全被动带引用) —— 2026-09-10 主人最终语义:
   * 回合结束判断最后一个正文块>5 → 获取其内容单独主动发到 QQ。
   * 返回 undefined = 不启用(adaptive 走自身 resolveTarget 计数, 无需此处干预)。
   */
  private chunkTargetFn(record: SessionRecord): ((i: number, total: number) => ReplyTarget) | undefined {
    if ((this.config.outboundMode || 'adaptive') !== 'passive') return undefined;
    return (i, total) => (total > 5 && i === total - 1) ? this.activeTarget(record) : this.resolveTarget(record);
  }

  /** 记账(**生成侧**, 2026-09-10 修正): 每产生一块正文就登记, **与发送成败解耦**。
   *  ⚠️ 原实现挂在「发送成功之后」(sendRichOutbound 的 onBlockSent), 一旦 QQ 吞消息
   *  (在这里表现为 sendMarkdown 抛错), await 就炸 → 记账中断(实测 count 停在第 4 条, 补发永不触发)。
   *  按 msgId 分组: 同一 msgId 才算同一批被动回复配额, msgId 变化(群友中途发言)即重新计数。 */
  private noteGenerated(sessionKey: string, msgId: string, text: string): void {
    const cur = this.turnBlocks.get(sessionKey);
    if (!cur || cur.msgId !== msgId) {
      this.turnBlocks.set(sessionKey, { msgId, count: 1, last: text });
      return;
    }
    cur.count += 1;
    cur.last = text;
  }

  /**
   * passive 回合收尾(2026-09-10 主人定 **A 方案**):
   *   **同一个 msg_id 下**发出的正文块 > 5 时, 把**最后一块的文本复制一份**, 用主动目标(去掉
   *   msg_id)单独再发一次 —— QQ 对同一条入站消息的被动回复上限约 5 条, 前 5 块之后的可能被吞,
   *   而最后一块通常是结论/总结, 值得保住。
   *   ⚠️ 计数按 msgId 分组: 群友中途发言 → msgId 变 → 5 条配额重置 → 后面的块送得到 → **不补发**
   *   (2026-09-10 主人指出原按"回合总块数"判定会白白重复推一条)。
   *   注: adaptive 模式本身「第 6 条起自动转主动」= 主人说的 B 方案, 已内建, 故此处只处理 passive。
   */
  private maybeResendLastBlock(sessionKey: string, record: SessionRecord): void {
    const st = this.turnBlocks.get(sessionKey);
    this.turnBlocks.delete(sessionKey);
    if (!st) return;
    if ((this.config.outboundMode || 'adaptive') !== 'passive') return;
    if (st.count <= 5 || !st.last.trim()) return;
    void this.bot.sendMarkdown(this.activeTarget(record), st.last).then(
      () => this.logger.info(`im-qqbot: [passive 收尾] 回合正文 ${st.count} 块 > 5, 已把最后一块单独补发(主动)`),
      (err: unknown) => this.logger.warn(`im-qqbot: [passive 收尾] 最后一块补发失败: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  /** 事件分发入口 */
  public route(session: SessionLike, raw: RawSessionEvent): void {
    const event = parseEvent(raw);
    if (event === undefined) return;

    const record = this.manager.findBySessionId(session.header.id);
    if (record === undefined) return;

    // ── 回合活跃标记(消息聚合用, 2026-09-07 主人定) ──
    // LLM 回合进行中(turnActive=true): debounce 见忙就把该会话新消息全攒着;
    // turn/end 复位 false → 攒的消息才批量入站。assistant/tool 事件=回合活跃。
    if (event.type === 'turn/end') {
      record.turnActive = false;
    } else if (event.type === 'assistant/chunk' || event.type === 'assistant/message'
      || event.type === 'tool/call' || event.type === 'tool/result') {
      record.turnActive = true;
    }

    // 完全不出站(silent)= 照常思考但所有回复不向 QQ 发(静默潜水; dock/web 仍可见思考流);
    // 完全不思考(nothink)= QQ 入站根本不唤醒 LLM(见 inbound), 这里防御性兜底同样吞。
    const mode = this.config.outboundMode || 'adaptive';
    if (mode === 'silent' || mode === 'nothink') {
      // 丢弃累积的文本缓冲(不留残渣), 后续事件全部静默
      const silentBuf = this.buffers.get(session.header.id);
      if (silentBuf !== undefined) {
        silentBuf.cancel();
        this.buffers.delete(session.header.id);
      }
      return;
    }

    switch (event.type) {
      case 'assistant/chunk':
        this.onChunk(session.header.id, record, event);
        break;
      case 'assistant/message':
        this.onMessage(session.header.id, record, event);
        break;
      case 'tool/call':
        this.onToolCall(record, event);
        break;
      case 'tool/result':
        this.onToolResult(record, event);
        break;
      case 'turn/end':
        this.onTurnEnd(session.header.id, record, event);
        break;
    }
  }

  /** 流式文本增量：累积到会话 buffer */
  private onChunk(sessionId: string, record: SessionRecord, event: ChunkEvent): void {
    let buffer = this.buffers.get(sessionId);
    if (buffer === undefined) {
      buffer = new OutboundBuffer(
        record,
        this.bot,
        this.config.textChunkLimit,
        this.logger,
        this.shouldStream(record),
        this.config.cwd,
        () => this.resolveTarget(record),
        this.chunkTargetFn(record),
        undefined,
        this.refLookupFor(record),
      );
      this.buffers.set(sessionId, buffer);
    }
    buffer.append(event.text);
  }

  /** 是否启用流式：配置开启 + c2c + 有 msgId（群聊不支持流式） */
  private shouldStream(record: SessionRecord): boolean {
    return this.config.streaming
      && record.replyTarget.scope === 'c2c'
      && !!record.replyTarget.msgId;
  }

  /** 完整 assistant 消息：有流式 buffer 则 flush，否则直接发送文本块 */
  private onMessage(sessionId: string, record: SessionRecord, event: MessageEvent): void {
    const buffer = this.buffers.get(sessionId);
    if (buffer !== undefined && buffer.text.trim()) {
      // 记账放**生成侧**(不看发送成败): 这块正文已经产生了, 就该入账
      this.noteGenerated(record.sessionKey, record.replyTarget.msgId ?? '', buffer.text);
      void buffer.flush();
      this.buffers.delete(sessionId);
      return;
    }

    const textParts: string[] = [];
    for (const block of event.content) {
      if (block.type === 'text' && block.text) textParts.push(block.text);
    }
    const fullText = textParts.join('\n');
    if (!fullText.trim()) return;

    this.noteGenerated(record.sessionKey, record.replyTarget.msgId ?? '', fullText);
    void this.send(record, fullText, 'sendMarkdown');
    this.buffers.delete(sessionId);
  }

  /** 详细主动(detail, 2026-09-11 主人加): 发送行为与 adaptive 完全一致, 额外推送工具调用/结果 */
  private isDetail(): boolean {
    return (this.config.outboundMode || 'adaptive') === 'detail';
  }

  /** 工具结果是否推送: 显式开关(showToolResults) 或 详细主动 */
  private shouldShowToolResults(): boolean {
    return this.config.showToolResults === true || this.isDetail();
  }

  /** 详细主动: 记一条工具调用到聚合窗口(窗口结束统一推一条, 防一个回合刷几十条) */
  private queueToolCallNotice(record: SessionRecord, event: ToolCallEvent): void {
    const key = record.sessionKey;
    const line = `🔧 \`${event.name}\`${summarizeArgs(event.arguments)}`;
    const cur = this.toolNotices.get(key);
    if (cur !== undefined) {
      cur.lines.push(line);
      cur.record = record; // 以最新 record 为准(中途可能换了回复目标)
      return;
    }
    const timer = setTimeout(() => { this.flushToolNotices(key); }, OutboundRouter.TOOL_NOTICE_WINDOW_MS);
    try { timer.unref?.(); } catch { /* 非 Node 定时器忽略 */ }
    this.toolNotices.set(key, { record, lines: [line], timer });
  }

  /** 详细主动: 把聚合中的工具调用提示发出去(多个工具合成一条消息) */
  private flushToolNotices(key: string): void {
    const cur = this.toolNotices.get(key);
    if (cur === undefined) return;
    this.toolNotices.delete(key);
    clearTimeout(cur.timer);
    const max = OutboundRouter.TOOL_NOTICE_MAX;
    const shown = cur.lines.slice(0, max);
    const more = cur.lines.length > max ? `\n…等 ${cur.lines.length} 个工具` : '';
    void this.send(cur.record, `**🔧 工具调用**\n${shown.join('\n')}${more}`, 'sendToolCallNotice');
  }

  /** 工具调用：默认仅记录(避免刷屏, 等结果)；详细主动(detail)下额外推一条轻量提示 */
  private onToolCall(record: SessionRecord, event: ToolCallEvent): void {
    this.toolCalls.set(event.callId, { name: event.name, args: event.arguments });
    if (this.isDetail()) this.queueToolCallNotice(record, event);
  }

  /** 工具结果：错误始终发送；成功结果按开关，详细主动(detail)下强制发送 */
  private onToolResult(record: SessionRecord, event: ToolResultEvent): void {
    const call = this.toolCalls.get(event.callId);
    this.toolCalls.delete(event.callId);
    if (call === undefined) return;

    if (event.error === undefined && !this.shouldShowToolResults()) return;

    const text = formatToolResult(
      call.name,
      call.args,
      event.raw as unknown as ToolResultData,
      this.toolsRegistry,
      record.agent,
    );
    if (!text) return;

    void this.send(record, text, 'sendToolResult');
  }

  /** 轮次结束：清理 buffer，异常结束时告知用户 */
  private onTurnEnd(sessionId: string, _record: SessionRecord, event: TurnEndEvent): void {
    // 详细主动: 回合结束前先把聚合中的工具调用提示发出去(别让最后一批工具沉在队列里)
    this.flushToolNotices(_record.sessionKey);
    const buffer = this.buffers.get(sessionId);
    // 先让残留 buffer flush 完(记账在 flush 里发生), 再判断 passive 收尾补发
    const finish = (): void => this.maybeResendLastBlock(_record.sessionKey, _record);
    if (buffer !== undefined) {
      if (buffer.text.trim()) {
        void buffer.flush().then(finish, finish);
      } else {
        buffer.cancel();
        finish();
      }
      this.buffers.delete(sessionId);
    } else {
      finish();
    }

    const failure = extractTurnError(event.reason);
    if (failure !== undefined && !SILENT_TURN_ERROR_CODES.has(failure.code)) {
      void this.send(_record, `⚠️ 本轮异常结束\n\`${failure.code}\`: ${failure.message}`, 'sendTurnEndError');
    }

    this.logger.debug(`im-qqbot: turn/end sessionId=${sessionId}`);
  }

  /** 统一发送：逐条自适应目标(适配主动) + 富媒体感知分块；媒体指令([MEDIA:..]/[RECALL])被剔除，失败降级记录 */
  private async send(_record: SessionRecord, text: string, tag: string): Promise<void> {
    try {
      await sendRichOutbound(
        this.bot,
        _record.replyTarget,
        text,
        this.config.textChunkLimit,
        this.config.cwd,
        (m) => this.logger.error(m),
        () => this.resolveTarget(_record),
        this.chunkTargetFn(_record),
        undefined,
        this.refLookupFor(_record),
      );
    } catch (err) {
      this.logger.error(`im-qqbot: ${tag} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** 工具参数摘要(详细主动推送用): 压成一行并截断 */
function summarizeArgs(rawArgs: string): string {
  const s = String(rawArgs ?? '').trim();
  if (s === '' || s === '{}') return '';
  const one = s.replace(/\s+/g, ' ');
  return `(${one.length > 60 ? `${one.slice(0, 60)}…` : one})`;
}

/**
 * 创建出站事件处理器
 *
 * 返回一个 handler 函数，应注册到 ctx.on('session/event', handler)。
 * toolsRegistry 用于工具结果的结构化展示（参考 dsh-TUI 的 presentResult）。
 */
export function createOutboundHandler(
  manager: SessionManager,
  bot: QQBotSender,
  config: ImQQBotConfig,
  logger: Logger,
  toolsRegistry?: ToolsRegistryLike,
): OutboundHandler {
  const router = new OutboundRouter(manager, bot, config, logger, toolsRegistry);
  return (session, event) => router.route(session, event);
}
