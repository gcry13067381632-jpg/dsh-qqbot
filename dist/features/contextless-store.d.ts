/** 单个会话的无上下文设置 */
export interface ContextlessSetting {
    /** 是否对该会话开启"每轮丢历史" */
    enabled: boolean;
    /** 保留「@ 之前」多少条群消息（0 = 一条都不带，只留系统规则） */
    window: number;
}
/** 绑定 dataRoot（apply 时调一次；之后所有读写都落在这里） */
export declare function initContextlessStore(dataRoot: string): void;
/** 所有已知文件路径（诊断用） */
export declare function describeStorePaths(): string;
/**
 * 落盘追踪（2026-09-27 加，专治"静默失败"）：
 * 这个功能前后踩了 9 个坑，其中 8 个都不报错 —— 全靠反复试探。
 * 现在把「被调用 / 跳过原因 / 结果 / 异常」统统追加到 {dataRoot}/.qqbot/contextless-trace.log，
 * 一出问题先看这个文件，别再猜。
 */
export declare function traceContextless(line: string): void;
/** 诊断：当前绑定的文件路径（trace 用） */
export declare function describeStorePath(): string;
/** 读某会话的设置（未设置 → 默认关） */
export declare function getContextless(sessionKey: string): ContextlessSetting;
/** 写某会话的设置（dock 面板调用；只对有值的字段覆盖） */
export declare function setContextless(sessionKey: string, patch: Partial<ContextlessSetting>): ContextlessSetting;
/** 全表（给 dock 面板列出来） */
export declare function listContextless(): Record<string, ContextlessSetting>;
/** 删某会话的设置 */
export declare function clearContextless(sessionKey: string): boolean;
/** 会话是否处于"无上下文模式"（全局开 **或** 该会话单独开） */
export declare function isContextlessActive(sessionKey: string, globalEnabled?: boolean): boolean;
/** 该会话应携带的「@ 之前」群消息条数（会话级优先，其次全局默认 5） */
export declare function contextlessWindowOf(sessionKey: string, fallback?: number): number;
//# sourceMappingURL=contextless-store.d.ts.map