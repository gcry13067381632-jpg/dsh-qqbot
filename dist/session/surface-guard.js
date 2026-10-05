/** surface 类型事件（与 dsh 的 SURFACE_TYPES 一致） */
const SURFACE_TYPES = new Set([
    'system/message',
    'user/message',
    'developer/message',
    'assistant/message',
    'tool/result',
]);
/**
 * 这条会话现在允许「静默 append」吗？
 *
 * 两条判据，**任一成立即放行**（都拿不到 ⇒ fail-closed 返回 false）：
 *  ① `session.surface.nodes`（最权威，dsh-session 的 SurfaceManager）——首节点类型
 *  ② 回落：扫 `session.log`，取**第一个 surface 类型事件**，看它是不是 `system/message`
 *
 * @param session - 宿主 agent 的 `session` 对象（拿不到就返回 false）
 * @returns true = 人设已落盘（surface 首节点就是 system/message），可以安全追加
 */
export function canSilentlyAppend(session) {
    try {
        if (!session || typeof session !== 'object')
            return false;
        const s = session;
        // ① 首选：surface.nodes
        const nodes = s.surface?.nodes;
        if (Array.isArray(nodes)) {
            if (nodes.length === 0)
                return false; // 空 surface ⇒ 绝不追加
            const log = s.log;
            if (Array.isArray(log)) {
                const base = typeof s.surface?.baseSeq === 'number' ? s.surface.baseSeq : 0;
                const head = log[Number(nodes[0]) - base];
                if (head && typeof head === 'object')
                    return head.type === 'system/message';
            }
        }
        // ② 回落：直接扫事件日志，找第一个 surface 类型事件
        if (Array.isArray(s.log)) {
            for (const ev of s.log) {
                if (!ev || typeof ev !== 'object')
                    continue;
                const type = ev.type;
                if (typeof type !== 'string' || !SURFACE_TYPES.has(type))
                    continue;
                return type === 'system/message'; // 第一个 surface 事件就是答案
            }
            return false; // 日志里还没有任何 surface 事件
        }
        return false; // 两条路都走不通 ⇒ fail-closed
    }
    catch {
        return false; // fail-closed
    }
}
/**
 * 取 agent 上的 session 对象（agent 形状多样，统一在这里兜）
 * @param agent - 宿主 agent（或任何带 `.session` 的对象）
 */
export function sessionOf(agent) {
    try {
        if (!agent || typeof agent !== 'object')
            return undefined;
        return agent.session;
    }
    catch {
        return undefined;
    }
}
/**
 * 「要不要跳过这次静默 append？」——带诊断日志的统一入口。
 * 各调用点写：
 * ```
 * if (skipSilentAppend(agent, logger, 'nothink')) { …走安全兜底… }
 * ```
 *
 * @param agent - 宿主 agent
 * @param logger - 插件 logger（可空）
 * @param tag - 日志前缀（如 'nothink' / '价值评分' / 'group-hub'）
 * @returns true = 应当跳过静默 append（人设未落盘 / 拿不准）
 */
/** 形状探针只打一次：确认守卫判据在当前 dsh 版本上真的拿得到数据 */
let probedOnce = false;
export function skipSilentAppend(agent, logger, tag) {
    const session = sessionOf(agent);
    if (canSilentlyAppend(session))
        return false;
    try {
        if (!probedOnce) {
            probedOnce = true;
            const s = session;
            const nodesShape = Array.isArray(s?.surface?.nodes) ? `array(${s.surface.nodes.length})` : String(typeof s?.surface?.nodes);
            const logShape = Array.isArray(s?.log) ? `array(${s.log.length})` : String(typeof s?.log);
            logger?.info?.('[surface-guard] 首次拦截静默 append（该会话人设尚未落盘）。形状探针: ' +
                `session=${typeof session} surface=${typeof s?.surface} nodes=${nodesShape} log=${logShape} baseSeq=${String(typeof s?.surface?.baseSeq)}`);
        }
        logger?.debug?.(`[${tag}] 跳过静默 append：该会话人设尚未落盘（surface 首节点不是 system/message），硬写会报废会话日志`);
    }
    catch { /* 日志失败忽略 */ }
    return true;
}
/** 供诊断端点使用：汇报一次守卫判定结果（不写盘、不打扰） */
export function surfaceGuardState() {
    return { rule: 'silent append requires surface.nodes[0].type === "system/message"' };
}
/** 供调用方判断宿主是否提供了 ctx（预留：将来若需要按 ctx 取会话日志，可在此扩展） */
export function surfaceGuardAvailable(_ctx) {
    return typeof canSilentlyAppend === 'function';
}
//# sourceMappingURL=surface-guard.js.map