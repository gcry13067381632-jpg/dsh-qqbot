/**
 * scope 提取工具
 *
 * 从 SDK 命令上下文中提取 scope + peerId。
 */
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
/**
 * 从命令上下文提取 scope + peerId
 */
export declare function getScopePeer(cmdCtx: SlashCommandHandlerContext): {
    scope: 'c2c' | 'group';
    peerId: string;
};
//# sourceMappingURL=scope.d.ts.map