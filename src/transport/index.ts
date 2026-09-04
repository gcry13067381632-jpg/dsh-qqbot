/**
 * 传输层
 *
 * 协议对接：QQ 消息入站 / 出站 / Markdown 切分。
 */
export { handleInbound } from './inbound.js';
export { createOutboundHandler } from './outbound.js';
export { OutboundBuffer, type QQBotSender } from './outbound-buffer.js';
export { chunkMarkdownText } from './chunker.js';
