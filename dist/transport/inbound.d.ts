import type { SessionManager } from '../session/index.js';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
/**
 * 处理 QQ 入站消息（已经过 SDK 中间件链）
 */
export declare function handleInbound(rawMsg: unknown, manager: SessionManager, config: ImQQBotConfig, logger: Logger, state?: Record<string, unknown>): Promise<void>;
/**
 * Layer 3: 带发送者标签的用户消息
 * 引用消息功能开启时, 每条入站都带**短消息号**(msgRef, 形如 0913a; 群聊挂发送者标签, 私聊独立一行)
 * —— AI 想引用对方时在正文写 [rf:短号](2026-09-13 主人定: 短号省 token, 台账见 msg-index.ts)。
 * 群聊标签的形状(2026-09-15 定稿, 与历史行同口径):
 *   没被 @  → `[昵称 #短号]`            ← 不带 openid(省 token; 32 位 id 每行 20+ token)
 *   被 @ 了 → `[昵称 (openid) #短号]` + 正文后 ` (@you)`  ← 要回 @ 他/认人才给 id
 *   短号两边都留(引用标记 + id_lookup 反查 openid 的入口, 不能省)。
 */
export declare function buildUserMessage(userContent: string, quotePart: string, senderId: string, senderName: string | undefined, isGroup: boolean, wasMentioned: boolean, msgRef: string): string;
//# sourceMappingURL=inbound.d.ts.map