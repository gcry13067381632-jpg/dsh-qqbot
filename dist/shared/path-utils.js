/**
 * 路径规范化（2026-10-02，修 issue #7：手机/POSIX 环境下 cwd 写成反斜杠相对路径 ⇒ 会话创建必失败）
 *
 * 背景：Android(POSIX) 上 `\\` 不是分隔符，配成 `storage\\emulated\\0\\大肥鱼` 后宿主按字面路径建会话必失败，
 *   还会在 workspaces 下生成畸形目录；而失败被 inbound 静默吞掉，用户侧只看到"机器人连上却不说话"。
 *
 * 规则：
 *   1) 反斜杠 → 正斜杠（Windows 用户手写配置时最常见的错）
 *   2) 非 win32 平台遇到 Windows 盘符（C:…）→ 明确拒绝（返回空串），不交给 resolve 造幽灵目录
 *   3) 相对路径 → 用 path.resolve 落到绝对路径（而不是靠"补一个斜杠"）
 *   4) 全空白/空串 → 原样返回（由调用方决定默认值）
 */
import { isAbsolute, resolve, sep } from 'node:path';
import * as fs from 'node:fs';
/** 是否 Windows 盘符开头（C:\ / C:/） */
function hasDriveLetter(p) {
    return /^[A-Za-z]:[\\/]/.test(p);
}
export function normalizeUserPath(input, opts) {
    const raw = String(input ?? '').trim();
    if (!raw)
        return '';
    // 1) 统一分隔符
    let p = raw.replace(/\\/g, '/');
    // 2) 非 Windows 平台上的盘符路径 → 拒绝（返回空串，让调用方走默认值并告警）
    if (process.platform !== 'win32' && hasDriveLetter(p))
        return '';
    // 3) 相对 → 绝对
    if (!isAbsolute(p)) {
        const base = opts?.base && isAbsolute(opts.base) ? opts.base : process.cwd();
        p = resolve(base, p);
    }
    // 4) 非 Windows 下把分隔符统一为 '/'（path.resolve 在 POSIX 下本就如此，这里只防御）
    if (sep === '/')
        p = p.replace(/\\/g, '/');
    return p;
}
/** 该路径在本机是否可用（存在 + 可写）；不可用时返回原因，可用返回 '' */
export function pathProblem(p) {
    if (!p)
        return '路径为空';
    try {
        if (!fs.existsSync(p))
            return '目录不存在';
        fs.accessSync(p, fs.constants.W_OK);
        return '';
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}
//# sourceMappingURL=path-utils.js.map