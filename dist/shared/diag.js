/**
 * diag.ts — 诊断日志的**唯一底座**（2026-10-06，还债）
 *
 * ── 为什么要收口 ──────────────────────────────────────────────────
 * 以前每个功能都自己写一份诊断日志，于是：
 *   · `contextless-trace.log` **没有任何上限**，一路涨到 **25 MB**；
 *   · 同一条 trace 被写到**三个地方**（`~/.dsh/`、系统 tmp、数据根）；
 *   · 还有**两处代码写同一个文件**（`contextless-store.ts` 与 `channel-tools.ts`）；
 *   · 有些每行还往终端 `console.error` —— 控制台刷屏。
 *
 * ⇒ 本模块把「**开关 / 上限 / 位置 / 轮转**」四件事收成一处，所有诊断日志都必须走它：
 *
 * ```ts
 * diagWrite('qqbot-ext-diag', line);    // 默认不写；开了才写；超 2MB 自动轮转
 * ```
 *
 * ── 保证 ────────────────────────────────────────────────────────
 * 1. **默认关**（用户机器上零开销、零垃圾）；由配置项 `diagLog` 或环境变量
 *    `DSH_QQBOT_DIAG=1` 打开。
 * 2. **单文件上限**（默认 2 MB）+ **轮转 1 份**（`xxx.log` → `xxx.log.1`），**只进不出成为历史**。
 * 3. **只写一个位置**：`{DSH_HOME|~/.dsh}/<name>.log`，不再往 tmp / 数据根各撒一份。
 * 4. **绝不影响主链**：任何写失败都静默吞掉（诊断日志不该拖垮业务）。
 * 5. **尺寸用内存计数**，不每次 `statSync`（只有首次取基线）。
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const state = {
    enabled: false,
    maxBytes: DEFAULT_MAX_BYTES,
    root: resolveRoot(),
};
/** 各文件当前已知大小（避免每次写都 statSync） */
const sizes = new Map();
function resolveRoot() {
    try {
        const env = (process.env.DSH_HOME ?? '').trim();
        if (env)
            return env;
        return join(homedir(), '.dsh');
    }
    catch {
        return '.';
    }
}
/**
 * 配置诊断日志。**每次插件启动（每个实例）调用一次即可**。
 *
 * @param opts.enabled - 总开关；不传 = 保持当前值（默认 false）
 * @param opts.maxBytes - 单文件上限字节数（默认 2 MB）
 * @param opts.home - 输出根目录（默认 `DSH_HOME` 或 `~/.dsh`）
 */
export function configureDiag(opts) {
    try {
        if (opts.home)
            state.root = opts.home;
        else if (!state.root)
            state.root = resolveRoot();
        if (typeof opts.maxBytes === 'number' && opts.maxBytes > 0)
            state.maxBytes = Math.floor(opts.maxBytes);
        if (typeof opts.enabled === 'boolean')
            state.enabled = opts.enabled;
        // 环境变量优先（排查时不想改配置就 `set DSH_QQBOT_DIAG=1` 重启）
        const env = (process.env.DSH_QQBOT_DIAG ?? '').trim();
        if (env === '1' || env.toLowerCase() === 'true')
            state.enabled = true;
    }
    catch { /* 配置失败保持默认（关） */ }
}
/** 诊断日志现在是开着的吗？ */
export function diagEnabled() {
    return state.enabled === true;
}
/** 某个诊断文件的绝对路径（**不看开关**，面板展示用） */
export function diagPathFor(name) {
    return join(state.root, `${safeName(name)}.log`);
}
/** 文件名消毒：只允许字母/数字/`._-`，防路径逃逸 */
function safeName(name) {
    const n = String(name ?? '').trim();
    if (!n || !/^[A-Za-z0-9._-]+$/.test(n))
        return 'qqbot-diag';
    return n;
}
/** 首次写时取一次基线大小（之后靠内存计数） */
function knownSize(file) {
    const hit = sizes.get(file);
    if (hit !== undefined)
        return hit;
    let n = 0;
    try {
        n = existsSync(file) ? statSync(file).size : 0;
    }
    catch {
        n = 0;
    }
    sizes.set(file, n);
    return n;
}
/** 超上限就轮转：`xxx.log` → `xxx.log.1`（只留 1 份旧档） */
function rotateIfNeeded(file, incoming) {
    try {
        if (knownSize(file) + incoming <= state.maxBytes)
            return;
        const bak = `${file}.1`;
        try {
            rmSync(bak, { force: true });
        }
        catch { /* ignore */ }
        try {
            renameSync(file, bak);
        }
        catch { /* 文件可能不存在/被占，忽略 */ }
        sizes.set(file, 0);
    }
    catch { /* ignore */ }
}
/**
 * 写一行诊断日志（**全插件唯一入口**）。
 *
 * - 开关关着 ⇒ 立刻返回，**零 I/O**。
 * - 写失败（磁盘满/被占用）⇒ 静默吞掉，**绝不抛**。
 *
 * @param name - 日志名（不含 `.log`），如 `qqbot-ext-diag` / `botplay-diag`
 * @param line - 内容（会自动补时间戳与换行）
 */
export function diagWrite(name, line) {
    if (!state.enabled)
        return;
    try {
        const file = diagPathFor(name);
        const row = `${new Date().toISOString()} ${String(line ?? '')}\n`;
        const bytes = Buffer.byteLength(row, 'utf8');
        try {
            mkdirSync(dirname(file), { recursive: true });
        }
        catch { /* ignore */ }
        rotateIfNeeded(file, bytes);
        appendFileSync(file, row, 'utf8');
        sizes.set(file, knownSize(file) + bytes);
    }
    catch { /* 诊断日志失败绝不影响主链 */ }
}
/** 诊断状态（面板/端点展示：开关、上限、各文件当前大小） */
export function diagStatus() {
    const files = [...sizes.entries()].map(([path, bytes]) => ({
        name: path.split(/[\\/]/).pop() ?? path,
        path,
        bytes,
    }));
    return { enabled: state.enabled, maxBytes: state.maxBytes, root: state.root, files };
}
/**
 * 给「排查完就删」的调用方一条清理捷径（只删我们自己的诊断日志）。
 * @param names - 要删的日志名（不含 `.log`）；不传 = 删 sizes 里已知的全部
 */
export function diagClean(names) {
    let removed = 0;
    const targets = names && names.length ? names.map((n) => diagPathFor(n)) : [...sizes.keys()];
    for (const file of targets) {
        try {
            for (const p of [file, `${file}.1`]) {
                if (existsSync(p)) {
                    rmSync(p, { force: true });
                    removed += 1;
                }
            }
            sizes.set(file, 0);
        }
        catch { /* ignore */ }
    }
    return removed;
}
//# sourceMappingURL=diag.js.map