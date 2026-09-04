/**
 * 入站处理器 — 经 SDK 中间件链处理后的消息 → dsh Agent followup
 *
 * 对齐 openclaw-qqbot body-assembler 的内容组装逻辑：
 * - Layer 1: userContent（文本 + 语音转录 + 附件描述）
 * - Layer 2: quotePart（引用消息块）
 * - Layer 3: userMessage（带发送者标签）
 * - Layer 4: dynamicCtx（媒体元数据）
 * - Layer 5: agentBody（history + base 拼合）
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionManager } from '../session/index.js';
import type { ImQQBotConfig } from '../config.js';
import type { ChatScope, Logger, RawAttachment, ReplyTarget } from '../types.js';
import type { DownloadedFile } from './attachment.js';
import { clearGroupHistory } from '../features/history-store.js';
import { applyInjectRules } from './inject-rules.js';

// ── 类型定义 ──

interface ProcessedMessage {
  rawEventType: string;
  kind: 'c2c' | 'group';
  senderId: string;
  senderName?: string;
  content: string;
  messageId: string;
  timestamp: string;
  groupOpenid?: string;
  msgType?: number;
  attachments?: RawAttachment[];
  [key: string]: unknown;
}

interface ResolvedQuote {
  text?: string;
  entry?: { senderId?: string; content?: string };
  attachments?: { contentType?: string; url?: string; filename?: string; asrText?: string }[];
}

interface HistoryEntry {
  senderId: string;
  senderName?: string;
  content: string;
  timestamp: number;
  messageId: string;
}

interface MentionState {
  wasMentioned?: boolean;
}

interface MiddlewareState {
  quote?: ResolvedQuote;
  history?: HistoryEntry[];
  envelope?: string;
  mention?: MentionState;
  /** 冷却派发标记：群内非@消息在冷却结束后被派发时由冷却中间件置 true（不打假 @you） */
  batchDispatch?: boolean;
  processedAttachments?: ProcessedAttachment[];
  downloadedFiles?: DownloadedFile[];
  [key: string]: unknown;
}

interface ProcessedAttachment {
  type: 'voice' | 'image' | 'video' | 'file' | 'unknown';
  filename?: string;
  url?: string;
  localPath?: string;
  voiceText?: string;
  voiceSource?: 'stt' | 'asr' | 'fallback';
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
}

// ── 主处理函数 ──

/**
 * 处理 QQ 入站消息（已经过 SDK 中间件链）
 */
