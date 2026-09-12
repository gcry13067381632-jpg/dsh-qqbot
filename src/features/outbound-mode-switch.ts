/**
 * outbound-mode-switch.ts — 出站模式切换共享注册表(2026-09-07)
 *
 * 供斜杠命令(/outmode)与 channel-tools 工具(outbound_mode)统一调用:
 * 切换由 bootstrap 注册的实现完成 —— ①改内存 live config(立即热生效);
 * ②尽力经 settings 服务 update 持久化(与 dock/设置面板同一数据源, 三方一致)。
 *
 * ⚠️ 安全边界(主人定): nothink(完全不思考)只允许「设置页」配置;
 *    命令/工具一律拒绝写入 nothink —— 防止机器人把自己切进不思考后无人能唤醒。
 *    (逃生通道= /outmode 斜杠命令走 SDK 直通不经 LLM, 可随时把 nothink 切回 adaptive。)
 *
 * 档位(2026-09-11 新增 detail):
 *   adaptive=适配主动(默认, 收到真人消息前5条带引用, 之后自动转独立消息);
 *   detail=详细主动(2026-09-11 主人定): 发送行为与 adaptive 完全一致, **额外**把 agent 的
 *     工具调用与工具结果推给 QQ(dock ⚙️ 出站页 / /outmode detail 均可切), 用来在 QQ 上看进度;
 *   passive=全被动 / silent=完全不出站 / nothink=完全不思考(仅设置页可配, 防自锁)。
 */
export type OutboundMode = 'adaptive' | 'active' | 'passive' | 'detail' | 'silent' | 'nothink';
export type SwitchableOutboundMode = 'adaptive' | 'passive' | 'detail' | 'silent';

/** 归一: active(旧值)→adaptive; 非法值→adaptive */
export function normalizeOutboundMode(m: unknown): OutboundMode {
  return m === 'passive' || m === 'detail' || m === 'silent' || m === 'nothink' ? m : 'adaptive';
}

/** 命令/工具可写的档位(不含 nothink) */
export function isSwitchable(m: unknown): m is SwitchableOutboundMode {
  return m === 'adaptive' || m === 'passive' || m === 'detail' || m === 'silent';
}

type Writer = (mode: OutboundMode) => Promise<{ ok: boolean; msg: string; mode: OutboundMode }>;

/**
 * 多实例 writer 注册表(2026-09-11 主人实测修复): 原实现是模块级单例 `let writer` ——
 * 多个 dsh-qqbot 实例(多个实例)各自 apply 时 setOutboundModeWriter
 * 会互相覆盖, 后启动的实例把前一个的 writer 顶掉。于是 `/outmode nothink` 在 某实例会话
 * 里执行, switchOutboundMode 却调到了别的实例的 writer, 改的是别人的 config ——
 * 症状: dock 显示的模式与实际切换不一致、nothink/adaptive 切了不生效。
 * 改为按 settingsNs 注册, 切换时显式携带当前实例 ns。
 */
const writers = new Map<string, Writer>();

/** bootstrap 注册切换实现(每实例一次, 按 ns 隔离) */
export function setOutboundModeWriter(ns: string, fn: Writer | undefined): void {
  if (fn) writers.set(ns, fn);
  else writers.delete(ns);
}

/** 执行切换: 命令/工具共用入口。ns=当前实例 settingsNs(多实例下必须传, 否则切错实例) */
export async function switchOutboundMode(m: unknown, ns?: string): Promise<{ ok: boolean; msg: string; mode: OutboundMode }> {
  const mode = normalizeOutboundMode(m);
  const w = ns ? writers.get(ns) : undefined;
  if (!w) {
    // 未传 ns / 找不到: 单实例时取唯一 writer 兜底; 多实例但无法判定 → 明确报错(宁拒绝不切错)
    if (writers.size === 1) {
      const only = writers.values().next().value as Writer | undefined;
      if (only) return only(mode);
    }
    return { ok: false, msg: `出站模式切换器未注册(ns=${ns ?? '(未指定)'})`, mode };
  }
  return w(mode);
}

