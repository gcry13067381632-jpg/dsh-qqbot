/**
 * QQ 表情标签 → 可读文本(名字优先, faceId 兜底)
 *
 * QQ 入站消息里表情有两种形态:
 *   老格式: [<face,id=0/>]                                  → id 直接查表
 *   新格式: <faceType=6,faceId="0",ext="base64">            → ext.text 优先, 空则按 faceId 查表
 *
 * ⚠️ 必须挂在 SDK contentSanitizer(parseFaceTags) **之前**: SDK 的正则
 * 只解 ext.text, text 为空会把 faceId 一起丢掉 → 输出"未知表情"。
 * 本层先把标签整体替换成可读文本, SDK 就再也匹配不到原标签了。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
/** 把消息 content 里的表情标签全部转成可读文本 */
export declare function resolveFaceTags(text: string): string;
/** 中间件: 在 SDK contentSanitizer 之前清洗表情标签(不依赖 SDK 的 parseFaceTags) */
export declare function faceTagResolver(): (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;
//# sourceMappingURL=face-tags.d.ts.map