/**
 * botplay 命令: /botplay — 列出/触发互动事件(2026-09-08, Phase1 MVP)
 *
 * 用法:
 *   /botplay            → 列出全部已装配事件(可点击/抄名字)
 *   /botplay <事件名>   → 精确匹配(id 或 name)触发: bot 发出配置好的键盘卡片
 *
 * 事件装配在 dock「🎮 互动事件」页 / Web 设置保存(live 热更, 无需重启)。
 * 触发走 triggerBotplay 模块级注册表(bootstrap 注册实现, 带 sender/manager)。
 * 权限: 默认所有群友可点; 事件 perm=triggerer 时仅触发者本人可点(推荐, 零配置)。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
export declare function botplayCommand({ config }: CommandDeps): SlashCommand;
//# sourceMappingURL=botplay.d.ts.map