/**
 * ext-tool-interaction.ts — 扩展工具的「按钮回调」分发控制器（2026-10-08 新增）
 *
 * 由来
 *   扩展工具以前收不到自己卡片上的按钮点击（详见 `参考文档/组件需求`与
 *   `ext-tool-cards.ts` 头部注释）。本控制器补上这条链路：
 *
 *   `bot.on('interaction')`（`INTERACTION_CREATE`, `type=11`）
 *     └─ 解析 `button_data`
 *          ├─ 不是 `ext:` 前缀 → **立刻 return false**（零打扰，交回原有兜底）
 *          ├─ 是 `ext:` 但查注册表未命中/已过期 → return false（同样交回兜底）
 *          └─ 命中 → 按 `toolName` 加载扩展工具模块 → 调它的 `onInteraction(ctx, info)`
 *                    → 非空字符串作为回执发给点击者 → return true（已消费）
 *
 * 设计纪律
 *   · **只在"确实是我们的事"时才消费**：前缀不对/查不到卡/模块没导出钩子 → 一律 false，
 *     保证"无任何消费者时仍只 ack"这条既有行为不变；
 *   · 钩子抛错 = 该次未消费（记日志 + 给点击者一句失败回执），**绝不让异常冒到分发串**；
 *   · ctx 由调用方（bootstrap）注入工厂生成 —— 复用 `makeExtCaps`，
 *     保证"点按钮时拿到的能力"与"工具 `run()` 时拿到的能力"是同一套；
 *   · ack 统一由 bootstrap 的交互处理器做（本控制器不碰 `PUT /interactions/{id}`）。
 */
import type { Logger } from '../types.js';
/** 点击者身份 */
export interface ExtToolActor {
    openid: string;
    name: string;
    isOwner: boolean;
}
export interface ExtToolInteractionDeps {
    /** 插件数据根（拓展工具目录 = `{dataRoot}/.qqbot-extensions/tools`，注册表也在数据根下） */
    dataRoot: string;
    logger: Logger;
    /**
     * 组 ctx：bootstrap 侧用 `makeExtCaps` 包一层，注入 selfName / 点击者身份 / 会话坐标。
     * 返回值会作为 `onInteraction(ctx, info)` 的第一个参数。
     */
    makeCtx: (args: {
        toolName: string;
        replyTarget: unknown;
        actor: ExtToolActor;
        scope: string;
        peerId: string;
        clickedBefore: boolean;
    }) => Record<string, unknown>;
    /** 回执（发给点击者；发不出去不影响 ack 与消费判定） */
    sendReceipt: (replyTarget: unknown, text: string) => Promise<void>;
}
export interface ExtToolInteractionController {
    handleInteraction(event: unknown, replyTarget: unknown): Promise<boolean>;
}
export declare function createExtToolInteractionController(deps: ExtToolInteractionDeps): ExtToolInteractionController;
//# sourceMappingURL=ext-tool-interaction.d.ts.map