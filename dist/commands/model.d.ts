/**
 * 模型命令：/bot-model — 查看或切换模型
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
export declare function modelCommand({ manager, config }: CommandDeps): SlashCommand;
/** /model 简写别名: 复用 /bot-model 同一 handler */
export declare function modelAliasCommand(deps: CommandDeps): SlashCommand;
//# sourceMappingURL=model.d.ts.map