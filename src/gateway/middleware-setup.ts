/**
 * SDK 中间件编排
 *
 * 根据插件配置组装 SDK 内置中间件链（洋葱模型）。
 * 中间件负责过滤与上下文富化；最终消息统一由 bot.on('message') 处理转发。
 */
import type { QQBot, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import {
  errorHandler,
  messageFilter,
  accessPolicy,
  mentionGate,
  contentSanitizer,
  slashCommand,
  concurrencyGuard,
  typingIndicator,
  quoteRef,
  envelopeFormatter,
} from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.js';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';
import { buildCommandList } from '../commands/index.js';
import { attachmentProcessor } from '../middleware/attachment.js';
import { mediaHistoryBuffer } from '../middleware/media-history.js';
import { stickerCapture } from '../middleware/sticker-capture.js';
import { getHistoryStore, historyGroupKey } from '../features/history-store.js';
import { stickerActivityRecorder } from '../features/sticker-gate.js';
import { chatLedgerRecorder } from '../features/chat-ledger.js';
import { join } from 'node:path';

export function setupMiddlewares(
  bot: QQBot,
  config: ImQQBotConfig,
  manager: SessionManager,
  logger: Logger,
): void {
  // 1. 错误兜底（最外层洋葱皮）
  bot.use(errorHandler());

  // 2. 消息过滤：bot 回声 + 消息去重
  bot.use(messageFilter({ skipSelfEcho: false }));

  // 3. 访问控制（白名单/开放/禁用）
  bot.use(accessPolicy({
    c2c: {
      mode: config.access.c2cMode,
      allow: config.access.c2cAllow.length > 0 ? config.access.c2cAllow : ['*'],
    },
    group: {
      mode: config.access.groupMode,
      allow: config.access.groupAllow.length > 0 ? config.access.groupAllow : ['*'],
    },
    onBlock: (_mCtx, reason) => {
      if (config.debug) {
        logger.debug(`Access blocked: ${reason}`);
      }
    },
  }));

  // 4. 群历史缓冲 — 放在门控之前，确保所有消息（含未 @bot）都计入上下文
  //    store 走共享单例（getHistoryStore），groupKey 带 appId 前缀，供回复后清空
  //    ⚠️ 用增强版 mediaHistoryBuffer(本地手改，替代 SDK historyBuffer)：
  //       记历史时把带 URL 的附件折叠进 content，冷却期群友发的图/媒体在历史里也带链接
  bot.use(mediaHistoryBuffer({
    limit: config.historyLimit,
    store: getHistoryStore(),
    recordOnSkip: true,
    groupKey: (ctx) => {
      const gid = ctx.message.groupOpenid;
      if (ctx.message.kind !== 'group' || !gid) return undefined;
      return historyGroupKey(config.appId, gid);
    },
  }));

  // 4.5. 表情包自动收藏（P0）：群图片 → 本地图库（fire-and-forget，不阻塞主链）
  bot.use(stickerCapture(config, logger));

  // 4.6. 表情包闸门活性计数（P1）：记录所有群消息时间戳 → RingBuffer，供"热闹才发"判定。
  //     ⚠️ 必须在 mentionGate(第5步) 之前：未@消息被门控截断也照样计数。
  //     多账号: 每实例传自己 dataDir(各号各闸门状态)。
  bot.use(stickerActivityRecorder(config.sticker.dataDir || join(config.cwd || process.cwd(), '表情包')));

  // 4.7. 聊天台账（M3）：记录机器人见过的群/私聊(带昵称) → known-chats.jsonl，
  //     供 Web ④区定时唤醒"点选聊天对象"(不用抄 openid)。也在 mentionGate 之前。
  const ledgerDataDir = config.sticker.dataDir || join(config.cwd || process.cwd(), '表情包');
  bot.use(chatLedgerRecorder(ledgerDataDir));

  // 5. 群聊 @bot 门控
  bot.use(mentionGate({
    requireMentionInGroup: config.requireMention,
  }));

  // 6. 内容清洗（去 @marker、表情标签、多余空白）
  bot.use(contentSanitizer({
    parseFaceTags: true,
  }));

  // 7. 回复冷却调度(配置化, 替代写死 REPLY_COOLDOWN_MS=60000)：照常接收并记录所有群消息
  //    (mediaHistoryBuffer 已在上方记录), 但每群按 config.behavior 间隔才真正派发一次给 AI。
  //    ⚠️ 本地手改功能（曾被重编译冲掉），改完务必保持 src 与部署 dist 同步。
  //    ⚠️ 每次调用现读 config.behavior(勿外层解构)——支持 Web settings live 热更新。
  const lastDispatchAt = new Map<string, number>(); // groupOpenid -> 上次派发时间(ms)
  bot.use(async (ctx: MiddlewareContext, next: () => Promise<void>) => {
    // 私聊/无群号：不纳入调度，直接放行
    if (ctx.message.kind !== 'group' || !ctx.message.groupOpenid) {
      return next();
    }
    const { freeIntervalSec, mentionIntervalSec } = config.behavior;
    const gid = ctx.message.groupOpenid;
    const wasMentioned = ctx.state.mention?.wasMentioned === true;
    const intervalSec = wasMentioned ? mentionIntervalSec : freeIntervalSec;
    // 适用间隔=0：不冷却直接放行(@立即回；无@放行后是否到 AI 由 requireMention 门控决定)
    if (intervalSec <= 0) {
      return next();
    }
    const now = Date.now();
    const last = lastDispatchAt.get(gid) ?? 0;
    if (now - last < intervalSec * 1000) {
      // 冷却期内：消息已被 mediaHistoryBuffer 记进群历史，本次不派发 → 不调 next()
      return;
    }
    // 冷却结束：派发当前消息。用独立的 batchDispatch 标记，让下游把累积的群历史一起打包
    //（不伪装成 @you，避免出现假 (@you) 标签误导 AI）
    lastDispatchAt.set(gid, now);
    ctx.state.batchDispatch = true;
    return next();
  });

  // 8. 斜杠命令（在 concurrencyGuard 之前，命令匹配后不排队直接响应）
  const slash = slashCommand({
    autoHelp: true,
    commands: buildCommandList({ manager, config }),
  });
  bot.use(slash.middleware);

  // 9. 并发串行 + 消息合并（同 peer 排队，避免 session 冲突）
  bot.use(concurrencyGuard({
    strategy: 'merge',
    maxQueue: config.maxQueue,
    maxProcessingMs: config.processingTimeoutMs,
    urgentPredicate: (mCtx: MiddlewareContext) => {
      return (mCtx.message.content ?? '').trim() === '/bot-stop';
    },
  }));

  // 10. C2C 输入状态指示
  bot.use(typingIndicator());

  // 11. 引用消息解析（记录 + 解析被引用原文）
  bot.use(quoteRef({
    maxSize: 500,
    preferMsgElements: true,
  }));

  // 11.5. 附件下载（file 附件下载到本地，供 @提及 / 工具访问）
  bot.use(attachmentProcessor(config, logger));

  // 12. 上下文组装（将 history + quote + sender 组成 envelope）
  bot.use(envelopeFormatter({
    historyLimit: config.historyLimit,
    includeQuote: true,
    includeSender: true,
  }));
}
