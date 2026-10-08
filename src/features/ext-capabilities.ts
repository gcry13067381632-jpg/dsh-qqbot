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
import { registerExtToolCard } from './ext-tool-cards.js';
import { dirname, join } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { Logger } from '../types.js';
import { canSilentlyAppend } from '../session/surface-guard.js';
import { selfRestart } from '../commands/exit.js';

/** 媒体类型（与 sender.sendMedia 的 kind 对齐） */
export type ExtMediaKind = 'image' | 'voice' | 'video' | 'file';

/** 媒体源：URL 或本机绝对路径（二选一） */
export interface ExtMediaSource {
  url?: string;
  localPath?: string;
}

/** 宿主 sender 里我们用到的子集（全部 duck-typing + 缺失即降级） */
export interface ExtSenderLike {
  sendText?: (target: unknown, text: string) => Promise<unknown>;
  sendMarkdown?: (target: unknown, content: string) => Promise<unknown>;
  sendMarkdownWithKeyboard?: (target: unknown, content: string, keyboard?: unknown) => Promise<unknown>;
  sendMedia?: (target: unknown, kind: string, source: ExtMediaSource) => Promise<unknown>;
}

/** 官方 API 调用结果（与 GroupAdminClient.apiCall 同形） */
export type ExtApiResult =
  | { ok: true; data: unknown }
  | { ok: false; err: { code: string; human: string } };

