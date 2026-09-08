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

/** /bot-new — 开启新会话(真 fork: 旧会话存档可回看, 本会话开新档; 2026-09-08 修假实现) */
export function newCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'bot-new',
    description: '开启新会话(保留旧会话存档, 可回看)',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const ok = await manager.startNewSession(scope, peerId, false);
      return ok ? '已开启新会话 ✓(旧会话已存档)' : '当前没有活跃会话, 无需开新';
    },
  };
}
