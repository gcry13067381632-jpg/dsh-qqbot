/**
 * 会话相关命令：/bot-reset /bot-clear /bot-new
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
import { getScopePeer } from '../shared/index.js';

/** /bot-reset /bot-clear — 重置当前会话 */
export function resetCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: ['bot-reset', 'bot-clear'],
    description: '重置当前会话（清除上下文）',
    handler: (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      void manager.remove(scope, peerId);
      return '会话已重置 ✓';
    },
  };
}

/** /bot-new — 开始新会话 */
export function newCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'bot-new',
    description: '开始新会话（清空上下文）',
    handler: (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      void manager.remove(scope, peerId);
      return '已开启新会话 ✓';
    },
  };
}
