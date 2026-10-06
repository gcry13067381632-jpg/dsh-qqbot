/**
 * ext-capabilities.ts — 给「用户扩展」用的统一能力包（2026-10-06）
 *
 * ── 为什么有这个东西 ───────────────────────────────────────────────
 * 插件有三套用户扩展：`commands/`（自定义斜杠命令）、`tools/`（自定义 QQ 工具）、
 * `botplay/`（卡片事件模块）。三套的能力面原本**严重不均**：
 *
 *   · botplay 卡片：`card()` / `emit` / `markdown` / `image` / `at` / `store` /
 *     `api()` / **`appId`+`appSecret`** / `appendWake` —— 精装版
 *   · 扩展工具  ：只有裸 `{cwd, manager, sender, replyTarget, exec, ctx, logger}`
 *                 —— 想发张卡得自己 `sender.sendMarkdown(target, text)`，
 *                    以至于主人不得不专门写一个 `send_md.mjs` 来干这一件事
 *   · 自定义命令：**最窄**，只有一个消息 ctx
 *
 * 本模块把「大家都该有」的那部分做成**一套**，三处注入同一个面：
 * 让**第三方作者**写扩展时不用再自己接生。
 *
 * ── 拿到什么（写扩展时直接 `env.xxx` / `caps.xxx`）───────────────────
 *   发送： text(s) / markdown(s) / markdownCard(s) / image(src) / voice(src) /
 *          video(src) / file(src) / media(kind, src) / at(openid)
 *   官方 API： appId / appSecret / api(path, {method, body})
 *              —— ★ 自带 token 与 2 小时缓存，**不依赖 groupAdmin 开关**
 *   持久化： store.load() / store.save(obj)   （落数据根，插件升级不丢）
 *   上下文： appendSilent(text) / appendWake(text)   ← 见下面「安全」
 *   身份：  user.{openid,name,isOwner} / owners / peer.{scope,peerId}
 *   杂项：  log(...)
 *
 * ── ★ 安全：appendSilent 必须过表面守卫 ─────────────────────────────
 * dsh 的 v4 会话格式要求 `system/message`（人设）是 surface 的**第一个节点**
 * （见 `session/surface-guard.ts` 的事故记录）。全新会话里人设还没落，
 * 此时静默 append 会**把整份会话日志写废**。
 * ⇒ 本模块的 `appendSilent` **一律先过 `canSilentlyAppend()`**，不安全就**拒绝执行**
 *   并返回 false（内容不丢：调用方可以改走 `appendWake`）。
 *   `appendWake` 走的是正常回合（dsh 会先补人设），所以**天然安全**。
 *
 * ── 设计取舍 ───────────────────────────────────────────────────
 * 不直接复用 `botplay-ext.ts` 的 `makeExtContext()`：那个 ctx 带 `card()` /
 * `clickCount` / `reloadSelf` 等**卡片专属**成员，给工具/命令用只会让作者困惑。
 * 这里只做「三套共有」的那一层，实现上仍是同一批底层原语（sender / session / token）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { canSilentlyAppend } from '../session/surface-guard.js';
// ── 自带 token 管理（不依赖 groupAdmin 开关，第三方用户也能用）──────────────
//   key = appId；value = { token, expireAt }。token 官方有效期 ~7200s，这里按 60s 余量提前过期。
const tokenCache = new Map();
async function fetchAccessToken(appId, appSecret) {
    if (!appId || !appSecret)
        return '';
    const hit = tokenCache.get(appId);
    if (hit && Date.now() < hit.expireAt)
        return hit.token;
    const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId, clientSecret: appSecret }),
    });
    const data = (await res.json());
    const token = String(data?.access_token ?? '');
    if (!token)
        throw new Error('拿 access_token 失败(检查 appId/appSecret)');
    const ttl = Number(data?.expires_in ?? 7200);
    tokenCache.set(appId, { token, expireAt: Date.now() + Math.max(60, ttl - 60) * 1000 });
    return token;
}
/** 「url 或本地路径」→ 媒体源对象（第三方作者常直接传字符串） */
function toMediaSource(src) {
    if (typeof src === 'string') {
        return /^https?:\/\//i.test(src) ? { url: src } : { localPath: src };
    }
    return src ?? {};
}
/**
 * 造一份扩展能力包。**永远不会抛**：拿不到的依赖 → 对应能力返回 false / 空值。
 *
 * @param deps - 见 {@link ExtCapsDeps}
 * @returns 能力包（见 {@link ExtCapabilities}）
 */
