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
import type { HistoryStore } from '@tencent-connect/qqbot-nodejs';
import { type MentionLike } from '../shared/mention-clean.js';
import { type ResolvedQuote } from '../transport/inbound.js';
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
    /** bot 自身 appId —— 判定"这条 @ 了她"时做内容兜底扫描用 */
    appId?: string;
    /** 图库目录: 引用块里"被引用的图片"转本地路径用(缺省只走 URL→路径缓存) */
    stickerDir?: string;
}
/** 消息最小形状（只读所需字段，避免依赖 SDK 完整类型） */
export interface FoldableMsg {
    content?: string;
    attachments?: Array<{
        content_type?: string;
        url?: string;
        asr_refer_text?: string;
    }>;
    /** QQ mentions 数组(含 is_you 标记 bot 自身), 用于入站 @bot 长 id 清洗 */
    mentions?: MentionLike[];
    wasMentioned?: boolean;
    /** 平台事件类型: GROUP_AT_MESSAGE_CREATE = 有人 @ 了 bot(平台权威信号) */
    rawEventType?: string;
}
/** 文本 + 带 URL 附件折叠为一行段。
 *  ⚠️ 2026-09-10 主人纠正两点:
 *  ① **语音 URL 不能跳过** —— dock 的仿 QQ 聊天界面靠它调 /chat/voice-play 把 SILK 转 mp3 播放;
 *  ② **语音的 ASR 转录要一并记入** —— 否则历史(冷却派发/批量打包)里只剩一条音频链接,
 *     AI 看不到"这条语音说了什么"(2026-09-10 主人实测发现)。
 *  格式约定(与 dock chatSplitMedia 对齐):
 *    转录独立成一行纯文本 → dock 当普通文本显示(不套 📎 附件样式);
 *    `[语音: <url>]` 单独一行 → dock 的 chatAttachmentKind 认 `[语音` 判 voice 并建播放器。 */
export declare function foldMedia(msg: FoldableMsg, quote?: ResolvedQuote, stickerDir?: string, gid?: string): string;
/**
 * 构建增强版群历史缓冲中间件（API 对齐 SDK historyBuffer）：
 *   1. 把当前群消息(媒体 URL 折叠进 content)记入 store（去重按 messageId）；
 *   2. 向下游暴露 ctx.state.history = 已缓冲历史（不含当前消息，旧→新）。
 */
export declare function mediaHistoryBuffer(options: MediaHistoryOptions): Middleware;
//# sourceMappingURL=media-history.d.ts.map