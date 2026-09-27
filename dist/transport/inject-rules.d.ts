/**
 * inject-rules.ts — 条件注入规则引擎(配置化)
 *
 * 用户可配: 当入站消息满足条件(含图片/含链接/正文匹配正则或关键词)时,
 * 在 agentBody 末尾追加一行 "[系统提示] <prompt>" 自定义指令。
 * 取代原先 inbound.ts 写死的"读图提示", 并作为内置兜底规则保留默认行为。
 *
 * ⚠️ 本地手改功能(fork 新增, 配置见 config.injectRules):
 *    维护清单见工作区根《插件改动维护注意事项.md》。
 */
import type { InjectRuleConfig } from '../config.js';
import type { Logger, RawAttachment } from '../types.js';
/** 消息最小形状(只读所需) */
interface RuleMsg {
    content?: string;
    attachments?: RawAttachment[];
}
/**
 * 对组装好的 agentBody 应用全部启用的注入规则, 返回新 body。
 * 规则数组里没有任何 enabled 的 hasImage 规则时, 自动追加内置读图兜底(默认行为与旧版一致)。
 */
export declare function applyInjectRules(body: string, msg: RuleMsg, rules: InjectRuleConfig[] | undefined, logger?: Logger, imageHintAuto?: boolean): string;
export {};
//# sourceMappingURL=inject-rules.d.ts.map