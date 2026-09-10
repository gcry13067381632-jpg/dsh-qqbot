/**
 * OutboundBuffer — 出站文本缓冲
 *
 * 收集流式 chunk，流式优先投递（StreamingWriter），降级为静态发送。
 * 独立文件便于单测。
 */
import type { SessionRecord } from '../session/index.js';
import type { Logger, ReplyTarget } from '../types.js';
import { chunkMarkdownText } from './chunker.js';
import { StreamingWriter } from './streaming-writer.js';
import {
  containsRecall,
  collectRecallIndices,
  parseOutbound,
  stripDirectives,
  resolveSource,
} from './rich-media.js';
import { stickerPerTurnCtx } from '../features/sticker-gate.js';

/** 流式输出节流间隔(ms)：连续 chunk 累积后停顿该间隔才推送 */
const STREAM_THROTTLE_MS = 200;

/** QQ 流式会话（openStream 返回） */
export interface StreamSessionLike {
  update(content: string): Promise<unknown>;
  complete(): Promise<unknown>;
}

/** QQ Bot 发送接口 */
export interface QQBotSender {
  sendMarkdown(target: ReplyTarget, content: string): Promise<unknown>;
  /** 发送带内联按钮(keyboard)的 markdown 消息 —— 审批卡片/提问卡片用 */
  sendMarkdownWithKeyboard(
    target: ReplyTarget,
    content: string,
    keyboard: unknown,
  ): Promise<unknown>;
  openStream(target: ReplyTarget): StreamSessionLike;
  /** 发送富媒体(图片/语音/视频/文件)；url/localPath 二选一；返回新消息 id(若可得) */
  sendMedia(
    target: ReplyTarget,
    kind: 'image' | 'video' | 'voice' | 'file',
    source: { url?: string; localPath?: string },
  ): Promise<{ id?: string }>;
  /** 撤本 bot 最近发给该 peer 的消息；成功返回 true */
  recallLast(target: ReplyTarget): Promise<boolean>;
  /** 撤本 bot 发给该 peer 的最近第 index 条(index=1 最近一条, 2 倒数第二条...)；成功返回 true */
  recallByIndex(target: ReplyTarget, index: number): Promise<boolean>;
  /** c2c 主动召回消息(官方 is_wakeup:true, 30天窗; 群聊目标应走 sendMarkdown)。2026-09-10 修跨会话 c2c 发送 */
  sendC2cWakeup(target: ReplyTarget, content: string): Promise<unknown>;
}

/**
 * 富媒体感知发送一段完整文本：
 *  1) 若整段为 [RECALL] 指令(去掉指令后无实质内容) → 触发 bot.recallLast
 *  2) 否则解析 [MEDIA:kind|src]，媒体段逐个 bot.sendMedia，文本段照常分块 sendMarkdown
 *  富媒体指令与 [RECALL] 从展示文本中剔除；任一失败不抛(逐项记录由调用方/logger)。
 *
 * resolveTarget(可选): 每次实际发送(每条媒体/每个文本分块)前调用一次, 返回该条的目标。
 * 用于「适配主动」出站: 同一条入站消息的连续回复数到限后自动切主动(去掉 msg_id)。
 * 注意: [RECALL] 撤回动作不消耗计数, 固定用传入 target。
 */
