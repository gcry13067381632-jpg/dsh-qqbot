/**
 * 出站处理器 — dsh session/event → QQ 消息发送
 *
 * 采用路由器模式：OutboundRouter 持有会话级状态（文本缓冲、工具调用记录），
 * 事件解析归一化在 events.ts，路由按事件类型分发到私有方法。
 */
import type { SessionManager, SessionRecord } from '../session/index.js';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
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

/**
 * 出站路由器：持有会话级状态，按事件类型分发到处理器
 */
class OutboundRouter {
  private readonly buffers = new Map<string, OutboundBuffer>();
  private readonly toolCalls = new Map<string, ToolCallRecord>();
  /** 本回合群内已发送条数: >0 时后续消息去掉 msg_id 走主动(QQ 回复同一 msg 有限 ~4~5 条) */
  private turnGroupSent = 0;

  public constructor(
    private readonly manager: SessionManager,
    private readonly bot: QQBotSender,
    private readonly config: ImQQBotConfig,
    private readonly logger: Logger,
    private readonly toolsRegistry: ToolsRegistryLike | undefined,
  ) {}

  /** 出站目标: 群回合内已发过 >=1 条 → 去掉 msg_id 主动发(同面板); 首条/私聊保持被动回复 */
  private outTarget(record: SessionRecord) {
    if (this.turnGroupSent > 0 && record.replyTarget.scope === 'group' && record.replyTarget.targetId) {
      return { scope: record.replyTarget.scope, targetId: record.replyTarget.targetId } as never;
    }
    return record.replyTarget;
  }

  /** 事件分发入口 */
  public route(session: SessionLike, raw: RawSessionEvent): void {
    const event = parseEvent(raw);
    if (event === undefined) return;

    const record = this.manager.findBySessionId(session.header.id);
    if (record === undefined) return;

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
      buffer = new OutboundBuffer(record, this.bot, this.config.textChunkLimit, this.logger, this.shouldStream(record), this.config.cwd);
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

    const targetNow = this.outTarget(record);
    void this.send(record, targetNow, fullText, 'sendMarkdown');
    if (record.replyTarget.scope === 'group') this.turnGroupSent += 1;
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

    void this.send(record, record.replyTarget, text, 'sendToolResult');
  }

  /** 轮次结束：清理 buffer，异常结束时告知用户 */
  private onTurnEnd(sessionId: string, _record: SessionRecord, event: TurnEndEvent): void {
    this.turnGroupSent = 0; // 新回合重置(下一条主人消息的首条回复恢复被动)
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
      void this.send(_record, _record.replyTarget, `⚠️ 本轮异常结束\n\`${failure.code}\`: ${failure.message}`, 'sendTurnEndError');
    }

    this.logger.debug(`im-qqbot: turn/end sessionId=${sessionId}`);
  }

  /** 统一发送：富媒体感知 + 分块；媒体指令([MEDIA:..]/[RECALL])被剔除，失败降级记录 */
  private async send(_record: SessionRecord, target: unknown, text: string, tag: string): Promise<void> {
    try {
      await sendRichOutbound(
        this.bot,
        target as never,
        text,
        this.config.textChunkLimit,
        this.config.cwd,
        (m) => this.logger.error(m),
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
