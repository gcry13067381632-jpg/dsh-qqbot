/**
 * 分块发送 markdown 工具
 *
 * 长内容自动按 QQ 消息限制切分后逐条发送。
 */
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
/**
 * 分块发送 markdown（长内容自动切分）
 */
export declare function sendMarkdownChunked(cmdCtx: SlashCommandHandlerContext, content: string, chunkLimit: number): Promise<void>;
//# sourceMappingURL=send-helper.d.ts.map