/** 构造能力包的依赖（能给的都给，给不了的自动降级为「调用返回 false」） */
export interface ExtCapsDeps {
  /** 数据根（store 落盘用）。空 = store 不可用 */
  dataRoot?: string;
  logger?: Logger;
  /** bot 凭证（api / appId / appSecret 用） */
  appId?: string;
  appSecret?: string;
  /** 主人 openid 列表（user.isOwner / owners） */
  owners?: string[];
  /** 当前会话的发送器与目标（没有 = 发送类能力不可用） */
  sender?: ExtSenderLike;
  replyTarget?: unknown;
  /** 当前会话的 agent（appendSilent / appendWake 用） */
  agent?: { session?: unknown; followup?: (msg: unknown) => unknown } | undefined;
  /** 当前会话标识 + 称呼（peer / user 展示用） */
  scope?: string;
  peerId?: string;
  /** 触发者（命令的发送者 / 工具的调用会话所属人） */
  actorOpenid?: string;
  actorName?: string;
  /** 带 token 的官方 API 调用（注入了就优先用它，否则用本模块自带的 token 管理） */
  apiCall?: (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<ExtApiResult>;
  /** 扩展名（store 文件名 / 日志前缀） */
  selfName?: string;
  /** 扩展种类：tools / commands（决定 store 落在哪个子目录） */
  kind?: string;
  /**
   * ★ 插件 ctx（"遥控器"）—— 见 {@link ExtCapabilities.kernel}。
   * 由调用方把插件的 cordis Context 原样传进来；不传 = 没有这个能力。
   */
  kernel?: unknown;
  /**
   * 自重启实现（仅供测试注入；生产走内置 `selfRestart`）。
   * ⚠️ 真跑它会 spawn 一个助手去 kill 宿主进程 —— 测试里**必须**用这个接缝替换。
   */
  restartImpl?: (delayMs?: number) => boolean;
}

/** 能力包对外形状（写扩展时看到的就是这个） */
export interface ExtCapabilities {
  appId: string;
  appSecret: string;
  at(id: string): string;
  text(s: string): Promise<boolean>;
  markdown(s: string): Promise<boolean>;
  markdownCard(s: string, keyboard?: unknown): Promise<boolean>;
  media(kind: ExtMediaKind, source: ExtMediaSource): Promise<boolean>;
  image(source: ExtMediaSource | string): Promise<boolean>;
  voice(source: ExtMediaSource | string): Promise<boolean>;
  video(source: ExtMediaSource | string): Promise<boolean>;
  file(source: ExtMediaSource | string): Promise<boolean>;
  api(path: string, opts?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<ExtApiResult>;
  store: {
    load<T = unknown>(): T | undefined;
    save(value: unknown): boolean;
    path: string;
  };
  /**
   * ★ 登记本工具发出的「回调按钮卡片」（2026-10-08 新增，见 features/ext-tool-cards.ts）。
   *
   * 为什么必须登记：按钮 data 形如 `ext:<工具名>:<卡id>:<按钮id>`，插件收到点击后
   * **要能在注册表里查到这张卡** 才会把事件派发给本工具的 `onInteraction`。
   * 不登记 = 卡照发，但按钮点了没人认（落回原兜底，最终只 ack）。
   *
   * ```js
   * const cardId = 'v' + Date.now().toString(36);
   * env.registerInteractionCard({ cardId, buttonIds: ['yes', 'no'], expireAt: Date.now() + 86400_000 });
   * await env.markdownCard('要投「A」吗？', { content: { rows: [ { buttons: [
   *   { id: 'b1', render_data: { label: '投 A', visited_label: '已投 A', style: 1 },
   *     action: { type: 1, permission: { type: 2 },
   *               data: 'ext:vote:' + cardId + ':yes' } } ] } ] } });
   * ```
   *
   * @param input.cardId 卡 id（必须与按钮 data 里的第二段**完全一致**）
   * @param input.buttonIds 这张卡上所有回调按钮的 id（漏一个 → 那个按钮点了没人认）
   * @param input.expireAt 可选绝对过期时间(ms)；缺省 7 天（投票/签到建议 1~3 天）
   * @returns 是否登记成功；**失败也不影响发卡**（纯旁路）
   */
  registerInteractionCard(input: { cardId: string; buttonIds: string[]; expireAt?: number }): boolean;
  appendSilent(text: string): Promise<boolean>;
  appendWake(text: string): Promise<boolean>;
  canAppendSilent(): boolean;
  user: { openid: string; name: string; isOwner: boolean };
  owners: string[];
  peer: { scope: string; peerId: string };
  log(...args: unknown[]): void;
  /**
   * ★ **内核句柄（"遥控器"）**= 本插件自己的 cordis Context（`ctx`）。
   *
   * 拿到它就能做**受控能力包做不到的事**：
   * ```js
   * const ctx = env.kernel;
   * ctx.get('sessions')                 // 读/建会话
   * ctx.get('tools')                    // 工具注册表
   * ctx.compaction.compactNow(a, s, id) // 调宿主的上下文压缩
   * ctx.on('session/event', fn)         // 订阅宿主事件
   * ctx.webServer.register({ path, handler })  // 开一个 HTTP 路由
   * ```
   *
   * ⚠️ **三条代价（用之前先读）**：
   * 1. **跟随宿主版本**：`ctx` 的形状由 dsh 决定，宿主升级可能让这段代码失效 ——
   *    所以「成品能力」才是主路，`kernel` 是**逃生舱**。
   * 2. **注册要自己收尾**：`ctx.tools.register()` / `ctx.on()` / `ctx.webServer.register()`
   *    都返回 disposer；不 dispose 的话，热重载会**不断累积**（本插件自己也踩过这个坑，
   *    见维护手册铁律 8：disposer 要存到跨模块实例可见的地方）。
   * 3. **全权限**：它等价于"把遥控器交出去"。这是**你自己机器上、你自己写的代码**，
   *    所以本来就是你的权利 —— 但别把它转手给不信任的代码。
   */
  kernel: unknown;
  /**
   * 触发宿主自重启（等价于内置的 `/bot-restart`）。
   *
   * 实现直接复用插件自己的 `selfRestart()` —— 它已经填平了所有坑
   * （动态识别启动命令、**强制补 `--no-open`**、助手写系统 tmpdir 避开中文路径、
   * detached+unref 保证宿主被杀后照样能拉起）。**别自己 spawn，很容易写错。**
   *
   * @param opts.requireOwner - 默认 `true`：只有主人（`env.user.isOwner`）触发才生效，
   *   防止 AI 被群友一句话钓去重启机器人。**你自己的场景要谁都能重启，就传 `false`。**
   * @param opts.delayMs - 延迟多久开始（默认 1600ms，给回执留时间）
   * @returns 是否已触发（不代表重启成功，只代表助手已脱手启动）
   */
  restart(opts?: { requireOwner?: boolean; delayMs?: number }): boolean;
}

// ── 自带 token 管理（不依赖 groupAdmin 开关，第三方用户也能用）──────────────
//   key = appId；value = { token, expireAt }。token 官方有效期 ~7200s，这里按 60s 余量提前过期。
const tokenCache = new Map<string, { token: string; expireAt: number }>();

async function fetchAccessToken(appId: string, appSecret: string): Promise<string> {
  if (!appId || !appSecret) return '';
  const hit = tokenCache.get(appId);
  if (hit && Date.now() < hit.expireAt) return hit.token;
  const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret: appSecret }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number | string };
  const token = String(data?.access_token ?? '');
  if (!token) throw new Error('拿 access_token 失败(检查 appId/appSecret)');
  const ttl = Number(data?.expires_in ?? 7200);
  tokenCache.set(appId, { token, expireAt: Date.now() + Math.max(60, ttl - 60) * 1000 });
  return token;
}

