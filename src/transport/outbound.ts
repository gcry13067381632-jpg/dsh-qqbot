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
   * 回合主回复的「块级目标」: passive 模式正文块>5 时前 5 块被动、第 6 块起(含最后总结)转主动。
   * 返回 undefined = 不启用(adaptive 走自身 resolveTarget 计数, 无需此处干预)。
   */
  private chunkTargetFn(record: SessionRecord): ((i: number, total: number) => ReplyTarget) | undefined {
    if ((this.config.outboundMode || 'adaptive') !== 'passive') return undefined;
    return (i, total) => (total > 5 && i >= 5) ? this.activeTarget(record) : this.resolveTarget(record);
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
        this.onToolCall(event);
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

    void this.send(record, fullText, 'sendMarkdown');
    this.buffers.delete(sessionId);
  }

  /** 工具调用：仅记录，不发送（避免刷屏，等待结果） */
  private onToolCall(event: ToolCallEvent): void {
    this.toolCalls.set(event.callId, { name: event.name, args: event.arguments });
  }

  /** 工具结果：错误始终发送，成功结果按开关 */
  private onToolResult(record: SessionRecord, event: ToolResultEvent): void {
    const call = this.toolCalls.get(event.callId);
    this.toolCalls.delete(event.callId);
    if (call === undefined) return;

    if (event.error === undefined && !this.config.showToolResults) return;

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
    const buffer = this.buffers.get(sessionId);
    if (buffer !== undefined) {
      if (buffer.text.trim()) {
        void buffer.flush();
      } else {
        buffer.cancel();
      }
      this.buffers.delete(sessionId);
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
      );
    } catch (err) {
      this.logger.error(`im-qqbot: ${tag} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
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
