/** 归一: active(旧值)→adaptive; 非法值→adaptive */
export function normalizeOutboundMode(m) {
    return m === 'passive' || m === 'detail' || m === 'silent' || m === 'nothink' ? m : 'adaptive';
}
/** 命令/工具可写的档位(不含 nothink) */
export function isSwitchable(m) {
    return m === 'adaptive' || m === 'passive' || m === 'detail' || m === 'silent';
}
/**
 * 多实例 writer 注册表(2026-09-11 主人实测修复): 原实现是模块级单例 `let writer` ——
 * 多个 dsh-qqbot 实例(多个实例)各自 apply 时 setOutboundModeWriter
 * 会互相覆盖, 后启动的实例把前一个的 writer 顶掉。于是 `/outmode nothink` 在 某实例会话
 * 里执行, switchOutboundMode 却调到了别的实例的 writer, 改的是别人的 config ——
 * 症状: dock 显示的模式与实际切换不一致、nothink/adaptive 切了不生效。
 * 改为按 settingsNs 注册, 切换时显式携带当前实例 ns。
 */
const writers = new Map();
/** bootstrap 注册切换实现(每实例一次, 按 ns 隔离) */
export function setOutboundModeWriter(ns, fn) {
    if (fn)
        writers.set(ns, fn);
    else
        writers.delete(ns);
}
/** 执行切换: 命令/工具共用入口。ns=当前实例 settingsNs(多实例下必须传, 否则切错实例) */
export async function switchOutboundMode(m, ns) {
    const mode = normalizeOutboundMode(m);
    const w = ns ? writers.get(ns) : undefined;
    if (!w) {
        // 未传 ns / 找不到: 单实例时取唯一 writer 兜底; 多实例但无法判定 → 明确报错(宁拒绝不切错)
        if (writers.size === 1) {
            const only = writers.values().next().value;
            if (only)
                return only(mode);
        }
        return { ok: false, msg: `出站模式切换器未注册(ns=${ns ?? '(未指定)'})`, mode };
    }
    return w(mode);
}
//# sourceMappingURL=outbound-mode-switch.js.map