export async function handleInbound(
  rawMsg: unknown,
  manager: SessionManager,
  config: ImQQBotConfig,
  logger: Logger,
  state?: Record<string, unknown>,
): Promise<void> {
  const msg = rawMsg as ProcessedMessage;
  const mwState = (state ?? {}) as MiddlewareState;

  const scope: ChatScope = msg.kind === 'group' ? 'group' : 'c2c';
  const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;

  const replyTarget: ReplyTarget = {
    scope,
    targetId: peerId,
    msgId: msg.messageId,
  };

  // ── 读取中间件已下载的文件（attachmentProcessor 写入 state.downloadedFiles） ──
  const downloaded = mwState.downloadedFiles ?? [];

  // ── 组装 agentBody（对齐 openclaw-qqbot body-assembler） ──
  let agentBody = assembleAgentBody(msg, mwState, scope, logger, downloaded);

  if (!agentBody) return;

  // 条件注入规则(配置化): 消息含图/链接/自定义条件时追加 [系统提示]。
  // 含内置读图兜底(未配置 hasImage 规则时自动生效, 行为与旧写死版一致)。
  // ⚠️ 本地手改功能（曾被重编译冲掉），改完务必保持 src 与部署 dist 同步。
  agentBody = applyInjectRules(agentBody, msg, config.injectRules, logger);

  // 群聊时间戳(原"群守则"拼接位): 守则已迁 systemPrompt.section(session-manager 装配期注册,
  // 每请求进 system, 不再每轮塞 user 历史); 此处改为注入当前系统时间, 让 AI 每轮知道日期/星期/时刻。
  if (scope === 'group') {
    const _now = new Date();
    const _p = (n: number): string => String(n).padStart(2, '0');
    const _wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][_now.getDay()];
    agentBody = `[当前时间 ${_now.getFullYear()}-${_p(_now.getMonth() + 1)}-${_p(_now.getDate())} ${_wd} ${_p(_now.getHours())}:${_p(_now.getMinutes())}]\n\n${agentBody}`;
  }

  logger.info(`Processing: scope=${scope} peerId=${peerId} body="${agentBody.slice(0, 200)}"`);

  // ── 获取或创建会话 ──
  let record;
  try {
    record = await manager.getOrCreate(scope, peerId, msg.senderId, replyTarget);
  } catch (err) {
    logger.error(`ERROR creating session: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── 工具自愈：setup 竞态漏装时补注册通道工具(幂等,几乎零开销) ──
  try {
    await manager.ensureChannelTools(record);
  } catch (err) {
    logger.debug(`ensureChannelTools error: ${err instanceof Error ? err.message : String(err)}`);
  }
  // ── 守则/身份 context 注册自愈(幂等; 重启恢复会话也覆盖, 保证 systemPrompt.context 注入生效) ──
  try {
    await manager.ensureGroupRules(record);
  } catch (err) {
    logger.debug(`ensureGroupRules error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 构建 UserMessage → followup ──
  const content: ContentBlock[] = [{ type: 'text' as const, text: agentBody }];

  const message = createUserMessage({
    content,
    source: { kind: 'user' as const },
  });

  record.agent.followup(message);
  logger.info(`→ followup sent: key=${scope}:${peerId}`);

  // 群消息回复后清空历史缓存（避免下次 @ 时重复组包，对齐 openclaw-qqbot dispatch）
  if (scope === 'group') {
    clearGroupHistory(config.appId, msg.groupOpenid ?? msg.senderId);
  }
}

// ══════════════════════════════════════════════════════════════
// Body Assembly（对齐 openclaw-qqbot 5 层组装）
// ══════════════════════════════════════════════════════════════

/**
 * 组装 agentBody — AI 实际看到的完整上下文
 */
function assembleAgentBody(
  msg: ProcessedMessage,
  state: MiddlewareState,
  scope: ChatScope,
  logger: Logger,
  downloaded: DownloadedFile[],
): string | null {
  const userContent = buildUserContent(msg, state, logger);

  if (!userContent && (!msg.attachments || msg.attachments.length === 0)) return null;

  const quotePart = buildQuotePart(state.quote);

  const isGroup = scope === 'group';
  const wasMentioned = state.mention?.wasMentioned ?? false;
  const batchDispatch = state.batchDispatch === true;
  const userMessage = buildUserMessage(userContent, quotePart, msg.senderId, msg.senderName, isGroup, wasMentioned);

  const dynamicCtx = buildDynamicCtx(msg, state, downloaded);

  const base = dynamicCtx ? `${dynamicCtx}${userMessage}` : userMessage;
  const agentBody = buildAgentBody(base, state.history, isGroup, wasMentioned, batchDispatch);

  return agentBody;
}

/**
 * Layer 1: 用户文本内容 + 语音 + 附件
 */
function buildUserContent(msg: ProcessedMessage, state: MiddlewareState, logger: Logger): string {
  const parts: string[] = [];

  const text = (msg.content ?? '').trim();
  if (text) {
    parts.push(text);
  }

  const voiceTexts = extractVoiceTexts(msg.attachments, state.processedAttachments, logger);
  if (voiceTexts.length > 0) {
    for (const vt of voiceTexts) {
      const durationTag = vt.duration ? ` (${vt.duration}s)` : '';
      parts.push(`[Voice message${durationTag}] ${vt.text}`);
    }
  }

  const otherAttachments = describeAttachments(msg.attachments, state.processedAttachments);
  if (otherAttachments) {
    parts.push(otherAttachments);
  }

  return parts.join('\n');
}

/**
 * Layer 2: 引用消息块
 */
function buildQuotePart(quote?: ResolvedQuote): string {
  if (!quote?.text && !quote?.entry?.content) return '';

  const quoteText = quote.text || quote.entry?.content || 'Original content unavailable';

  return `[Quoted message begins]\n${quoteText}\n[Quoted message ends]\n[Current message]\n`;
}

/**
 * Layer 3: 带发送者标签的用户消息
 */
function buildUserMessage(
  userContent: string,
  quotePart: string,
  senderId: string,
  senderName: string | undefined,
  isGroup: boolean,
  wasMentioned: boolean,
): string {
  if (!isGroup) {
    return `${quotePart}${userContent}`;
  }

  const mentionTag = wasMentioned ? ' (@you)' : '';
  const displayName = senderName ?? shortSenderId(senderId);
  const senderTag = `[${displayName} (${senderId})]`;
  return `${quotePart}${senderTag} ${userContent}${mentionTag}`;
}

/**
 * Layer 4: 媒体元数据上下文
 */
function buildDynamicCtx(msg: ProcessedMessage, state: MiddlewareState, downloaded: DownloadedFile[]): string {
  const lines: string[] = [];

  if (!msg.attachments || msg.attachments.length === 0) return '';

  const images = msg.attachments.filter(a => a.content_type === 'image');
  if (images.length > 0) {
    const urls = images.map(a => a.url).filter(Boolean);
    if (urls.length > 0) {
      lines.push(`- Images: ${urls.join(', ')}`);
    }
  }

  const voices = msg.attachments.filter(a => a.content_type === 'voice');
  if (voices.length > 0) {
    const asrTexts = voices.map(a => a.asr_refer_text).filter(Boolean);
    if (asrTexts.length > 0) {
      lines.push(`- ASR: ${asrTexts.join(' | ')}`);
    } else {
      // 无 ASR 识别结果时才带链接（纯文本模型无法消费音频，链接无意义）
      const urls = voices.map(a => a.url).filter(Boolean);
      if (urls.length > 0) {
        lines.push(`- Voice: ${urls.join(', ')}`);
      }
    }
  }

  const videos = msg.attachments.filter(a => a.content_type === 'video');
  if (videos.length > 0) {
    lines.push(`- Videos: ${videos.map(a => a.filename).join(', ')}`);
  }

  const files = msg.attachments.filter(a => a.content_type === 'file');
  if (files.length > 0) {
    for (const file of files) {
      const d = downloaded.find(x => x.filename === file.filename);
      if (d) {
        lines.push(`- File: ${file.filename} → ${d.displayPath}`);
      } else {
        lines.push(`- File: ${file.filename} (${formatFileSize(file.size)})`);
      }
    }
  }

  // 兜底：把所有带 URL 的附件链接暴露给 AI（未归类为 image 的也带上），方便桥接工具直接看图/附件
  const otherUrls = msg.attachments
    .filter(a => a.content_type !== 'image' && !!a.url)
    .map(a => a.url);
  if (otherUrls.length > 0) {
    lines.push(`- Attachment URLs: ${otherUrls.join(', ')}`);
  }

  if (lines.length === 0) return '';

  const quoteAttachments = state.quote?.attachments;
  if (quoteAttachments && quoteAttachments.length > 0) {
    lines.push('[Reference attachments]');
    for (const qa of quoteAttachments) {
      const label = qa.asrText ? `Voice: ${qa.asrText}` : (qa.filename ?? qa.contentType ?? 'attachment');
      lines.push(`  - ${label}`);
    }
  }

  return lines.join('\n') + '\n\n';
}

/**
 * Layer 5: 最终 agentBody 拼合
 */
function buildAgentBody(
  base: string,
  history: HistoryEntry[] | undefined,
  isGroup: boolean,
  wasMentioned: boolean,
  batchDispatch = false,
): string {
  // 群内：真实 @ 或冷却派发(batchDispatch)时，把累积的群历史打包给 AI（后者不打假 @you 标签）
  const includeHistory = isGroup && (wasMentioned || batchDispatch) && !!history && history.length > 0;
  if (!includeHistory) {
    return base;
  }

  const historyLines = history.map(h => {
    const name = h.senderName ?? shortSenderId(h.senderId);
    return `[${name} (${h.senderId})] ${h.content}`;
  });

  return [
    '[Chat history begins]',
    ...historyLines,
    '',
    '[Chat history ends]',
    '[Current message]',
    base,
  ].join('\n');
}

// ══════════════════════════════════════════════════════════════
// 辅助函数
// ══════════════════════════════════════════════════════════════

interface VoiceText {
  text: string;
  duration?: number;
  source: 'stt' | 'asr' | 'fallback';
}

function extractVoiceTexts(
  attachments?: RawAttachment[],
  processed?: ProcessedAttachment[],
  _logger?: Logger,
): VoiceText[] {
  const results: VoiceText[] = [];

  if (processed) {
    for (const pa of processed) {
      if (pa.type === 'voice' && pa.voiceText) {
        results.push({
          text: pa.voiceText,
          duration: pa.duration,
          source: pa.voiceSource ?? 'stt',
        });
      }
    }
  }

  if (results.length === 0 && attachments) {
    for (const att of attachments) {
      if (att.content_type === 'voice' && att.asr_refer_text) {
        results.push({
          text: att.asr_refer_text.trim(),
          source: 'asr',
        });
      }
    }
  }

  return results;
}

function describeAttachments(
  attachments?: RawAttachment[],
  _processed?: ProcessedAttachment[],
): string {
  if (!attachments || attachments.length === 0) return '';

  const parts: string[] = [];

  for (const att of attachments) {
    switch (att.content_type) {
      case 'voice':
        break;
      case 'image': {
        const dim = att.width && att.height ? ` ${att.width}×${att.height}` : '';
        parts.push(`[Image: ${att.filename}${dim}]`);
        break;
      }
      case 'video':
        parts.push(`[Video: ${att.filename}]`);
        break;
      case 'file':
        parts.push(`[File: ${att.filename} (${formatFileSize(att.size)})]`);
        break;
      default:
        parts.push(`[Attachment: ${att.filename ?? att.content_type}${att.url ? ` -> ${att.url}` : ''}]`);
        break;
    }
  }

  return parts.join('\n');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 发送者短标识长度（openid 前 N 位，无昵称时兜底） */
const SENDER_SHORT_ID_LEN = 8;

/** 无昵称时用 openid 前 N 位作为匿名标识 */
function shortSenderId(senderId: string): string {
  return senderId.slice(0, SENDER_SHORT_ID_LEN);
}
