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
 */
export type OutboundMode = 'adaptive' | 'active' | 'passive' | 'silent' | 'nothink';
export type SwitchableOutboundMode = 'adaptive' | 'passive' | 'silent';

/** 归一: active(旧值)→adaptive; 非法值→adaptive */
export function normalizeOutboundMode(m: unknown): OutboundMode {
  return m === 'passive' || m === 'silent' || m === 'nothink' ? m : 'adaptive';
}

/** 命令/工具可写的档位(不含 nothink) */
export function isSwitchable(m: unknown): m is SwitchableOutboundMode {
  return m === 'adaptive' || m === 'passive' || m === 'silent';
}

type Writer = (mode: OutboundMode) => Promise<{ ok: boolean; msg: string; mode: OutboundMode }>;

let writer: Writer | undefined;

/** bootstrap 注册切换实现(每实例一次) */
export function setOutboundModeWriter(fn: Writer | undefined): void {
  writer = fn;
}

/** 执行切换: 命令/工具共用入口 */
export async function switchOutboundMode(m: unknown): Promise<{ ok: boolean; msg: string; mode: OutboundMode }> {
  const mode = normalizeOutboundMode(m);
  if (!writer) {
    return { ok: false, msg: '出站模式切换器未注册(插件未就绪)', mode };
  }
  return writer(mode);
}
