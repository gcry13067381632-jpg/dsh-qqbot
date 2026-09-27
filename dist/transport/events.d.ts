/**
 * 出站事件解析 — 将 dsh session/event 归一化为强类型
 *
 * 原始事件（ctx.on('session/event') 回调参数）是弱类型：
 *   { type: string, data: Record<string, unknown> }
 * 这里把可识别的事件解析为 discriminated union，未知类型或字段缺失返回 undefined。
 */
/** 原始 dsh 事件（弱类型，来自 ctx.on('session/event')） */
export interface RawSessionEvent {
    type: string;
    data: Record<string, unknown>;
}
/** turn/end 事件的 reason 结构（兼容 error/failure/顶层 message 三种形态） */
export interface TurnEndReason {
    kind?: string;
    error?: {
        message?: string;
        code?: string;
    };
    failure?: {
        message?: string;
        code?: string;
    };
    message?: string;
    code?: string;
}
/** assistant/chunk 事件（仅保留 text-delta） */
export interface ChunkEvent {
    type: 'assistant/chunk';
    text: string;
}
/** assistant/message 事件 */
export interface MessageEvent {
    type: 'assistant/message';
    content: Array<{
        type: string;
        text?: string;
    }>;
    /**
     * 本条的思考(reasoning 块拼接; 无思考或空壳块时 undefined)。
     *
     * 2026-09-13 加: 观察期**只作留档**, 不参与任何判定, 也绝不出站(详见 features/thinking-log.ts)。
     */
    reasoning?: string;
    /** dsh 回合号(思考与正文配对用: 同一 turn+step 才是"同一时刻格") */
    turn?: number;
    /** 回合内步号 */
    step?: number;
    /** 模型上报的思考 token 数(usage.reasoningTokens) */
    reasoningTokens?: number;
}
/** tool/call 事件 */
export interface ToolCallEvent {
    type: 'tool/call';
    callId: string;
    name: string;
    arguments: string;
}
/** tool/result 事件 */
export interface ToolResultEvent {
    type: 'tool/result';
    callId: string;
    error?: {
        name: string;
        code: string;
    };
    /** 原始 data 透传给 presenter 做结构化展示 */
    raw: Record<string, unknown>;
}
/** turn/end 事件 */
export interface TurnEndEvent {
    type: 'turn/end';
    reason: TurnEndReason;
}
/** 出站事件联合类型 */
export type OutboundEvent = ChunkEvent | MessageEvent | ToolCallEvent | ToolResultEvent | TurnEndEvent;
/**
 * 解析原始事件为强类型
 *
 * 未知类型或缺失关键字段时返回 undefined，由调用方直接跳过。
 */
export declare function parseEvent(raw: RawSessionEvent): OutboundEvent | undefined;
/**
 * 从 turn/end reason 提取错误信息
 *
 * 兼容三种形态：error（新格式）、failure（旧格式）、顶层 message/code（最旧格式）。
 */
export declare function extractTurnError(reason: TurnEndReason): {
    code: string;
    message: string;
} | undefined;
//# sourceMappingURL=events.d.ts.map