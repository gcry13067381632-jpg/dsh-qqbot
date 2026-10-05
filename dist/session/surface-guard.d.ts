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
export declare function canSilentlyAppend(session: unknown): boolean;
/**
 * 取 agent 上的 session 对象（agent 形状多样，统一在这里兜）
 * @param agent - 宿主 agent（或任何带 `.session` 的对象）
 */
export declare function sessionOf(agent: unknown): unknown;
export declare function skipSilentAppend(agent: unknown, logger: Logger | undefined, tag: string): boolean;
/** 供诊断端点使用：汇报一次守卫判定结果（不写盘、不打扰） */
export declare function surfaceGuardState(): {
    rule: string;
};
/** 供调用方判断宿主是否提供了 ctx（预留：将来若需要按 ctx 取会话日志，可在此扩展） */
export declare function surfaceGuardAvailable(_ctx?: Context): boolean;
//# sourceMappingURL=surface-guard.d.ts.map