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
}
/**
 * 构建增强版群历史缓冲中间件（API 对齐 SDK historyBuffer）：
 *   1. 把当前群消息(媒体 URL 折叠进 content)记入 store（去重按 messageId）；
 *   2. 向下游暴露 ctx.state.history = 已缓冲历史（不含当前消息，旧→新）。
 */
export declare function mediaHistoryBuffer(options: MediaHistoryOptions): Middleware;
//# sourceMappingURL=media-history.d.ts.map