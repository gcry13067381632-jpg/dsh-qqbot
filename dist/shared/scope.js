/**
 * 从命令上下文提取 scope + peerId
 */
export function getScopePeer(cmdCtx) {
    const msg = cmdCtx.message;
    const scope = msg.kind === 'group' ? 'group' : 'c2c';
    const peerId = scope === 'group'
        ? (msg.groupOpenid ?? msg.senderId)
        : msg.senderId;
    return { scope, peerId };
}
//# sourceMappingURL=scope.js.map