export async function sendRichOutbound(
  bot: QQBotSender,
  target: ReplyTarget,
  text: string,
  limit: number,
  cwd: string | undefined,
  logError?: (msg: string) => void,
  resolveTarget?: () => ReplyTarget,
): Promise<void> {
  const eff = (): ReplyTarget => (resolveTarget ? resolveTarget() : target);
  const hasRecall = containsRecall(text);
  const displayable = stripDirectives(text);
  // 只要含 [RECALL(:N)] 就执行，一条回复里多个 [RECALL] 逐个撤(可一次撤多条)；
  // 纯召回(去掉指令后无正文)且全未撤到 → 记录并停；否则继续发正文(正文已清所有指令，不会外显)
  if (hasRecall) {
    const indices = collectRecallIndices(text);
    let any = false;
    for (const idx of indices) {
      if (await bot.recallByIndex(target, idx)) any = true;
    }
    if (!any && !displayable.trim()) {
      logError?.('im-qqbot: [RECALL] 无可撤回消息或已超时');
      return;
    }
  } else if (!displayable.trim()) {
    return;
  }
  // 用原始 text 解析(保留 [MEDIA])：媒体段单独发送，文本段各自剔除残留 [RECALL]
  const segments = parseOutbound(text);
  // P1 表情包闸门: perTurn(每轮最多 N 张)。每轮=一次 sendRichOutbound(一轮 assistant 回复文本)。
  // 非表情包图(URL/库外文件/音视频)不计；真实闸门(禁群/频率/预算/去重/活性)在 sender.sendMedia 单点。
  const perTurn = stickerPerTurnCtx(cwd);
  let turnStickerSent = 0;
  for (const seg of segments) {
    if (seg.type === 'media') {
      const isStickerSeg = perTurn.isSticker(seg.kind, seg.source);
      if (isStickerSeg && perTurn.perTurnMax > 0 && turnStickerSent >= perTurn.perTurnMax) {
        // 本轮已达每轮上限：吞掉后续表情包图(不打扰正文/不回执, 防 LLM 换图重试刷闸)
        logError?.(`im-qqbot: 表情包闸门: 本轮已达每轮上限 ${perTurn.perTurnMax} 张, 已忽略后续表情包`);
        continue;
      }
      const src = resolveSource(seg.source, cwd);
      const sourceOpt = src.kind === 'url' ? { url: src.url } : { localPath: src.path };
      try {
        await bot.sendMedia(eff(), seg.kind, sourceOpt);
        if (isStickerSeg) turnStickerSent += 1;
      } catch (err) {
        if (err instanceof Error && err.name === 'StickerGateDenied') {
          logError?.(`im-qqbot: 表情包闸门拦截: ${err.message}`);
        } else {
          logError?.(`im-qqbot: 富媒体发送失败(${seg.kind}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else {
      const clean = stripDirectives(seg.text);
      if (!clean.trim()) continue;
      // QQ 对同会话极短时间连发多条会吞/乱序: 文本分块之间加 ~500ms 间隔限速
      const chunks = chunkMarkdownText(clean, limit).map((c) => String(c || '')).filter((c) => c.trim());
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci] as string;
        if (chunk.trim()) await bot.sendMarkdown(eff(), chunk);
        if (ci < chunks.length - 1) await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
}

export class OutboundBuffer {
  private buffer = '';
  private flushing = false;
  private readonly writer: StreamingWriter | null;

  public constructor(
    private readonly record: SessionRecord,
    private readonly bot: QQBotSender,
    private readonly limit: number,
    private readonly logger: Logger,
    streamingEnabled: boolean,
    private readonly cwd: string | undefined = undefined,
    private readonly resolveTarget?: () => ReplyTarget,
  ) {
    this.writer = streamingEnabled
      ? new StreamingWriter({ bot, target: record.replyTarget, logger, throttleMs: STREAM_THROTTLE_MS })
      : null;
  }

  /** 追加文本增量 */
  public append(text: string): void {
    this.buffer += text;
    this.writer?.append(text);
  }

  /** 获取当前累积文本 */
  public get text(): string {
    return this.buffer;
  }

  /** 发送所有累积文本：流式优先，降级静态 */
  public async flush(): Promise<void> {
    if (this.flushing || !this.buffer.trim()) return;
    this.flushing = true;

    try {
      if (this.writer) {
        await this.writer.finish();
        // 流式成功（未降级）→ 直接返回
        if (!this.writer.shouldFallback) return;
      }

      // 降级：静态发送（writer 不存在 or 流式失败）→ 富媒体感知发送
      await sendRichOutbound(
        this.bot,
        this.record.replyTarget,
        this.buffer,
        this.limit,
        this.cwd,
        (m) => this.logger.error(m),
        this.resolveTarget,
      );
    } catch (err) {
      this.logger.error(`im-qqbot: flush failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.buffer = '';
      this.flushing = false;
    }
  }

  /** 取消（异常/丢弃），中止流式并清空缓冲 */
  public cancel(): void {
    this.writer?.abort();
    this.buffer = '';
  }
}
