/**
 * sticker-capture.ts — 表情包自动收藏中间件（P0）
 *
 * 群消息里的图片 → 收藏进本地表情包库（下载/去重/落盘在 sticker-store），
 * 并把「URL → 本地路径」记进 image-path-cache，供入站消息**直接写本地路径**
 * （2026-09-13 主人要求：看图不用再下载一次，token 也更短；下载失败自动回退 QQ 链接）。
 *
 * ⚠️ 时机关键：收藏调度必须放在 `await next()` 之前——
 * 未@机器人的群消息会在下游被 mentionGate 截断(链不走到结尾)，
 * 若收藏放在 next() 之后(finally)就永远不触发(线上已踩坑)。
 *
 * ⚠️ 2026-09-13 主人定稿：**只等"下载已发起"就放行**(即主链 0 等待)——
 *   下载 fire-and-forget 跑，落盘后把「URL→本地路径」补进 image-path-cache；
 *   消息组装时**检索得到就给本地路径，检索不到就回退 QQ 链接**(不影响正确性)。
 *   自动打标(视觉 CLI)同样永远后台，绝不挡主链。
 *
 * ⚠️ 本地手改功能（fork 新增）：维护清单见工作区根《插件改动维护注意事项.md》。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
export declare function stickerCapture(config: ImQQBotConfig, logger: Logger): (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;
//# sourceMappingURL=sticker-capture.d.ts.map