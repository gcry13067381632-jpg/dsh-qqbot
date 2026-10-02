/**
 * qun-login.ts — 免扫码登录 qun.qq.com（自带浏览器 + CDP，**零第三方依赖**）
 *
 * ── 原理（2026-10-02 实测结论，别再猜）──
 *   ① 「点头像授权登录」靠两个来源，任意一个在就能用：
 *        a) 浏览器 profile 里的 QQ 长期登录 cookie（ptui_loginuin / qlogin_uid / pt4_token / RK …）
 *        b) 本机 QQ 客户端的本地服务（https://localhost.ptlogin2.qq.com:4301/pt_get_uins）
 *      实测：QQ 客户端关掉后 (b) 立刻消失（端口无监听、页面只剩"扫码登录"），
 *            但只要 (a) 还在，登录页**照样显示头像**、点一下就能换新凭据。
 *   ② 因此本模块的核心价值：**只要 profile 活着，登录就是全自动的，永远不用再扫码**。
 *      第一次（profile 里还没有 QQ cookie）才需要扫码 —— 那时把二维码截图交给上层发给用户。
 *   ③ skey 约 1 天过期，但过期后不需要用户做任何事：重新打开登录页 → 自动点头像 → 换新的。
 *
 * ── 实现 ──
 *   启动系统 Edge/Chrome 的 headless + 独立 user-data-dir + 调试端口，
 *   用 Node 内置 WebSocket 连 CDP，执行 JS 点头像 / 读 cookie。
 *   用户零安装、插件零依赖。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadQunCookie } from './qun-admin.js';
/**
 * 登录入口用 qun.qq.com 本体，而不是 xui.ptlogin2 的快捷登录页。
 * 原因：qun.qq.com 能同时覆盖两种情况 ——
 *   已登录 → 直接进群管理页，读 cookie 就完事（**一次都不用登**）；
 *   未登录 → 自动落到登录页，那上面正好是「快捷登录」面板（有头像就点头像，没有就出二维码）。
 * 而 xlogin 页只认 ptlogin2 域的 ptui_loginuin，会忽略 qun.qq.com 已有的登录态（实测踩过）。
 */
const LOGIN_URL = 'https://qun.qq.com/';
/** 二维码元素的候选选择器（页面改版时在这里加就行） */
const QR_SELECTORS = [
    '#qrlogin_img',
    '#qrlogin_img_box img',
    '#qr_img',
    '.qrcode img',
    '#qlogin_qr img',
];
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
// ───────────────────────── 找浏览器 ─────────────────────────
/** 找系统浏览器（Edge 优先：Windows 必装）。可用 QUN_BROWSER 环境变量覆盖。 */
export function findSystemBrowser() {
    const env = String(process.env['QUN_BROWSER'] ?? '').trim();
    if (env && existsSync(env))
        return env;
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const lad = process.env['LOCALAPPDATA'] ?? '';
    const cands = [
        join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    for (const c of cands) {
        try {
            if (c && existsSync(c))
                return c;
        }
        catch { /* ignore */ }
    }
    return null;
}
async function connectCdp(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('CDP 连接超时')), 15000);
        ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
        ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('CDP 连接失败')); }, { once: true });
    });
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
        try {
            const m = JSON.parse(String(ev.data));
            if (typeof m.id !== 'number')
                return;
            const p = pending.get(m.id);
            if (!p)
                return;
            pending.delete(m.id);
            if (m.error)
                p.rej(new Error(m.error.message ?? 'CDP error'));
            else
                p.res(m.result);
        }
        catch { /* ignore */ }
    });
    return {
        send(method, params) {
            const id = ++seq;
            return new Promise((res, rej) => {
                pending.set(id, { res, rej });
                try {
                    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
                }
                catch (e) {
                    pending.delete(id);
                    rej(e);
                    return;
                }
                setTimeout(() => { if (pending.has(id)) {
                    pending.delete(id);
                    rej(new Error('CDP 超时: ' + method));
                } }, 30000);
            });
        },
        close() { try {
            ws.close();
        }
        catch { /* ignore */ } },
    };
}
async function evalJs(cdp, expr) {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
}
/** 清掉 profile 的进程锁（残留进程占用时，浏览器会以 code=21 立刻退出） */
function cleanProfileLocks(dir) {
    for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        try {
            rmSync(join(dir, f), { force: true, recursive: true });
        }
        catch { /* ignore */ }
    }
}
/**
 * 杀掉浏览器**整个进程树**。
 * ⚠️ 不能用 proc.kill()：它只杀主进程，渲染/GPU 子进程会活下来继续锁住 profile，
 *    下次启动就 code=21（实测踩坑）。
 */
