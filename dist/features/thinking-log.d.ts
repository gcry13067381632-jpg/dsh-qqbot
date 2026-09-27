export interface ThinkingEntry {
    /** 会话范围: group / c2c */
    scope?: string;
    /** 群 openid 或私聊 openid */
    peerId?: string;
    /** dsh 回合号 */
    turn?: number;
    /** 回合内步号(与正文同格才可配对) */
    step?: number;
    /** 模型上报的思考 token 数(usage.reasoningTokens, 有则记) */
    tokens?: number;
    /** 思考全文 */
    text: string;
}
/**
 * 留一条思考。
 *
 * 只写文件, 不做任何判定 —— 调用方(出站路由)在**任何模式**下都该照记(包括 silent 潜水),
 * 因为"照常思考"本来就是 silent 的定义。
 */
export declare function noteThinking(dataRoot: string, entry: ThinkingEntry): void;
//# sourceMappingURL=thinking-log.d.ts.map