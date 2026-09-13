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
import { inferMediaKind, mediaKindLabel } from './media-kind.js';
import { replaceBotMention, type MentionLike } from '../shared/mention-clean.js';
import { dataRootOf } from '../gateway/data-root.js';
import { registerMsgIndex } from './msg-index.js';

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
  /** 引用消息(message_type=103): 被引用消息原文(2026-09-13 引用消息功能) */
  messageType?: number;
  msgElements?: Array<{ content?: string; msg_idx?: string; message_type?: number }>;
  message_scene?: { ext?: string[] };
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
  /** 聚合投递标记(2026-09-07): 这批消息发生在 AI 上一轮回合进行中、由 debounce 攒到回合结束后
   *  统一入站 —— 时间上早于 AI 上一次回复, 不是对 AI 回复的回应。AI 读到要明白时间顺序。 */
  aggregated?: boolean;
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
  // 引用消息短消息号(2026-09-13 主人定): 入站登记到本地台账({dataRoot}/.qqbot/msg-index/{peer}/refs.json),
  // 注入**短号**(如 #0913a)替代长 msg_id 省 token; 出站 [rf:短号] 再查表还原完整 id。
  const refEnabled = config.messageReference !== false;
  let msgRef = '';
  if (refEnabled && msg.messageId) {
    try {
      msgRef = registerMsgIndex(dataRootOf(config), scope, peerId, msg.messageId, {
        senderId: msg.senderId,
        senderName: msg.senderName,
      });
    } catch { /* 台账落盘失败不影响消息流 */ }
  }
  let agentBody = assembleAgentBody(msg, mwState, scope, logger, downloaded, refEnabled, msgRef);

  if (!agentBody) return;

  // 条件注入规则(配置化): 消息含图/链接/自定义条件时追加 [系统提示]。
  // 含内置读图兜底(未配置 hasImage 规则时自动生效, 行为与旧写死版一致)。
  // ⚠️ 本地手改功能（曾被重编译冲掉），改完务必保持 src 与部署 dist 同步。
  agentBody = applyInjectRules(agentBody, msg, config.injectRules, logger, config.imageHint !== false);

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
  // ── qqChannel 上下文自愈: 恢复会话可能没 provide, 工具按本实例路由图库/定时需要它(幂等) ──
  try {
    await manager.ensureChannelContext(record);
  } catch (err) {
    logger.debug(`ensureChannelContext error: ${err instanceof Error ? err.message : String(err)}`);
  }
  // ── 守则/身份 context 注册自愈(幂等; 重启恢复会话也覆盖, 保证 systemPrompt.context 注入生效) ──
  try {
    await manager.ensureGroupRules(record);
  } catch (err) {
    logger.debug(`ensureGroupRules error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 构建 UserMessage → followup / (nothink) append 不唤醒 ──
  const content: ContentBlock[] = [{ type: 'text' as const, text: agentBody }];

  const message = createUserMessage({
    content,
    source: { kind: 'user' as const },
  });

  // 完全不思考(nothink, 2026-09-07 主人定): QQ 入站不唤醒 LLM, 但消息仍要进入上下文。
  // 组装好的完整 agentBody(含时间戳/发送者标签/历史)以 user/message append 进会话,
  // surfaceOp='append' 不唤醒 —— 下次 web 对话或真人消息唤醒时, AI 自然看到这段记录。
  if ((config as { outboundMode?: string }).outboundMode === 'nothink') {
    const a = record.agent as unknown as {
      whenIdle?: () => Promise<void>;
      session?: { append?: (type: string, data: unknown, opts?: { surfaceOp?: string }) => unknown };
    } | undefined;
    const sess = a?.session;
    if (sess && typeof sess.append === 'function') {
      try {
        // 🔒 等 LLM 回合结束再 append(主人硬约束 2026-09-09): 回合活跃时严禁 append(拆散 tool_calls 坏记录)
        if (typeof a.whenIdle === 'function') {
          try { await Promise.race([a.whenIdle(), new Promise((r) => setTimeout(r, 60_000))]); } catch { /* 超时/异常放弃写回 */ }
        }
        record.lastInboundAt = Date.now();
        sess.append('user/message', message, { surfaceOp: 'append' });
        logger.info(`[nothink] 已 append(不唤醒): key=${scope}:${peerId}`);
        // append 后同样清群历史缓存: 避免下次真人触发时把这段再打包一遍(上下文不重复)
        if (scope === 'group') {
          clearGroupHistory(config.appId, msg.groupOpenid ?? msg.senderId);
        }
        return;
      } catch (err) {
        logger.warn(`[nothink] append 失败, 退回正常 followup: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      logger.warn(`[nothink] 会话无 append 能力, 退回正常 followup: key=${scope}:${peerId}`);
    }
    // 无 append 能力 → 兜底照常 followup(保证消息不丢, 但会唤醒; 罕见路径)
    record.lastInboundAt = Date.now();
    record.turnActive = true;
    record.agent.followup(message);
    logger.info(`→ followup sent(nothink 兜底): key=${scope}:${peerId}`);
    return;
  }

  record.lastInboundAt = Date.now();
  // 置回合活跃(消息聚合, 2026-09-07): followup 发出即算回合开始, debounce 见忙攒消息; turn/end 由 outbound 复位
  record.turnActive = true;
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
  enableRef: boolean,
  msgRef: string,
): string | null {
  const userContent = buildUserContent(msg, state, logger);

  if (!userContent && (!msg.attachments || msg.attachments.length === 0)) return null;

  let quotePart = buildQuotePart(state.quote);
  // 引用消息(2026-09-13): SDK 中间件没解析出 quote 时, 自己从 103/msg_elements 提取被引用原文
  if (!quotePart && enableRef) {
    const quoted = extractQuotedContent(msg);
    if (quoted) quotePart = `[Quoted message begins]\n${quoted}\n[Quoted message ends]\n[Current message]\n`;
  }

  const isGroup = scope === 'group';
  const wasMentioned = state.mention?.wasMentioned ?? false;
  const batchDispatch = state.batchDispatch === true;
  const aggregated = state.aggregated === true;
  const userMessage = buildUserMessage(userContent, quotePart, msg.senderId, msg.senderName, isGroup, wasMentioned, msgRef);

  const dynamicCtx = buildDynamicCtx(msg, state, downloaded);

  const base = dynamicCtx ? `${dynamicCtx}${userMessage}` : userMessage;
  // ⚠️ 2026-09-10 去重(主人: "图片链接重复两次"): 聚合/冷却重新派发时, 同一条消息会**既被
  //   mediaHistoryBuffer 记进历史、又作为当前消息出现** → 同一条消息(含媒体 URL)在上下文里出现
  //   两遍: 历史里是 `[昵称] [图片: url]`(foldMedia 折叠版), 当前是 Layer4 的 `- Image: 名 → url`。
  //   按 messageId 剔掉历史中与当前消息重复的那条。
  const history = (state.history ?? []).filter(h => !h.messageId || h.messageId !== msg.messageId);
  const agentBody = buildAgentBody(base, history, isGroup, wasMentioned, batchDispatch, aggregated);

  return agentBody;
}

