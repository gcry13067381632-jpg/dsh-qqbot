/** 按钮 data 前缀（与 `bp:` / `bpk:` / `bpc:` 并列，互不冲突） */
export declare const EXT_TOOL_CARD_PREFIX = "ext:";
/** 注册表文件（相对数据根） */
export declare const EXT_TOOL_CARD_FILE: string;
/** 默认有效期 7 天（工具的卡片通常就是"这一次投票/签到"用） */
export declare const EXT_TOOL_CARD_TTL_MS: number;
export interface ExtToolCardRecord {
    toolName: string;
    cardId: string;
    buttonIds: string[];
    /** 'group' | 'c2c'（无会话坐标时留空字符串） */
    scope: string;
    targetId: string;
    createdAt: number;
    expireAt: number;
}
export interface ExtToolCardHit extends ExtToolCardRecord {
    buttonId: string;
}
/**
 * 登记一张"带回调按钮"的卡片（由 `caps.registerInteractionCard` 调用）。
 * @returns true=已落盘；false=参数不合法/写失败（**调用方忽略即可**，发卡不受影响）
 */
export declare function registerExtToolCard(dataRoot: string, input: {
    toolName: string;
    cardId: string;
    buttonIds: string[];
    scope?: string;
    targetId?: string;
    ttlMs?: number;
}): boolean;
/**
 * 查"这个按钮属于哪张卡"（分发控制器用）。
 * @returns 命中记录（含 buttonId）；未命中 / 已过期 / 按钮不属于该卡 → null
 */
export declare function lookupExtToolCard(dataRoot: string, input: {
    toolName: string;
    cardId: string;
    buttonId: string;
}): ExtToolCardHit | null;
/**
 * 解析按钮 data：`ext:<toolName>:<cardId>:<buttonId>`。
 * ⚠️ 只看前缀 —— 不是 `ext:` 立刻返回 null（分发链据此"零打扰"地放过）。
 */
export declare function parseExtToolButtonData(data: unknown): {
    toolName: string;
    cardId: string;
    buttonId: string;
} | null;
/** 拼按钮 data（供示例/文档复用；工具自己拼也行，格式必须一致） */
export declare function extToolButtonData(toolName: string, cardId: string, buttonId: string): string;
//# sourceMappingURL=ext-tool-cards.d.ts.map