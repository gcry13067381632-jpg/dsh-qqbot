/**
 * 状态命令：/bot-status
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
import { getScopePeer, formatRelativeTime } from '../shared/index.js';

/** /bot-status — 查看当前会话状态 */
export function statusCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'bot-status',
    description: '查看当前会话状态',
    handler: (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const status = manager.getStatus(scope, peerId);
      if (!status.active) return '当前无活跃会话';
      const modelInfo = status.model ? `${status.provider}/${status.model}` : '宿主默认';
      return [
        '📊 会话状态',
        `会话: ${status.sessionId ? status.sessionId.slice(0, 8) : '—'}`,
        `模型: ${modelInfo}`,
        `Preset: ${status.preset ?? '无'}`,
        `消息数: ${status.messageCount ?? 0}`,
        `最后活动: ${formatRelativeTime(status.lastActivity)}`,
      ].join('\n');
    },
  };
}
