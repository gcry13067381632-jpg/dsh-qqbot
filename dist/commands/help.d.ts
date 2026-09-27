/**
 * /bot-help — 查看所有指令以及用途
 *
 * 参考 openclaw-qqbot 的 bot-help.ts：遍历所有非隐藏命令，
 * 用 <qqbot-cmd-input> 展示为可点击按钮，以 Markdown 格式发送。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
/** /bot-help — 查看所有指令以及用途 */
export declare function helpCommand({ config }: CommandDeps, allCommands: () => SlashCommand[]): SlashCommand;
//# sourceMappingURL=help.d.ts.map