/** 「url 或本地路径」→ 媒体源对象（第三方作者常直接传字符串） */
function toMediaSource(src: ExtMediaSource | string): ExtMediaSource {
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
export function makeExtCaps(deps: ExtCapsDeps): ExtCapabilities {
  const logger = deps.logger;
  const self = String(deps.selfName ?? 'ext');
  const kind = String(deps.kind ?? 'ext');
  const owners = Array.isArray(deps.owners) ? deps.owners.map(String) : [];
  const appId = String(deps.appId ?? '');
  const appSecret = String(deps.appSecret ?? '');
  const actorOpenid = String(deps.actorOpenid ?? '');

  const storeDir = deps.dataRoot ? join(deps.dataRoot, '.qqbot-extensions', kind, 'data') : '';
  const storeFile = storeDir ? join(storeDir, `${self.replace(/\.(mjs?|cjs|js)$/i, '')}.json`) : '';

  const warn = (what: string, err: unknown): void => {
    try {
      logger?.warn?.(`[ext-caps] ${self} ${what} 失败: ${err instanceof Error ? err.message : String(err)}`);
    } catch { /* 日志失败忽略 */ }
  };

  const send = async (what: string, fn: () => Promise<unknown>): Promise<boolean> => {
    try { await fn(); return true; } catch (err) { warn(what, err); return false; }
  };

  return {
    appId,
    appSecret,

    // ── @人 ────────────────────────────────────────────────────────
    at: (id: string) => `<@${String(id ?? '')}>`,

    // ── 发送 ───────────────────────────────────────────────────────
    text: (s: string) => {
      const t = String(s ?? '');
      // ⚠️ 用 trim 判"空"，但发出去的仍是原文（不裁剪内容语义）
      if (!t.trim() || !deps.sender?.sendText) return Promise.resolve(false);
      return send('text', () => deps.sender!.sendText!(deps.replyTarget, t));
    },
    markdown: (s: string) => {
      const t = String(s ?? '');
      if (!t.trim() || !deps.sender?.sendMarkdown) return Promise.resolve(false);
      return send('markdown', () => deps.sender!.sendMarkdown!(deps.replyTarget, t));
    },
    markdownCard: (s: string, keyboard?: unknown) => {
      const t = String(s ?? '');
      if (!t.trim()) return Promise.resolve(false);
      if (deps.sender?.sendMarkdownWithKeyboard) {
        return send('markdownCard', () => deps.sender!.sendMarkdownWithKeyboard!(deps.replyTarget, t, keyboard));
      }
      if (deps.sender?.sendMarkdown) return send('markdownCard→markdown', () => deps.sender!.sendMarkdown!(deps.replyTarget, t));
      return Promise.resolve(false);
    },
    media: (k: ExtMediaKind, source: ExtMediaSource) => {
      if (!deps.sender?.sendMedia) return Promise.resolve(false);
      return send(`media(${k})`, () => deps.sender!.sendMedia!(deps.replyTarget, k, toMediaSource(source)));
    },
    image: (source) => {
      if (!deps.sender?.sendMedia) return Promise.resolve(false);
      return send('image', () => deps.sender!.sendMedia!(deps.replyTarget, 'image', toMediaSource(source)));
    },
    voice: (source) => {
      if (!deps.sender?.sendMedia) return Promise.resolve(false);
      return send('voice', () => deps.sender!.sendMedia!(deps.replyTarget, 'voice', toMediaSource(source)));
    },
    video: (source) => {
      if (!deps.sender?.sendMedia) return Promise.resolve(false);
      return send('video', () => deps.sender!.sendMedia!(deps.replyTarget, 'video', toMediaSource(source)));
    },
    file: (source) => {
      if (!deps.sender?.sendMedia) return Promise.resolve(false);
      return send('file', () => deps.sender!.sendMedia!(deps.replyTarget, 'file', toMediaSource(source)));
    },

    // ── 官方 API（自带 token；注入了 apiCall 就优先用注入的）──────────
    api: async (path, opts) => {
      const method = (opts?.method ?? 'GET') as 'GET' | 'POST' | 'PATCH' | 'DELETE';
      const p = String(path ?? '');
      if (!p) return { ok: false, err: { code: 'BAD_PATH', human: 'path 不能为空' } };
      if (typeof deps.apiCall === 'function') {
        try { return await deps.apiCall(method, p, opts?.body); } catch (err) { warn('api(injected)', err); }
      }
      try {
        const token = await fetchAccessToken(appId, appSecret);
        if (!token) return { ok: false, err: { code: 'NO_CREDENTIALS', human: '未配置 appId/appSecret' } };
        const res = await fetch(`https://api.bot.qq.com${p.startsWith('/') ? p : `/${p}`}`, {
          method,
          headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json' },
          ...(opts?.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        });
        const text = await res.text();
        let data: unknown = text;
        try { data = JSON.parse(text); } catch { /* 非 JSON 原样返回 */ }
        if (!res.ok) return { ok: false, err: { code: String(res.status), human: `HTTP ${res.status}: ${text.slice(0, 200)}` } };
        return { ok: true, data };
      } catch (err) {
        return { ok: false, err: { code: 'THROW', human: err instanceof Error ? err.message : String(err) } };
      }
    },

    // ── 持久化（落数据根，插件升级/重装不丢）─────────────────────────
    store: {
      path: storeFile,
      load<T = unknown>(): T | undefined {
        if (!storeFile) return undefined;
        try {
          if (!existsSync(storeFile)) return undefined;
          return JSON.parse(readFileSync(storeFile, 'utf8')) as T;
        } catch (err) { warn('store.load', err); return undefined; }
      },
      save(value: unknown): boolean {
        if (!storeFile) return false;
        try {
          mkdirSync(dirname(storeFile), { recursive: true });
          writeFileSync(storeFile, JSON.stringify(value ?? null, null, 2), 'utf8');
          return true;
        } catch (err) { warn('store.save', err); return false; }
      },
    },

    // ── 回调按钮卡片登记（2026-10-08 新增）──────────────────────────
    //   工具发卡时调一下，把 cardId / buttonIds 登记进
    //   `{dataRoot}/.qqbot/ext-tool-cards.json` —— 点击事件到达时插件靠它认领
    //   （分发链见 features/ext-tool-interaction.ts）。
    //   ⚠️ 纯旁路：登记失败**不影响发卡**（卡照发，只是按钮点了落回原兜底、最终只 ack）。
    registerInteractionCard: (input) => {
      try {
        if (!deps.dataRoot) return false;
        const cardId = String(input?.cardId ?? '').trim();
        const buttonIds = (Array.isArray(input?.buttonIds) ? input.buttonIds : [])
          .map((x) => String(x ?? '').trim())
          .filter(Boolean);
        if (!cardId || buttonIds.length === 0) return false;
        const expireAt = Number(input?.expireAt);
        const ttlMs = Number.isFinite(expireAt) && expireAt > Date.now() ? expireAt - Date.now() : undefined;
        return registerExtToolCard(deps.dataRoot, {
          toolName: self,
          cardId,
          buttonIds,
          scope: String(deps.scope ?? ''),
          targetId: String(deps.peerId ?? ''),
          ...(ttlMs === undefined ? {} : { ttlMs }),
        });
      } catch (err) {
        warn('registerInteractionCard', err);
        return false;
      }
    },

    // ── 上下文（★ appendSilent 必须过表面守卫）───────────────────────
    appendSilent: async (text: string): Promise<boolean> => {
      const t = String(text ?? '').trim();
      if (!t) return false;
      const session = deps.agent?.session as { append?: (type: string, data: unknown, opts?: { surfaceOp?: string }) => unknown } | undefined;
      if (!session || typeof session.append !== 'function') return false;
      if (!canSilentlyAppend(session)) {
        try {
          logger?.debug?.('[ext-caps] appendSilent 被拒：该会话人设尚未落盘(surface 首节点不是 system/message)，硬写会报废会话日志');
        } catch { /* ignore */ }
        return false;
      }
      try {
        session.append('user/message', createUserMessage({ content: [{ type: 'text', text: t }], source: { kind: 'user' } }), { surfaceOp: 'append' });
        return true;
      } catch (err) { warn('appendSilent', err); return false; }
    },
    appendWake: async (text: string): Promise<boolean> => {
      const t = String(text ?? '').trim();
      if (!t) return false;
      const agent = deps.agent;
      // 走正常回合：dsh 会先补人设 → 天然安全，不需要表面守卫
      if (agent && typeof agent.followup === 'function') {
        try {
          agent.followup(createUserMessage({ content: [{ type: 'text', text: t }], source: { kind: 'user' } }));
          return true;
        } catch (err) { warn('appendWake', err); return false; }
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

    log: (...args: unknown[]) => {
      try { logger?.info?.(`[ext:${self}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`); }
      catch { /* ignore */ }
    },

    // ── 内核句柄（遥控器）────────────────────────────────────────────
    kernel: deps.kernel,

    // ── 宿主自重启（复用内置 /bot-restart 的实现，别自己 spawn）──────
    restart: (opts?: { requireOwner?: boolean; delayMs?: number }): boolean => {
      const requireOwner = opts?.requireOwner !== false;   // 默认：仅主人
      const isOwner = actorOpenid !== '' && owners.includes(actorOpenid);
      if (requireOwner && !isOwner) {
        try { logger?.warn?.(`[ext-caps] ${self} restart 被拒：仅主人可触发（想放开就传 { requireOwner: false }）`); }
        catch { /* ignore */ }
        return false;
      }
      try {
        logger?.warn?.(`[ext-caps] ${self} 触发了宿主自重启（owner=${isOwner} actor=${actorOpenid || '(未知)'}）`);
      } catch { /* ignore */ }
      return (deps.restartImpl ?? selfRestart)(opts?.delayMs);
    },
  };
}