/**
 * Layer 1: 用户文本内容 + 语音 + 附件
 */
function buildUserContent(msg: ProcessedMessage, state: MiddlewareState, logger: Logger): string {
  const parts: string[] = [];

  // 2026-09-11 主人要求: 入站 @bot 长 openid 转短标记 @bot 省 token(精确按 mentions.is_you 替换)
  const text = replaceBotMention(
    (msg.content ?? '').trim(),
    (msg as { mentions?: MentionLike[] }).mentions,
    state.mention?.wasMentioned,
  );
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
 * 引用消息原文提取(2026-09-13 主人定): 收到引用消息(message_type=103)时,
 * msg_elements[] 里带被引用消息的原文; 只有标记没有内容时退化为引用索引提示。
 */
function extractQuotedContent(msg: ProcessedMessage): string {
  const els = Array.isArray(msg.msgElements) ? msg.msgElements : [];
  const texts = els.map((e) => e?.content).filter((t): t is string => Boolean(t));
  if (texts.length > 0) return texts.join('\n');
  const ext = Array.isArray(msg.message_scene?.ext) ? msg.message_scene.ext : [];
  const refIdx = ext.find((x) => typeof x === 'string' && x.startsWith('ref_msg_idx='));
  if (refIdx) return `(被引用消息索引: ${refIdx.slice('ref_msg_idx='.length)})`;
  return '';
}

/**
 * Layer 3: 带发送者标签的用户消息
 * 引用消息功能开启时, 每条入站都带**短消息号**(msgRef, 形如 0913a; 群聊挂发送者标签, 私聊独立一行)
 * —— AI 想引用对方时在正文写 [rf:短号](2026-09-13 主人定: 短号省 token, 台账见 msg-index.ts)。
 */
function buildUserMessage(
  userContent: string,
  quotePart: string,
  senderId: string,
  senderName: string | undefined,
  isGroup: boolean,
  wasMentioned: boolean,
  msgRef: string,
): string {
  if (!isGroup) {
    const idPart = msgRef ? `[消息号: ${msgRef}]\n` : '';
    return `${quotePart}${idPart}${userContent}`;
  }

  const mentionTag = wasMentioned ? ' (@you)' : '';
  const displayName = senderName ?? shortSenderId(senderId);
  const senderTag = msgRef ? `[${displayName} (${senderId}) #${msgRef}]` : `[${displayName} (${senderId})]`;
  return `${quotePart}${senderTag} ${userContent}${mentionTag}`;
}

/**
 * Layer 4: 媒体元数据上下文
 */
function buildDynamicCtx(msg: ProcessedMessage, state: MiddlewareState, downloaded: DownloadedFile[]): string {
  const lines: string[] = [];

  if (!msg.attachments || msg.attachments.length === 0) return '';

  // 本段(Layer 4)是**附件的唯一权威描述**: 一行一个附件, 含「类型 + 文件名 + 尺寸/大小 + 取值」。
  // 因此 Layer 1 的 describeAttachments 对带 URL 的附件不再输出(见该函数注释), 保证一个附件只出现一次。
  //
  // ⚠️ 2026-09-10 根因修复(主人实测: "视频还是附件形式, 图片也变成附件了"):
  //   原来按 `content_type` 分流 —— 但 QQ 群聊里**图片/视频的 content_type 实测就是 `'file'`**,
  //   于是图片视频全被塞进 `- File:` 行, dock(chatAttachmentKind 见 `- File:`)渲染成 `📎 download`。
  //   改为按 inferMediaKind() 推断真实类型, 用**显式类型前缀**输出:
  //     `- Image: 名 (850×651) → url` / `- Video: 名 → url` / `- Voice: 名 → url` / `- File: 名 (1.2MB) → 路径|url`
  //   好处: ① AI 能分清哪个 URL 是图/视频/语音(旧的纯 URL 汇总行做不到, 主人已指出);
  //        ② dock 认类型前缀 → 图片直显、视频可播、语音可放;
  //        ③ 语音的 ASR 转录在 Layer 1 的 `[Voice message] 文本` 里, 此处只给 URL(不重复)。
  for (const att of msg.attachments) {
    const kind = inferMediaKind(att);
    // 元信息(文件名 + 图片尺寸 / 文件大小)并入同一行 —— Layer 1 因此不必再重复描述一遍附件。
    const dim = kind === 'image' && att.width && att.height ? `(${att.width}×${att.height})` : '';
    const size = kind === 'file' && att.size ? `(${formatFileSize(att.size)})` : '';
    const meta = [att.filename, dim, size].filter(Boolean).join(' ');
    const head = meta ? `${meta} ` : '';
    if (kind === 'file') {
      // 文件: 有本地落盘路径就给路径(便于 AI 直接读盘), 否则回退原始 URL。
      const d = downloaded.find(x => x.filename === att.filename);
      const target = d?.displayPath ?? att.url;
      if (target) lines.push(`- File: ${head}→ ${target}`);
      continue;
    }
    if (!att.url) continue;
    lines.push(`- ${mediaKindLabel(kind)}: ${head}→ ${att.url}`);
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
  aggregated = false,
): string {
  // 群内：真实 @ 或冷却派发(batchDispatch)时，把累积的群历史打包给 AI（后者不打假 @you 标签）
  const includeHistory = isGroup && (wasMentioned || batchDispatch) && !!history && history.length > 0;

  // 聚合投递提示(2026-09-07 主人定): 这些消息是我上一轮回合进行中群友发的, 攒到回合结束
  // 才统一入站 —— 时间上早于我的上一次回复, 不是群友在回复我。必须显式说明, 否则 AI 会
  // 误以为它们是"我回完之后群友接着说的"(dsh 队列特性: 攒的消息看起来像新的一轮)。
  const aggregatedNote = aggregated
    ? '[系统提示] 以下消息(含上方历史与当前消息)发生在你上一次回复之前——是你在思考/输出期间，群友陆续发出的消息，由系统攒到你这轮回合结束后统一送入。它们不是对你回复的回应，请不要把它们当成新的一轮对话；请通读后综合回应（如需回应）。\n\n'
    : '';

  if (!includeHistory) {
    // 私聊等无历史打包场景: 聚合提示直接置于正文前
    return aggregatedNote + base;
  }

  const historyLines = history.map(h => {
    const name = h.senderName ?? shortSenderId(h.senderId);
    // 2026-09-12 token 瘦身(主人定): 历史行默认**只给昵称**; 只有"当时 @ 过 bot 的那条"带 openid ——
    // 32 位 openid 每行占 20+ token, limit=20 时每轮白烧 ~640; 要 id 时用 session_list / 台账反查。
    const mentioned = (h as { mentioned?: boolean }).mentioned === true;
    return mentioned && h.senderId ? `[${name} (${h.senderId})] ${h.content}` : `[${name}] ${h.content}`;
  });

  return [
    aggregated ? '[系统提示] 以下历史与当前消息发生在你上一次回复之前(你思考/输出期间群友所发, 非对你的回应), 请通读后综合回应。' : '',
    '[Chat history begins]',
    ...historyLines,
    '',
    '[Chat history ends]',
    '[Current message]',
    base,
  ].filter(Boolean).join('\n');
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

  // ⚠️ 2026-09-10 去重(主人: "图片链接重复两次, 那不是又回原来的长上下文咯?"):
  //   带 URL 的附件已由 Layer 4 的 `- Image: 名 (850×651) → url` 一行完整描述(类型+名+尺寸+URL),
  //   本层**不再重复输出** —— 只有"没有 URL"的附件才在这里兜底做文字描述(Layer 4 给不出链接时)。
  //   效果: 当前消息里一个附件只占一行(此前是 `[Image: 名 尺寸]` + `- Image: 名 → url` 两行)。
  for (const att of attachments) {
    const kind = inferMediaKind(att);
    if (kind === 'voice') continue; // 语音正文由 `[Voice message] 转录` 承接(不含 URL, 本就不重复)
    if (att.url) continue;          // 有 URL → Layer 4 已给完整一行
    switch (kind) {
      case 'image': {
        const dim = att.width && att.height ? ` ${att.width}×${att.height}` : '';
        parts.push(`[Image: ${att.filename}${dim}]`);
        break;
      }
      case 'video':
        parts.push(`[Video: ${att.filename}]`);
        break;
      default:
        parts.push(`[File: ${att.filename} (${formatFileSize(att.size)})]`);
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
