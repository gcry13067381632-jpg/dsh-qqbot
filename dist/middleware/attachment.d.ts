/**
 * 附件下载中间件 — 在中间件链中下载 file 附件
 *
 * 结果写入 ctx.state.downloadedFiles，供 handleInbound 读取。
 * 下载失败不阻断消息（记录告警后放行），确保附件异常不影响正常文本处理。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
export declare function attachmentProcessor(config: ImQQBotConfig, logger: Logger): (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;
//# sourceMappingURL=attachment.d.ts.map