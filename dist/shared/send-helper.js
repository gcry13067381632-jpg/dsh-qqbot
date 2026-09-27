import { chunkMarkdownText } from '../transport/chunker.js';
/**
 * 分块发送 markdown（长内容自动切分）
 */
export async function sendMarkdownChunked(cmdCtx, content, chunkLimit) {
    const bot = cmdCtx.bot;
    const replyTarget = cmdCtx.replyTarget;
    const chunks = chunkMarkdownText(content, chunkLimit);
    for (const chunk of chunks) {
        await bot.sendMarkdown(replyTarget, chunk);
    }
}
//# sourceMappingURL=send-helper.js.map