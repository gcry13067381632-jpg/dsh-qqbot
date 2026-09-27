/** 记住她刚发出的一段文本(key = 群 openid / 私聊 openid) */
export declare function rememberBotReply(key: string, text: string): void;
/** 取她最近一次发言（超过 10 分钟视为过期 —— 隔太久的那句跟当下语境无关） */
export declare function lastBotReplyOf(key: string, maxAgeMs?: number): {
    text: string;
    at: number;
} | undefined;
//# sourceMappingURL=bot-reply-memo.d.ts.map