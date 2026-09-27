import { downloadFileAttachments } from '../transport/attachment.js';
import { dataRootOf } from '../gateway/data-root.js';
export function attachmentProcessor(config, logger) {
    return async (ctx, next) => {
        const msg = ctx.message;
        const cwd = dataRootOf(config); // 附件缓存落数据根(dataRoot || cwd)
        const messageId = msg.messageId ?? 'unknown';
        try {
            const downloaded = await downloadFileAttachments(msg.attachments, cwd, messageId, logger);
            ctx.state.downloadedFiles = downloaded;
        }
        catch (err) {
            logger.warn(`im-qqbot: attachment download failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        await next();
    };
}
//# sourceMappingURL=attachment.js.map