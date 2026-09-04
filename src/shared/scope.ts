/**
 * scope 提取工具
 *
 * 从 SDK 命令上下文中提取 scope + peerId。
 */
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';

/**
 * 从命令上下文提取 scope + peerId
 */
export function getScopePeer(cmdCtx: SlashCommandHandlerContext): { scope: 'c2c' | 'group'; peerId: string } {
  const msg = cmdCtx.message;
  const scope = msg.kind === 'group' ? 'group' : 'c2c';
  const peerId = scope === 'group'
    ? ((msg as unknown as Record<string, unknown>).groupOpenid as string ?? msg.senderId)
    : msg.senderId;
  return { scope, peerId };
}