function killTree(proc) {
    try {
        if (process.platform === 'win32' && proc.pid) {
            spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
            return;
        }
    }
    catch { /* 落到下面的兜底 */ }
    try {
        proc.kill('SIGKILL');
    }
    catch { /* ignore */ }
}
async function launchBrowser(exe, userDataDir, headless) {
    try {
        mkdirSync(userDataDir, { recursive: true });
    }
    catch { /* ignore */ }
    cleanProfileLocks(userDataDir);
    const args = [
        ...(headless ? ['--headless=new'] : []),
        '--remote-debugging-port=0',
        '--user-data-dir=' + userDataDir,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--window-size=560,760',
        // 沙箱里跑的浏览器不需要额外权限；headless 下这几项能少很多噪音日志
        '--no-service-autorun',
        '--password-store=basic',
        LOGIN_URL,
    ];
    // ⚠️ windowsHide 千万不能设 true：对 msedge 这类 GUI 程序，它会让浏览器主窗口**根本显示不出来**
    //   （实测：进程起来了、CDP 也通，但 11 个进程 MainWindowHandle 全为 0，用户看不到二维码）
    const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: false });
    const port = await new Promise((res, rej) => {
        let buf = '';
        const t = setTimeout(() => rej(new Error('浏览器启动超时（没拿到调试端口）')), 25000);
        proc.stderr?.on('data', (d) => {
            buf += d.toString();
            const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(buf);
            if (m && m[1]) {
                clearTimeout(t);
                res(Number(m[1]));
            }
        });
        proc.on('exit', (c) => { clearTimeout(t); rej(new Error('浏览器提前退出 code=' + String(c))); });
        proc.on('error', (e) => { clearTimeout(t); rej(e); });
    });
    const kill = () => { killTree(proc); };
    return { proc, port, kill };
}
/** 等页面目标出现，返回它的 debugger ws 地址 */
async function pageWsUrl(port, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/json/list`);
            const list = (await r.json());
            const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
            if (page?.webSocketDebuggerUrl)
                return page.webSocketDebuggerUrl;
        }
        catch { /* ignore */ }
        await sleep(300);
    }
    throw new Error('没找到浏览器页面目标');
}
const sessions = new Map();
function closeSession(dataRoot) {
    const s = sessions.get(dataRoot);
    if (!s)
        return;
    try {
        s.cdp.close();
    }
    catch { /* ignore */ }
    try {
        s.handle.kill();
    }
    catch { /* ignore */ }
    sessions.delete(dataRoot);
}
// ── 进程兜底：绝不让浏览器进程攒着（2026-10-02 实测踩到：攒了 9 个同 profile 的 msedge）──
/** 会话空闲多久自动关掉（与 wait 的 5 分钟上限一致） */
const SESSION_IDLE_MS = 5 * 60 * 1000;
/**
 * 宿主退出时把所有浏览器一起带走。
 * ⚠️ 不装这个钩子的话，宿主一退出子进程就成**孤儿**，会一直挂在后台（而且锁着 profile，
 *    下次启动还会 code=21）。
 */
let exitHookInstalled = false;
function installExitHook() {
    if (exitHookInstalled)
        return;
    exitHookInstalled = true;
    const killAll = () => {
        for (const dr of Array.from(sessions.keys())) {
            try {
                closeSession(dr);
            }
            catch { /* ignore */ }
        }
    };
    try {
        process.on('exit', killAll);
    }
    catch { /* ignore */ }
    try {
        process.on('SIGINT', () => { killAll(); process.exit(0); });
    }
    catch { /* ignore */ }
    try {
        process.on('SIGTERM', () => { killAll(); process.exit(0); });
    }
    catch { /* ignore */ }
}
/** 空闲清理：每分钟扫一次，超过 SESSION_IDLE_MS 没动静的会话连浏览器一起关掉 */
let sweeper = null;
function ensureSweeper() {
    if (sweeper)
        return;
    sweeper = setInterval(() => {
        const now = Date.now();
        for (const [dr, s] of Array.from(sessions.entries())) {
            if (now - s.at > SESSION_IDLE_MS) {
                try {
                    closeSession(dr);
                }
                catch { /* ignore */ }
            }
        }
        // 没会话了就把定时器也停掉（别让空转的 timer 拖住进程退出）
        if (sessions.size === 0 && sweeper) {
            clearInterval(sweeper);
            sweeper = null;
        }
    }, 60 * 1000);
    try {
        sweeper.unref?.();
    }
    catch { /* ignore */ }
}
/** 杀掉占用指定 profile 的**残留**浏览器进程（历史泄漏的兜底清理；只在启动出问题时调用） */
function killByProfile(profileDir) {
    if (process.platform !== 'win32')
        return;
    try {
        const safe = profileDir.replace(/'/g, "''");
        const cmd = 'Get-CimInstance Win32_Process -Filter "Name=\'msedge.exe\'"'
            + ` | Where-Object { $_.CommandLine -like '*${safe}*' }`
            + ' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
        spawn('powershell', ['-NoProfile', '-Command', cmd], { stdio: 'ignore', windowsHide: true });
    }
    catch { /* ignore */ }
}
export function qunLoginSessionAlive(dataRoot) {
    return sessions.has(dataRoot);
}
export function qunLoginSessionClose(dataRoot) {
    closeSession(dataRoot);
}
/** 从 document.cookie 串里抠出凭据 */
function parseCookie(raw) {
    const pick = (k) => {
        const m = new RegExp('(?:^|;\\s*)' + k + '=([^;]*)').exec(raw);
        return m && m[1] ? m[1] : '';
    };
    const uinRaw = pick('uin') || pick('p_uin');
    const uin = (/(\d{5,12})/.exec(uinRaw) ?? [])[1] ?? '';
    const skey = pick('skey');
    const p_skey = pick('p_skey');
    if (!uin || !skey)
        return null;
    return { uin, skey, p_skey };
}
/** 页面还在登录页吗（用来判断是否已跳进 qun.qq.com） */
async function currentHref(cdp) {
    try {
        return (await evalJs(cdp, 'location.href')) ?? '';
    }
    catch {
        return '';
    }
}
/** 尝试在页面上读凭据；读到就返回 */
async function tryReadCookie(cdp) {
    try {
        const href = await currentHref(cdp);
        if (!/qun\.qq\.com/.test(href) || /\/login/.test(href))
            return null;
        const raw = (await evalJs(cdp, 'document.cookie')) ?? '';
        return parseCookie(String(raw));
    }
    catch {
        return null;
    }
}
/**
 * 找头像元素并点它；返回点了几个。
 * ⚠️ 不能只看容器存不存在 —— `#qlogin_list` 在"没有可授权账号"时也照样存在（空容器），
 *    必须要求里面有**可见的** a/img 才算真头像（实测踩过：误判导致日志说"点了头像但没跳转"）。
 */
async function clickAvatar(cdp) {
    const expr = `(function(){
    const root = document.querySelector('#qlogin_list')
      || document.querySelector('.qlogin_list')
      || document.querySelector('#qlogin');
    if (!root) return 0;
    const cand = root.querySelectorAll('a, img, .face');
    for (const el of cand) {
      const r = el.getBoundingClientRect();
      if (!r || r.width < 16 || r.height < 16) continue;   // 不可见的忽略
      const target = (el.tagName === 'IMG' && el.parentElement) ? el.parentElement : el;
      try { target.click(); } catch (e) { /* ignore */ }
      return 1;
    }
    return 0;
  })()`;
    try {
        const n = await evalJs(cdp, expr);
        return Number(n) || 0;
    }
    catch {
        return 0;
    }
}
/** 把二维码元素截图存盘（找不到元素就整页截图兜底） */
async function shotQr(cdp, dataRoot) {
    const out = join(dataRoot, 'qun-login-qr.png');
    try {
        const sels = JSON.stringify(QR_SELECTORS);
        const box = await evalJs(cdp, `(function(){
      const sels = ${sels};
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el && el.getBoundingClientRect) {
          const r = el.getBoundingClientRect();
          if (r.width > 40 && r.height > 40) return { x: r.x, y: r.y, w: r.width, h: r.height };
        }
      }
      const img = Array.from(document.images || []).find(function(i){ return i.width > 80 && i.height > 80; });
      if (img) { const r = img.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }
      return null;
    })()`);
        const params = { format: 'png', captureBeyondViewport: true };
        if (box && box.w > 40 && box.h > 40) {
            params['clip'] = { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.w + 16, height: box.h + 16, scale: 1 };
        }
        const r = await cdp.send('Page.captureScreenshot', params);
        const b64 = r?.data;
        if (!b64)
            return undefined;
        try {
            mkdirSync(dataRoot, { recursive: true });
        }
        catch { /* ignore */ }
        writeFileSync(out, Buffer.from(b64, 'base64'));
        return out;
    }
    catch {
        return undefined;
    }
}
/**
 * 第一步：开浏览器 → 有头像就自动点（免扫码），没头像就出二维码。
 * 拿到凭据就返回 cookie 并关掉浏览器；需要扫码则**保留浏览器**，让上层把 qrPath 发给用户，
 * 之后用 qunBrowserLoginWait 继续等。
 */
export async function qunBrowserLoginStart(dataRoot, opts = {}) {
    const exe = findSystemBrowser();
    if (!exe) {
        return { ok: false, msg: '没找到系统浏览器（Edge/Chrome）。可设环境变量 QUN_BROWSER 指向浏览器可执行文件。' };
    }
    // ★ 已有活着的会话就**直接复用**，绝不"先杀掉再新建"：
    //   反复启停正是 code=21 的根源（短命进程持有长命 profile，Windows 的文件锁来不及释放）。
    const existing = sessions.get(dataRoot);
    if (existing) {
        try {
            const ck0 = await tryReadCookie(existing.cdp);
            if (ck0) {
                closeSession(dataRoot);
                return { ok: true, msg: `复用已有浏览器会话并拿到凭据，uin=${ck0.uin}`, cookie: ck0 };
            }
            // 会话还活着但没登录 → 试试点头像（本机 QQ 客户端/身份 cookie 可能已就绪）
            const n0 = await clickAvatar(existing.cdp);
            if (n0 > 0) {
                existing.clicked = true;
                await sleep(2500);
                const ck1 = await tryReadCookie(existing.cdp);
                if (ck1) {
                    closeSession(dataRoot);
                    return { ok: true, msg: `复用会话 + 点头像授权成功，uin=${ck1.uin}`, cookie: ck1 };
                }
            }
            // 还是没登录 → 就把上一次的二维码继续用（3 分钟内有效）
            if (existing.qrPath) {
                existing.at = Date.now();
                return { ok: true, qrPath: existing.qrPath, msg: '复用上一次的二维码（仍在有效期内）。请扫完调 wait。' };
            }
        }
        catch { /* 会话坏了 → 往下走，重新开一个 */ }
    }
    closeSession(dataRoot); // 清掉可能残留的坏会话
    const profileDir = opts.profileDir ?? join(dataRoot, 'browser-profile');
    const headless = opts.headless !== false;
    let handle;
    try {
        handle = await launchBrowser(exe, profileDir, headless);
    }
    catch {
        // code=21 = profile 被上次残留的进程占着
        //   → 先杀掉占用该 profile 的残留进程（历史泄漏兜底），再清锁、等一下、重试
        killByProfile(profileDir);
        cleanProfileLocks(profileDir);
        await sleep(1500);
        try {
            handle = await launchBrowser(exe, profileDir, headless);
        }
        catch (e2) {
            return { ok: false, msg: '启动浏览器失败：' + String(e2?.message ?? e2).slice(0, 160) };
        }
    }
    let cdp = null;
    try {
        const wsUrl = await pageWsUrl(handle.port);
        cdp = await connectCdp(wsUrl);
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        // 有头模式下把窗口顶到最前面（不然可能被别的窗口盖住，用户找不到二维码）
        if (opts.headless === false) {
            try {
                await cdp.send('Page.bringToFront');
            }
            catch { /* ignore */ }
        }
        // ★ 关键一步：把插件保存的凭据注入浏览器。
        //   为什么必须这么做：浏览器 profile 里的 **session cookie 不会持久化**
        //   （Chromium 正常退出时会清掉它们，实测同一 profile 第二次打开 qun.qq.com 仍是未登录）。
        //   所以插件自己的 cookie 文件才是唯一真相源：每次启动都把凭据喂回浏览器，
        //   页面直接就是已登录状态；skey 若已过期，页面会落到登录页，那就走点头像/扫码。
        const saved = loadQunCookie(dataRoot);
        if (saved) {
            try {
                await cdp.send('Network.enable');
                const pairs = [
                    ['uin', 'o' + saved.uin],
                    ['p_uin', 'o' + saved.uin],
                    ['skey', saved.skey],
                ];
                if (saved.p_skey)
                    pairs.push(['p_skey', saved.p_skey]);
                for (const [name, value] of pairs) {
                    if (!value)
                        continue;
                    try {
                        await cdp.send('Network.setCookie', { name, value, domain: '.qq.com', path: '/', secure: true });
                    }
                    catch { /* 单个 cookie 失败不影响其它 */ }
                }
                await cdp.send('Page.navigate', { url: LOGIN_URL });
                await sleep(1800);
            }
            catch { /* 注入失败就照常走未登录流程 */ }
        }
        // 等页面就绪：**先看 profile 里还登着没**（登着就一次都不用登，直接拿走）
        let hit = null;
        for (let i = 0; i < 24; i++) {
            await sleep(500);
            const ready = await evalJs(cdp, 'document.readyState');
            if (ready !== 'complete' && ready !== 'interactive')
                continue;
            // ① 最快路径：已有有效登录态
            hit = await tryReadCookie(cdp);
            if (hit)
                break;
            // ② 登录面板渲染出来了吗（头像/二维码都是 JS 动态塞的）
            const has = await evalJs(cdp, `(function(){ return (document.querySelector('#qlogin_list') || document.querySelector('#qrlogin_img') || document.querySelector('#qr_login') || document.querySelector('.qlogin_list')) ? 1 : 0; })()`);
            if (Number(has) === 1 && i >= 3)
                break;
        }
        if (hit) {
            closeSession(dataRoot);
            return { ok: true, msg: `免扫码：profile 里的登录态还有效，直接取用（uin=${hit.uin}）`, cookie: hit };
        }
        // 再补一次（页面可能刚跳完）
        hit = await tryReadCookie(cdp);
        if (hit) {
            closeSession(dataRoot);
            return { ok: true, msg: `免扫码：profile 里的登录态还有效，直接取用（uin=${hit.uin}）`, cookie: hit };
        }
        // ③ 尝试免扫码：点头像授权（profile 里或本机 QQ 客户端提供了账号）
        const n = await clickAvatar(cdp);
        if (n > 0) {
            for (let i = 0; i < 30; i++) {
                await sleep(500);
                const ck = await tryReadCookie(cdp);
                if (ck) {
                    closeSession(dataRoot);
                    return { ok: true, msg: `免扫码登录成功（点头像授权），uin=${ck.uin}`, cookie: ck };
                }
            }
            // 点了但没跳过去：可能是环境校验，继续走扫码兜底
        }
        // ④ 兜底：出二维码
        const qrPath = await shotQr(cdp, dataRoot);
        sessions.set(dataRoot, { handle, cdp, dataRoot, at: Date.now(), qrPath, clicked: n > 0 });
        installExitHook(); // 宿主退出时把浏览器一起带走（不然会成孤儿进程）
        ensureSweeper(); // 空闲超时自动关（不然扫码没扫成会一直挂着）
        return {
            ok: true,
            qrPath,
            msg: n > 0
                ? '点了头像但没跳转成功，已改出二维码。请把二维码发给用户，扫完后调 wait 继续。'
                : '这台机器没有可用的 QQ 登录态（浏览器 profile 里没有、本机也没有 QQ 客户端），已出二维码。请发给用户扫，扫完后调 wait 继续。',
        };
    }
    catch (e) {
        try {
            if (cdp)
                cdp.close();
        }
        catch { /* ignore */ }
        closeSession(dataRoot);
        handle.kill();
        return { ok: false, msg: '浏览器登录出错：' + String(e?.message ?? e).slice(0, 200) };
    }
}
/**
 * 第二步：在已开的会话上继续等（扫码 or 点头像跳转完成）。
 * budgetMs 默认 25 秒 —— 别让工具调用卡太久，用户可以多次调。
 */
export async function qunBrowserLoginWait(dataRoot, budgetMs = 25000) {
    const s = sessions.get(dataRoot);
    if (!s)
        return { ok: false, done: false, msg: '没有正在进行的登录会话，请重新调 start' };
    if (Date.now() - s.at > 5 * 60 * 1000) {
        closeSession(dataRoot);
        return { ok: false, done: false, msg: '登录会话超过 5 分钟已关闭，请重新调 start' };
    }
    const deadline = Date.now() + Math.max(3000, budgetMs);
    let last = '等待扫码/授权…';
    while (Date.now() < deadline) {
        const ck = await tryReadCookie(s.cdp);
        if (ck) {
            closeSession(dataRoot);
            return { ok: true, done: true, msg: `登录成功，uin=${ck.uin}`, cookie: ck };
        }
        // 用户可能扫码后卡在确认；顺带再看看头像（万一 QQ 客户端中途起来了）
        if (!s.clicked) {
            const n = await clickAvatar(s.cdp);
            if (n > 0)
                s.clicked = true;
        }
        const href = await currentHref(s.cdp);
        if (href)
            last = /xui\.ptlogin2/.test(href) ? '等待扫码/授权…' : '已跳转，正在取凭据…';
        await sleep(1500);
    }
    return { ok: true, done: false, msg: `${last}（这一轮没等到，可以再调 wait；二维码 3 分钟内有效）` };
}
/** 退出登录：清掉浏览器 profile 里的 QQ 登录态（一般不用，留着以后"切换账号"用） */
export function clearBrowserProfile(dataRoot) {
    closeSession(dataRoot);
    try {
        rmSync(join(dataRoot, 'browser-profile'), { recursive: true, force: true });
    }
    catch { /* ignore */ }
}
//# sourceMappingURL=qun-login.js.map