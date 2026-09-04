/**
 * /bot-help — 查看所有指令以及用途
 *
 * 参考 openclaw-qqbot 的 bot-help.ts：遍历所有非隐藏命令，
 * 用 <qqbot-cmd-input> 展示为可点击按钮，以 Markdown 格式发送。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
import { sendMarkdownChunked } from '../shared/index.js';

/** /bot-help — 查看所有指令以及用途 */
export function helpCommand({ config }: CommandDeps, allCommands: () => SlashCommand[]): SlashCommand {
  return {
    name: 'bot-help',
    description: '查看所有指令以及用途',
    handler: async (cmdCtx) => {
      const lines = ['### QQBot插件内置指令', ''];

      for (const cmd of allCommands()) {
        const name = Array.isArray(cmd.name) ? cmd.name[0] : cmd.name;
        if (cmd.hidden) continue;
        lines.push(`<qqbot-cmd-input text="/${name}" show="/${name}"/> ${cmd.description ?? ''}`);
      }

      lines.push('', '> dsh-qqbot v0.1.0');
      await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
      return { kind: 'noop' as const };
    },
  };
}
