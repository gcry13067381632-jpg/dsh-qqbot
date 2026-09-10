/**
 * media-history.ts — 增强版群历史缓冲（媒体 URL 可见）
 *
 * 替换 SDK 的 historyBuffer：SDK 版记历史时只存文本 content，
 * 图片消息 content 为空 → 历史里的图对 AI 不可见（看不到图片链接）。
 * 本中间件在记录时把带 URL 的附件折叠成 "[图片: <url>]" 等文本并入 content，
 * 让冷却派发 / 下次 @ 打包群历史时，图片/媒体链接也进 AI 上下文。
 *
 * ⚠️ 本地手改功能（SDK 无此能力，重编译/换回 SDK 原版会丢）：
 *    维护清单见工作区根《插件改动维护注意事项.md》。
 */
import type { Middleware, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { HistoryEntry, HistoryStore } from '@tencent-connect/qqbot-nodejs';
import { inferMediaKind } from '../transport/media-kind.js';

export interface MediaHistoryOptions {
  /** 每群保留的最大条数 */
  limit: number;
  /** 存储后端（共享单例，供回复后清空） */
  store: HistoryStore;
  /** 上游 stop 后仍记录（捕获未 @ 的闲聊） */
  recordOnSkip: boolean;
  /** 群 key 推导（带 appId 前缀） */
  groupKey: (ctx: MiddlewareContext) => string | undefined;
  /** 命中此条件的消息不进群历史(但仍放行下游)。用于斜杠命令——命令无需喂给 AI */
  skipWhen?: (ctx: MiddlewareContext) => boolean;
}

/** 消息最小形状（只读所需字段，避免依赖 SDK 完整类型） */
interface FoldableMsg {
  content?: string;
  attachments?: Array<{ content_type?: string; url?: string; asr_refer_text?: string }>;
}

/** 文本 + 带 URL 附件折叠为一行段。
 *  ⚠️ 2026-09-10 主人纠正两点:
 *  ① **语音 URL 不能跳过** —— dock 的仿 QQ 聊天界面靠它调 /chat/voice-play 把 SILK 转 mp3 播放;
 *  ② **语音的 ASR 转录要一并记入** —— 否则历史(冷却派发/批量打包)里只剩一条音频链接,
 *     AI 看不到"这条语音说了什么"(2026-09-10 主人实测发现)。
 *  格式约定(与 dock chatSplitMedia 对齐):
 *    转录独立成一行纯文本 → dock 当普通文本显示(不套 📎 附件样式);
 *    `[语音: <url>]` 单独一行 → dock 的 chatAttachmentKind 认 `[语音` 判 voice 并建播放器。 */
function foldMedia(msg: FoldableMsg): string {
  const parts: string[] = [];
  const text = (msg.content ?? '').trim();
  if (text) parts.push(text);
  for (const att of msg.attachments ?? []) {
    if (!att.url) continue;
    // ⚠️ 2026-09-10: 类型一律走 inferMediaKind 推断 —— QQ 群聊图片/视频的 content_type
    //    实测是 'file', 按 content_type 判断会把历史里的视频/图片折成 `[文件: url]`
    //    (dock 显示成 📎 附件, 且 AI 也分不清类型)。
    const kind = inferMediaKind(att);
    if (kind === 'voice') {
      const asr = String(att.asr_refer_text ?? '').trim();
      if (asr) parts.push(asr);                     // 转录(纯文本行)
      parts.push(`[语音: ${att.url}]`);               // 音频链接(带标签, dock 判 voice)
      continue;
    }
    const label = kind === 'image' ? '图片'
      : kind === 'video' ? '视频'
        : kind === 'file' ? '文件' : '附件';
    parts.push(`[${label}: ${att.url}]`);
  }
  return parts.join('\n');
}

/**
 * 构建增强版群历史缓冲中间件（API 对齐 SDK historyBuffer）：
 *   1. 把当前群消息(媒体 URL 折叠进 content)记入 store（去重按 messageId）；
 *   2. 向下游暴露 ctx.state.history = 已缓冲历史（不含当前消息，旧→新）。
 */
export function mediaHistoryBuffer(options: MediaHistoryOptions): Middleware {
  const { limit, store, recordOnSkip, groupKey, skipWhen } = options;
  return async (ctx: MiddlewareContext, next: () => Promise<void>) => {
    const key = groupKey(ctx);
    if (!key) {
      await next();
      return;
    }
    const buffered = await store.list(key, limit);
    ctx.state.history = buffered;
    // 命中 skipWhen(如已知斜杠命令) → 不进 AI 历史, 直接放行下游由命令层处理
    if (skipWhen && skipWhen(ctx)) {
      await next();
      return;
    }
    const raw = ctx.message as unknown as FoldableMsg;
    const entry: HistoryEntry = {
      senderId: ctx.message.senderId,
      senderName: ctx.message.senderName,
      content: foldMedia(raw),
      timestamp: Date.parse(ctx.message.timestamp) || Date.now(),
      messageId: ctx.message.messageId,
    };
    try {
      await store.append(key, entry, limit);
    } catch (err) {
      ctx.log.error?.(`[media-history] append failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (ctx.stopped && !recordOnSkip) {
      return;
    }
    await next();
  };
}