export function makeExtCaps(deps) {
    const logger = deps.logger;
    const self = String(deps.selfName ?? 'ext');
    const kind = String(deps.kind ?? 'ext');
    const owners = Array.isArray(deps.owners) ? deps.owners.map(String) : [];
    const appId = String(deps.appId ?? '');
    const appSecret = String(deps.appSecret ?? '');
    const actorOpenid = String(deps.actorOpenid ?? '');
    const storeDir = deps.dataRoot ? join(deps.dataRoot, '.qqbot-extensions', kind, 'data') : '';
    const storeFile = storeDir ? join(storeDir, `${self.replace(/\.(mjs?|cjs|js)$/i, '')}.json`) : '';
    const warn = (what, err) => {
        try {
            logger?.warn?.(`[ext-caps] ${self} ${what} 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        catch { /* 日志失败忽略 */ }
    };
    const send = async (what, fn) => {
        try {
            await fn();
            return true;
        }
        catch (err) {
            warn(what, err);
            return false;
        }
    };
    return {
        appId,
        appSecret,
        // ── @人 ────────────────────────────────────────────────────────
        at: (id) => `<@${String(id ?? '')}>`,
        // ── 发送 ───────────────────────────────────────────────────────
        text: (s) => {
            const t = String(s ?? '');
            // ⚠️ 用 trim 判"空"，但发出去的仍是原文（不裁剪内容语义）
            if (!t.trim() || !deps.sender?.sendText)
                return Promise.resolve(false);
            return send('text', () => deps.sender.sendText(deps.replyTarget, t));
        },
        markdown: (s) => {
            const t = String(s ?? '');
            if (!t.trim() || !deps.sender?.sendMarkdown)
                return Promise.resolve(false);
            return send('markdown', () => deps.sender.sendMarkdown(deps.replyTarget, t));
        },
        markdownCard: (s, keyboard) => {
            const t = String(s ?? '');
            if (!t.trim())
                return Promise.resolve(false);
            if (deps.sender?.sendMarkdownWithKeyboard) {
                return send('markdownCard', () => deps.sender.sendMarkdownWithKeyboard(deps.replyTarget, t, keyboard));
            }
            if (deps.sender?.sendMarkdown)
                return send('markdownCard→markdown', () => deps.sender.sendMarkdown(deps.replyTarget, t));
            return Promise.resolve(false);
        },
        media: (k, source) => {
            if (!deps.sender?.sendMedia)
                return Promise.resolve(false);
            return send(`media(${k})`, () => deps.sender.sendMedia(deps.replyTarget, k, toMediaSource(source)));
        },
        image: (source) => {
            if (!deps.sender?.sendMedia)
                return Promise.resolve(false);
            return send('image', () => deps.sender.sendMedia(deps.replyTarget, 'image', toMediaSource(source)));
        },
        voice: (source) => {
            if (!deps.sender?.sendMedia)
                return Promise.resolve(false);
            return send('voice', () => deps.sender.sendMedia(deps.replyTarget, 'voice', toMediaSource(source)));
        },
        video: (source) => {
            if (!deps.sender?.sendMedia)
                return Promise.resolve(false);
            return send('video', () => deps.sender.sendMedia(deps.replyTarget, 'video', toMediaSource(source)));
        },
        file: (source) => {
            if (!deps.sender?.sendMedia)
                return Promise.resolve(false);
            return send('file', () => deps.sender.sendMedia(deps.replyTarget, 'file', toMediaSource(source)));
        },
        // ── 官方 API（自带 token；注入了 apiCall 就优先用注入的）──────────
        api: async (path, opts) => {
            const method = (opts?.method ?? 'GET');
            const p = String(path ?? '');
            if (!p)
                return { ok: false, err: { code: 'BAD_PATH', human: 'path 不能为空' } };
            if (typeof deps.apiCall === 'function') {
                try {
                    return await deps.apiCall(method, p, opts?.body);
                }
                catch (err) {
                    warn('api(injected)', err);
                }
            }
            try {
                const token = await fetchAccessToken(appId, appSecret);
                if (!token)
                    return { ok: false, err: { code: 'NO_CREDENTIALS', human: '未配置 appId/appSecret' } };
                const res = await fetch(`https://api.bot.qq.com${p.startsWith('/') ? p : `/${p}`}`, {
                    method,
                    headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json' },
                    ...(opts?.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
                });
                const text = await res.text();
                let data = text;
                try {
                    data = JSON.parse(text);
                }
                catch { /* 非 JSON 原样返回 */ }
                if (!res.ok)
                    return { ok: false, err: { code: String(res.status), human: `HTTP ${res.status}: ${text.slice(0, 200)}` } };
                return { ok: true, data };
            }
            catch (err) {
                return { ok: false, err: { code: 'THROW', human: err instanceof Error ? err.message : String(err) } };
            }
        },
        // ── 持久化（落数据根，插件升级/重装不丢）─────────────────────────
        store: {
            path: storeFile,
            load() {
                if (!storeFile)
                    return undefined;
                try {
                    if (!existsSync(storeFile))
                        return undefined;
                    return JSON.parse(readFileSync(storeFile, 'utf8'));
                }
                catch (err) {
                    warn('store.load', err);
                    return undefined;
                }
            },
            save(value) {
                if (!storeFile)
                    return false;
                try {
                    mkdirSync(dirname(storeFile), { recursive: true });
                    writeFileSync(storeFile, JSON.stringify(value ?? null, null, 2), 'utf8');
                    return true;
                }
                catch (err) {
                    warn('store.save', err);
                    return false;
                }
            },
        },
        // ── 上下文（★ appendSilent 必须过表面守卫）───────────────────────
        appendSilent: async (text) => {
            const t = String(text ?? '').trim();
            if (!t)
                return false;
            const session = deps.agent?.session;
            if (!session || typeof session.append !== 'function')
                return false;
            if (!canSilentlyAppend(session)) {
                try {
                    logger?.debug?.('[ext-caps] appendSilent 被拒：该会话人设尚未落盘(surface 首节点不是 system/message)，硬写会报废会话日志');
                }
                catch { /* ignore */ }
                return false;
            }
            try {
                session.append('user/message', createUserMessage({ content: [{ type: 'text', text: t }], source: { kind: 'user' } }), { surfaceOp: 'append' });
                return true;
            }
            catch (err) {
                warn('appendSilent', err);
                return false;
            }
        },
        appendWake: async (text) => {
            const t = String(text ?? '').trim();
            if (!t)
                return false;
            const agent = deps.agent;
            // 走正常回合：dsh 会先补人设 → 天然安全，不需要表面守卫
            if (agent && typeof agent.followup === 'function') {
                try {
                    agent.followup(createUserMessage({ content: [{ type: 'text', text: t }], source: { kind: 'user' } }));
                    return true;
                }
                catch (err) {
                    warn('appendWake', err);
                    return false;
                }
            }
            // 没有 followup 能力 ⇒ 退回静默 append（仍受守卫保护）
            return false;
        },
        canAppendSilent: () => canSilentlyAppend(deps.agent?.session),
        // ── 身份 ───────────────────────────────────────────────────────
        user: {
            openid: actorOpenid,
            name: String(deps.actorName ?? ''),
            isOwner: actorOpenid !== '' && owners.includes(actorOpenid),
        },
        owners,
        peer: { scope: String(deps.scope ?? ''), peerId: String(deps.peerId ?? '') },
        log: (...args) => {
            try {
                logger?.info?.(`[ext:${self}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
            }
            catch { /* ignore */ }
        },
    };
}
//# sourceMappingURL=ext-capabilities.js.map