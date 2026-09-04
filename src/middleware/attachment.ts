/**
 * 附件下载中间件 — 在中间件链中下载 file 附件
 *
 * 结果写入 ctx.state.downloadedFiles，供 handleInbound 读取。
 * 下载失败不阻断消息（记录告警后放行），确保附件异常不影响正常文本处理。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { downloadFileAttachments } from '../transport/attachment.js';
import type { ImQQBotConfig } from '../config.js';
import type { Logger, RawAttachment } from '../types.js';

export function attachmentProcessor(config: ImQQBotConfig, logger: Logger) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const msg = ctx.message as { attachments?: RawAttachment[]; messageId?: string };
    const cwd = config.cwd || process.cwd();
    const messageId = msg.messageId ?? 'unknown';

    try {
      const downloaded = await downloadFileAttachments(msg.attachments, cwd, messageId, logger);
      ctx.state.downloadedFiles = downloaded;
    } catch (err) {
      logger.warn(`im-qqbot: attachment download failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await next();
  };
}
