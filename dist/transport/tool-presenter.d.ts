/**
 * 工具调用结果 → Markdown 格式化
 *
 * 参考 dsh-TUI 的 presentResult 机制（channel.ts presentResultView），
 * 适配 QQ 消息通道：优先用工具自定义的 presentResult 视图，
 * fallback 到 raw text。错误始终展示，成功结果按 config 开关。
 */
/** dsh-tools 主机平面注册表（presentResult 能力） */
export interface ToolsRegistryLike {
    get(name: string, scope?: unknown): {
        presentResult?(args: unknown, result: unknown): unknown;
    } | undefined;
}
/** 工具结果事件数据（tool/result） */
export interface ToolResultData {
    message: {
        content: Array<{
            type: string;
            content?: unknown;
            isError?: boolean;
        }>;
        source: {
            callId: string;
        };
    };
    error?: {
        name: string;
        code: string;
    };
    meta?: unknown;
}
/**
 * 将工具调用结果格式化为 Markdown 文本
 *
 * 返回 null 表示无需发送（无内容）。
 */
export declare function formatToolResult(name: string, rawArgs: string, data: ToolResultData, toolsRegistry: ToolsRegistryLike | undefined, agent: unknown): string | null;
//# sourceMappingURL=tool-presenter.d.ts.map