/**
 * surface-guard.ts — 「静默 append」的格式前置条件守卫
 *
 * ── 事故（2026-10-06，会话日志报废 13 例并持续新增）──────────────────────────
 * dsh 的 **v4 会话格式**要求：`system/message`（人设）必须是会话 surface 的
 * **第一个节点** —— 只有"追加时 surface 还空着"的那一次才会被记为
 * `protectedHead`（见 `dsh-session-format-v3-to-v4` 的 `foldSurface`）：
 *
 *     if (event.type === "system/message" && surface.length > 0 && protectedHead === undefined)
 *         throw new SessionFormatError("system/message requires a protected first surface head");
 *
 * 而本插件的「静默入库」是**不唤醒 AI** 的（低分拦截 / nothink / 群事件汇总 / 卡片
 * `append_silent` …）：会话里还没有任何回合 ⇒ **人设还没写进 surface**。此时把
 * `user/message` 追加进去，它就占了头把交椅；**之后**这条会话第一次被真正唤醒、
 * dsh 补写人设时当场抛错 ⇒ **整份会话日志报废**。
 *
 * 用户看到的现象：`历史加载失败: stored session "…" is corrupt: … system/message
 * requires a protected first surface head`；而且该会话连**工作区也挂不上**
 * （读不出 Header）⇒ 侧边栏落「未分组」。
 *
 * 实测：`鲸鱼娘` 工作区 466 个会话里 13 个中招（`67bec37c` / `05f2eef5` /
 * `920d0e2c` / `2ef01bf5` …），且当天仍在新增。
 *
 * ── 守卫规则 ───────────────────────────────────────────────────────────
 * **只有当 surface 的第一个节点是 `system/message` 时，才允许静默 append。**
 * 等价于"受保护头部已确立"。非 surface 类型（`session/title` / `permission/preset`
 * / `sandbox/mode` …）不受此限，随便写。
 *
 * ★ **fail-closed**：读不到 / 结构不认识 / 抛异常 ⇒ 一律返回 false（宁可不写）。
 *   内容不会丢 —— 下次真人消息唤醒时，插件的 `[历史]` 段会把它拼进正文；
 *   或者走 `agent.inject()`（回合内安全排队，不唤醒）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Logger } from '../types.js';

/** 会话对象上我们只依赖这几个只读字段（全部 duck-typing + fail-soft） */
interface SessionSurfaceLike {
  surface?: {
    /** Surface event sequences in model-visible order（dsh-session 的 SurfaceManager.nodes） */
    nodes?: unknown;
    /** 窗口首事件的绝对 seq（fork 会话非 0） */
    baseSeq?: number;
  };
  /** 完整事件日志（数组下标 = 绝对 seq - baseSeq） */
  log?: unknown;
}

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
export function canSilentlyAppend(session: unknown): boolean {
  try {
    if (!session || typeof session !== 'object') return false;
    const s = session as SessionSurfaceLike;

    // ① 首选：surface.nodes
    const nodes = s.surface?.nodes;
    if (Array.isArray(nodes)) {
      if (nodes.length === 0) return false;                  // 空 surface ⇒ 绝不追加
      const log = s.log;
      if (Array.isArray(log)) {
        const base = typeof s.surface?.baseSeq === 'number' ? s.surface.baseSeq : 0;
        const head = log[Number(nodes[0]) - base];
        if (head && typeof head === 'object') return (head as { type?: unknown }).type === 'system/message';
      }
    }

    // ② 回落：直接扫事件日志，找第一个 surface 类型事件
    if (Array.isArray(s.log)) {
      for (const ev of s.log) {
        if (!ev || typeof ev !== 'object') continue;
        const type = (ev as { type?: unknown }).type;
        if (typeof type !== 'string' || !SURFACE_TYPES.has(type)) continue;
        return type === 'system/message';                    // 第一个 surface 事件就是答案
      }
      return false;                                          // 日志里还没有任何 surface 事件
    }

    return false;                                            // 两条路都走不通 ⇒ fail-closed
  } catch {
    return false;                                            // fail-closed
  }
}

/**
 * 取 agent 上的 session 对象（agent 形状多样，统一在这里兜）
 * @param agent - 宿主 agent（或任何带 `.session` 的对象）
 */
export function sessionOf(agent: unknown): unknown {
  try {
    if (!agent || typeof agent !== 'object') return undefined;
    return (agent as { session?: unknown }).session;
  } catch {
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

export function skipSilentAppend(agent: unknown, logger: Logger | undefined, tag: string): boolean {
  const session = sessionOf(agent);
  if (canSilentlyAppend(session)) return false;
  try {
    if (!probedOnce) {
      probedOnce = true;
      const s = session as { surface?: { nodes?: unknown; baseSeq?: unknown }; log?: unknown } | undefined;
      const nodesShape = Array.isArray(s?.surface?.nodes) ? `array(${s.surface.nodes.length})` : String(typeof s?.surface?.nodes);
      const logShape = Array.isArray(s?.log) ? `array(${s.log.length})` : String(typeof s?.log);
      logger?.info?.(
        '[surface-guard] 首次拦截静默 append（该会话人设尚未落盘）。形状探针: ' +
          `session=${typeof session} surface=${typeof s?.surface} nodes=${nodesShape} log=${logShape} baseSeq=${String(typeof s?.surface?.baseSeq)}`,
      );
    }
    logger?.debug?.(`[${tag}] 跳过静默 append：该会话人设尚未落盘（surface 首节点不是 system/message），硬写会报废会话日志`);
  } catch { /* 日志失败忽略 */ }
  return true;
}

/** 供诊断端点使用：汇报一次守卫判定结果（不写盘、不打扰） */
export function surfaceGuardState(): { rule: string } {
  return { rule: 'silent append requires surface.nodes[0].type === "system/message"' };
}

/** 供调用方判断宿主是否提供了 ctx（预留：将来若需要按 ctx 取会话日志，可在此扩展） */
export function surfaceGuardAvailable(_ctx?: Context): boolean {
  return typeof canSilentlyAppend === 'function';
}
