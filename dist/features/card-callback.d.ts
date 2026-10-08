/** 卡片按钮 data 前缀（区别于 botplay 的 `bp:` 与目录卡的 `bpc:`） */
export declare const CARD_BTN_PREFIX = "bpk:";
/** 按钮动作类型 */
export type CardButtonAction = 'text' | 'cmd' | 'url';
export interface CardCallbackButton {
    /** 卡片内按钮短 id（b1/b2…），与 cardId 拼成 data */
    id: string;
    label: string;
    action: CardButtonAction;
    /** text=要回的文本；cmd=指令名(不带 /)；url=跳转地址 */
    payload: string;
}
export interface CardCallbackCard {
    cardId: string;
    buttons: CardCallbackButton[];
    createdAt: number;
    expireAt: number;
    /** 发到哪(仅诊断用) */
    scope?: 'group' | 'c2c';
    targetId?: string;
}
export declare function cardCallbacksPath(dataRoot: string): string;
/** 追加一张卡片（顺带清理过期项、按上限截断）；host 侧发卡时也会写同一文件 */
export declare function appendCardCallback(dataRoot: string, card: CardCallbackCard): void;
/** 按 cardId 查卡（过期返回 undefined） */
export declare function findCardCallback(dataRoot: string, cardId: string): CardCallbackCard | undefined;
/** 从 interaction 的 button_data 解析 cardId + buttonId；非本模块按钮返回 null */
export declare function parseCardButtonData(data: string | undefined): {
    cardId: string;
    buttonId: string;
} | null;
/**
 * 命令执行器签名（与 botplay 指令型按钮一致：给命令名与回复目标，返回要发的文本）。
 * ⚠️ 2026-10-08 补第三参 `actorOpenid`：**点击者本人**的 openid。
 *   以前这条链路不带身份（bootstrap 侧写死空串）⇒ 签到/按人统计这类"指令型按钮"做不了。
 */
export type CardCommandExecutor = (cmdName: string, target: unknown, actorOpenid?: string) => Promise<string>;
export interface CardCallbackDeps {
    dataRoot: string;
    /** 发文本(群/私聊通用; 由 bootstrap 注入真实 sender) */
    sendText: (target: unknown, text: string) => Promise<void>;
    /** 执行斜杠命令(不带 /)；未注入时指令按钮只提示不可用 */
    commandExecutor?: CardCommandExecutor;
    logger?: {
        info?(m: string, ...a: unknown[]): void;
        warn?(m: string, ...a: unknown[]): void;
    };
}
/**
 * 卡片按钮回调处理器：bootstrap 的 interaction 分发链**最后一环**。
 * @returns true = 已消费（调用方无需其它处理）
 */
export declare function createCardCallbackController(deps: CardCallbackDeps): {
    handleInteraction(event: unknown, target: unknown): Promise<boolean>;
};
//# sourceMappingURL=card-callback.d.ts.map