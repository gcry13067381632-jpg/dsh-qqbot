/**
 * 预设切换卡片(2026-09-10): /preset 无参时发一张带按钮的卡片,
 * 每个可选人格一个按钮, 点击即热切换(宿主 agentPresets.recompose)。
 *
 * 交互设计仿 botplay 目录卡翻页(参考 features/botplay.ts catalogKeyboard):
 *   - 每行 2 个按钮, 最多 4 行 = 8 个/页, 第 5 行留翻页导航(◀上一页/下一页▶);
 *   - 按钮 data = `ps:<page>:<idx>`(page=页码, idx=该页内序号);
 *   - interaction 回调(INTERACTION_CREATE type=11)解析后直接调 manager.switchPreset。
 */
import type { QQBotSender } from '../transport/outbound-buffer.js';
import type { SessionManager } from '../session/session-manager.js';
type PresetCardImpl = (target: Parameters<QQBotSender['sendMarkdownWithKeyboard']>[0], scope: 'group' | 'c2c', peerId: string, page?: number) => Promise<string>;
/** bootstrap 接线: 注入真实实现(按实例 ns) */
export declare function setPresetCardImpl(ns: string, impl: PresetCardImpl | undefined): void;
/** 命令层调用: 发预设选择卡片(带当前实例 ns) */
export declare function sendPresetCard(ns: string, target: Parameters<QQBotSender['sendMarkdownWithKeyboard']>[0], scope: 'group' | 'c2c', peerId: string, page?: number): Promise<string>;
/**
 * 解析 preset 按钮数据: `ps:<page>:<idx>` → {page, idx}; 非本卡片按钮返回 null。
 * prev/next 为翻页导航(同前缀, idx 用字符串区分)。
 */
export declare function parsePresetButton(data: string | undefined): {
    page: number;
    idx: number;
} | 'prev' | 'next' | null;
export declare class PresetSwitcherController {
    private readonly manager;
    private readonly sender;
    private readonly logger;
    constructor(manager: SessionManager, sender: QQBotSender, logger: {
        info?: (m: string) => void;
        warn?: (m: string) => void;
    });
    /** 发预设选择卡片(某页)。返回给人看的摘要文本(命令 handler 用)。 */
    sendCard(target: Parameters<QQBotSender['sendMarkdownWithKeyboard']>[0], scope: 'group' | 'c2c', peerId: string, page?: number): Promise<string>;
    /** interaction 回调: 解析 ps:<page>:<idx|prev|next> → 切换或翻页。@returns true=已消费 */
    handleInteraction(event: unknown, target: Parameters<QQBotSender['sendMarkdownWithKeyboard']>[0], scope: 'group' | 'c2c', peerId: string): Promise<boolean>;
}
export {};
//# sourceMappingURL=preset-switcher.d.ts.map