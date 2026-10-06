/**
 * botplay-ext.ts — botplay「自定义事件」扩展模块运行时(2026-10-05)
 *
 * 动机(主人 2026-10-05):
 *   现有 botplay 编辑器只有 3 种按钮行为(reply_text / jump_url / command)+ 三档 llmEffect,
 *   "点一次回一句死文本"。想要的事件往往带**状态**(谁签到过、签了几个、能不能结束)与
 *   **越权判定**(结束按钮只有主人能点), 编辑器表达不了 —— 于是让 AI 直接写一个 JS 模块,
 *   事件 JSON 里用 `file` 字段挂上去, 模块用下面这套钩子/上下文自己实现逻辑。
 *
 * 目录(沿用 channel-tools 扩展工具那一套的 extRoot 思路, 见 loadExtensionTools):
 *   {dataRoot}/.qqbot-extensions/botplay/<file>.mjs
 *   —— 挂在**数据根**下, 与 node_modules 分离 ⇒ 插件 npm 升级/重装**永不覆盖**主人的扩展资产。
 *   同名工具/命令两套扩展已经在用 {dataRoot}/.qqbot-extensions/{tools,commands}, botplay 是第三套。
 *
 * 模块契约(ESM, default 导出或具名导出都行):
 *   export default {
 *     name: '签到统计',                    // 可选, 只用于面板显示
 *     onInit(ctx)   { … },                 // 模块首次被某个卡片实例加载时调用(注册按钮 / 建状态)
 *     onClick(ctx, info) { … },            // 某按钮被点击时调用; 返回字符串(非空)则当普通文本回给点击者
 *     onTick(ctx)   { … },                 // 可选: 每分钟被扫一次(卡片仍有效期内); 不想用就不写
 *     onExpire(ctx) { … },                 // 可选: 卡片过期被回收时
 *     onDispose(ctx) { … },                // 可选: 卡片关闭/热重载/插件卸载时, 收尾清理
 *   };
 *   ⚠️ 钩子全部 fail-soft: 抛错只记日志 + 记进诊断, 不影响 QQ 正常聊天、不影响其它事件。
 *
 * ctx 能力(这是本功能的核心价值 —— 编辑器回调给不了的都给到):
 *   · 卡片:   ctx.card() 读写正文 markdown / 按钮列表; 返回 true ⇒ 点击完自动**重发卡片刷新按钮**
 *   · 发消息: ctx.emit 文本(支持 <@openid>) / ctx.markdown / ctx.image / ctx.at  (走插件既有出站链路)
 *   · 持久化: ctx.store.load() / save(obj)  —— 落到数据根下, 升级插件不丢
 *   · 查询:   ctx.user.openid/name/isOwner, ctx.owners, ctx.info.clickedBefore, ctx.peer, ctx.event
 *   · 权限:   模块自己在 onClick 里判 ctx.user.isOwner / ctx.owners.includes(openid) 后决定放不放行
 *             (QQ 客户端侧的按钮权限仍由事件 JSON 的 perm 决定, 默认 all=谁都能点, 细粒度交模块)
 *   · 运行时: ctx.reloadSelf() 热重载自己, ctx.log(...) 落日志
 *
 * 热重载: 模块 URL 带 `?v=<mtime>`(与 extension-store 同款 cache-bust, 见 fileVersion 注释里
 *   那次内存泄漏的坑), 文件一改下次解析卡片就自动加载新版本 —— 不用重启宿主、不用重启插件。
 *
 * 为什么这里要把"卡片状态"做成可控对象而不是直接改 ev.buttons:
 *   ev 是**现读文件**的 live 配置对象, 就地改会污染配置(还会被下一次读取覆盖)。
 *   ⇒ 每次发卡抽一份"实例卡片状态"(contentText/buttons/buttonsPerRow/dirty), 事件配置只读。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Logger } from '../types.js';

/** 自定义事件模块根目录名(相对数据根) */
export const BOTPLAY_EXT_SUBDIR = join('.qqbot-extensions', 'botplay');

/** 模块自有状态文件目录名(相对自定义事件模块根; 与 .mjs 同屋, 升级/重装都不动) */
export const BOTPLAY_EXT_DATA_SUBDIR = 'data';

/** 自定义事件模块根目录绝对路径 */
export function botplayExtDir(dataRoot: string): string {
  return join(dataRoot, BOTPLAY_EXT_SUBDIR);
}

/** 某个模块的状态文件绝对路径 */
export function botplayExtStatePath(dataRoot: string, file: string): string {
  return join(dataRoot, BOTPLAY_EXT_SUBDIR, BOTPLAY_EXT_DATA_SUBDIR, `${file}.json`);
}

// ─────────────────────────── 卡片(按钮)契约 ───────────────────────────

/** 自定义模块可提供的按钮(与事件 JSON 的按钮同形, 便于两边共用 keyboard 生成) */
export interface BotplayExtButton {
  id: string;
  label: string;
  visitedLabel?: string;
  style?: number;
  botAction?: { type?: string; text?: string; url?: string };
}

/** ctx.card() 的读写对象 */
export interface BotplayExtCard {
  contentText: string;
  buttons: BotplayExtButton[];
  /** 每行按钮数(1~5; 空=用事件配置里的 buttonsPerRow) */
  buttonsPerRow?: number;
}

/** 发卡时的实例卡片状态(事件配置的只读快照 + 模块覆写层) */
export interface BotplayExtCardState extends BotplayExtCard {
  /** 模块通过 ctx.card().? 改过内容 ⇒ 点完自动重发卡片刷新按钮/正文 */
  dirty: boolean;
  /** 解析模块/跑 onInit 时的错误(面板展示用; 空=正常) */
  error?: string;
  /** 本次解析用的模块文件绝对路径 */
  filePath?: string;
}

// ─────────────────────────── ctx 契约 ───────────────────────────

/** 点击人 / 相关成员的信息 */
export interface BotplayExtUserInfo {
  /** openid(群=member_openid, 私聊=user_openid) */
  openid: string;
  /** 昵称(台账/会话反查; 查不到回落 openid) */
  name: string;
  /** 纯净昵称(不带 openid 尾巴, 适合直接拼进消息) */
  pureName: string;
  /** 是否主人白名单(groupAdmin.owners) */
  isOwner: boolean;
}

/** onClick 的第 2 参 */
export interface BotplayExtClickInfo {
  buttonId: string;
  /** 按钮当时的显示文字 */
  buttonLabel: string;
  /** 同一张卡片上该按钮此前被点过的次数 */
  clickedBefore: number;
}

/** 事件只读元信息 */
export interface BotplayExtEventInfo {
  id: string;
  name: string;
  file: string;
  maxClicks: number;
  expireSec: number;
  /** c2c 私聊 / group 群 */
  scope: 'group' | 'c2c';
  peerId: string;
}

/** 模块自有状态存取(落 {dataRoot}/.qqbot-extensions/botplay/data/<file>.json) */
export interface BotplayExtStore {
  /** 读状态(文件不存在/损坏 → null) */
  load(): Record<string, unknown> | null;
  /** 写状态(原子写 tmp+rename); 失败返回 false */
  save(data: Record<string, unknown>): boolean;
  /** 状态文件绝对路径(诊断/面板展示) */
  path(): string;
}

/** 扩展模块拿到的上下文(每个卡片实例一个; 钩子参数统一是它) */
export interface BotplayExtContext {
  /** 事件只读元信息 */
  readonly event: BotplayExtEventInfo;
  /** 本次卡片实例 id */
  readonly cardId: string;
  /** 同一实例上该按钮此前被点次数(按 卡片+按钮 计) */
  readonly clicked: number;
  /** 点击人(无点击上下文时 openid='' 且 isOwner=false) */
  readonly user: BotplayExtUserInfo;
  /** 主人白名单(groupAdmin.owners) */
  readonly owners: string[];
  /**
   * bot 的 AppID —— 卡片是【代码】，你可以拿它 + appSecret 自己换 access_token，
   *   然后直接 fetch 任何官方接口（不用经过宿主/插件）。见下方 appSecret 的示例。
   */
  readonly appId: string;
  /**
   * bot 的 AppSecret（来自设置页）。**卡片跑在宿主进程里、本来就全权限**，
   *   所以这里直接给你钥匙，而不是替你把能力一项项包出来：
   *
   *   const tok = await (await fetch("https://bots.qq.com/app/getAppAccessToken", {
   *     method: "POST", headers: { "content-type": "application/json" },
   *     body: JSON.stringify({ appId: ctx.appId, clientSecret: ctx.appSecret }),
   *   })).json();                       // -> { access_token, expires_in }
   *   const r = await (await fetch(`https://api.bot.qq.com/v2/groups/${gid}/members/${mid}`, {
   *     headers: { authorization: "QQBot " + tok.access_token },
   *   })).json();                       // -> { username?, code? }
   *
   * ⚠️ token 有效期约 2 小时，建议自己缓存一下（模块级变量即可）；
   * ⚠️ 官方未开放的接口会返回 code（如 11253=无权限），自己判、别当异常。
   */
  readonly appSecret: string;
  /** 事件模块根目录绝对路径({dataRoot}/.qqbot-extensions/botplay) */
  readonly dir: string;
  /** 状态存取 */
  store: BotplayExtStore;
  /** 读写本实例卡片(正文/按钮); 改过 ⇒ 点击后自动重发卡片 */
  card(): BotplayExtCard & { dirty: boolean };
  /** 发文本(支持 <@openid> @人; 群/私聊自动走对链路) */
  emit(text: string, at?: string | string[]): Promise<boolean>;
  /** 发 markdown(按钮卡片正文那种富文本) */
  markdown(content: string): Promise<boolean>;
  /** 发图(网络图 url / 本地文件 localPath) */
  image(source: { url?: string; localPath?: string }): Promise<boolean>;
  /** 发纯文本(与 markdown 分开: 纯文本不走卡片通道) */
  text(text: string): Promise<boolean>;
  /** 发任意媒体: kind = image / voice / video / file */
  media(kind: 'image' | 'voice' | 'video' | 'file', source: { url?: string; localPath?: string }): Promise<boolean>;
  /** 发语音 */
  voice(source: { url?: string; localPath?: string }): Promise<boolean>;
  /** 发视频 */
  video(source: { url?: string; localPath?: string }): Promise<boolean>;
  /** 发文件 */
  file(source: { url?: string; localPath?: string }): Promise<boolean>;
  /** 发 markdown + 按钮键盘(button 卡片正文那种) */
  markdownCard(content: string, keyboard?: unknown): Promise<boolean>;
  /**
   * 静默进入 AI 上下文：作为一条 user/message 追加进会话，**不唤醒** AI。
   *   AI 下一轮自然能看到（复用框架 llmEffect 的 append_silent 档）。
   *   适合"记录发生了什么"：比如把某人签到写进对话历史，但不打扰模型。
   */
  /**
   * 【带 token 的官方 API 调用】—— 框架负责 access_token 与缓存，模块只管给 path。
   *   path 不含 host，形如 /v2/groups/{group_openid}/members/{member_openid}。
   *   返回 { ok:true, data } | { ok:false, err:{ code, human } }（human 是人话）。
   *   例：const r = await ctx.api("/v2/groups/" + gid + "/members/" + mid)
   *      if (r.ok) nickname = r.data.username
   *   ⚠️ 官方未开放的接口会返回错误码（如 11253 = 无权限），自己判 err.code。
   */
  api(path: string, opts?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown }): Promise<
    { ok: true; data: unknown } | { ok: false; err: { code: string; human: string } }
  >;
  appendSilent(text: string): Promise<boolean>;
  /**
   * 记录**并唤醒** AI：追加进会话后触发一次 AI 回合（AI 可能回话/发群消息）。
   *   复用框架 llmEffect 的 append_wake 档。适合"这里需要 AI 出手"，
   *   例如签到结束后让 AI 写一句总结。⚠️ 会消耗 token，别在高频点击里无脑调。
   */
  appendWake(text: string): Promise<boolean>;
  /** @某人(返回 `<@openid>` 片段, 拼进 emit 文本即可) */
  at(openid: string): string;
  /** 查群成员/私聊对象昵称(台账反查; 查不到回落 openid) */
  getMember(openid: string): { openid: string; name: string; pureName: string };
  /** 本实例该按钮被点过的总次数 */
  clickCount(buttonId?: string): number;
  /** 热重载本模块(下次解析卡片时用新代码) */
  reloadSelf(): Promise<{ ok: boolean; msg: string }>;
  /** 模块日志(落插件 logger) */
  log(...args: unknown[]): void;
}

/** 自定义事件模块导出形状(全部钩子可选, 但至少要有一个才认) */
export interface BotplayExtModule {
  name?: string;
  onInit?: (ctx: BotplayExtContext) => unknown | Promise<unknown>;
  onClick?: (ctx: BotplayExtContext, info: BotplayExtClickInfo) => unknown | Promise<unknown>;
  onTick?: (ctx: BotplayExtContext) => unknown | Promise<unknown>;
  onExpire?: (ctx: BotplayExtContext) => unknown | Promise<unknown>;
  onDispose?: (ctx: BotplayExtContext) => unknown | Promise<unknown>;
}

/** 归一化后的模块定义(带来源文件名/mtime) */
export interface BotplayExtLoaded {
  /** 模块文件名(含扩展名) */
  file: string;
  /** 绝对路径 */
  path: string;
  /** mtime(ms) —— 热重载判据 + 面板展示 */
  mtime: number;
  /** 显示名(模块 name 或文件名) */
  name: string;
  /** 模块本体 */
  mod: BotplayExtModule;
}

// ─────────────────────────── ctx 构造依赖 ───────────────────────────

export interface BotplayExtCtxDeps {
  dataRoot: string;
  logger: Logger;
  owners: string[];
  /** bot 凭证 getter（卡片 = 代码，直接把钥匙给它，让它自己调官方 API） */
  credentialsGetter?: () => { appId: string; appSecret: string };
  /** 当前实例卡片状态(可写; ctx.card() 直接操作它) */
  cardState: BotplayExtCardState;
  /** 发文本 */
  emit(text: string): Promise<boolean>;
  /** 发 markdown */
  markdown(content: string): Promise<boolean>;
  /** 发图 */
  image(source: { url?: string; localPath?: string }): Promise<boolean>;
  /** 发纯文本（可选；缺省 = 该能力返回 false） */
  text?(text: string): Promise<boolean>;
  /** 发任意媒体（可选）：kind = image / voice / video / file */
  media?(kind: 'image' | 'voice' | 'video' | 'file', source: { url?: string; localPath?: string }): Promise<boolean>;
  /** 发 markdown + 按钮键盘（可选） */
  markdownCard?(content: string, keyboard?: unknown): Promise<boolean>;
  /** 昵称反查(台账/会话; 返回纯昵称, 查不到回落 openid) */
  memberName(openid: string): string;
  /**
   * 影响 LLM 上下文（可选）：append_silent 只落上下文；append_wake 还会唤醒一轮。
   *   由 botplay.ts 注入（内部转调它自己的 applyEffect）；未注入时模块调用得 false。
   */
  onLlmAppend?: (mode: 'append_silent' | 'append_wake', text: string) => Promise<boolean>;

  /** 带 token 的通用官方 API 调用（可选）：由 botplay.ts 注入，转调 GroupAdminClient.apiCall */
  onApiCall?: (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ) => Promise<{ ok: true; data: unknown } | { ok: false; err: { code: string; human: string } }>;
  /** 热重载自己 */
  reloadSelf(): Promise<{ ok: boolean; msg: string }>;
  /** 本实例该按钮(不传=全部按钮)被点过的次数 */
  clickCount(buttonId?: string): number;
  /** 诊断日志落盘(可选; 面板可看) */
  diag?: (line: string) => void;
}

/** 构造一个卡片实例的 ctx(每次 resolveCard / onClick 都 new 一个, 保证 user 是最新的点击人) */
export function makeExtContext(
  deps: BotplayExtCtxDeps,
  ev: {
    id: string; name: string; file: string; maxClicks?: number; expireSec?: number;
    scope: 'group' | 'c2c'; peerId: string;
  },
  cardId: string,
  clicker?: { openid: string; clickedBefore: number },
): BotplayExtContext {
  const stateFile = botplayExtStatePath(deps.dataRoot, ev.file);

  /** 统一入口：模块要"进 AI 上下文"时转给注入的回调（没注入就返回 false，不抛错） */
  const runLlmEffect = async (mode: 'append_silent' | 'append_wake', text: string): Promise<boolean> => {
    const t = String(text ?? '').trim();
    if (!t) return false;
    if (typeof deps.onLlmAppend !== 'function') {
      deps.logger.warn?.('[botplay-ext] 本次未注入 onLlmAppend，append 请求被忽略');
      return false;
    }
    try { return (await deps.onLlmAppend(mode, t)) === true } catch (err) {
      deps.logger.warn?.(`[botplay-ext] ${ev.file} append 失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };
  const openid = clicker?.openid ?? '';
  return {
    event: {
      id: ev.id,
      name: ev.name,
      file: ev.file,
      maxClicks: Number(ev.maxClicks ?? 0) || 0,
      expireSec: Number(ev.expireSec ?? 600) || 600,
      scope: ev.scope,
      peerId: ev.peerId,
    },
    cardId,
    clicked: clicker?.clickedBefore ?? 0,
    get user(): BotplayExtUserInfo {
      return {
        openid,
        name: openid ? deps.memberName(openid) : '',
        pureName: openid ? deps.memberName(openid) : '',
        isOwner: !!openid && deps.owners.includes(openid),
      };
    },
    owners: deps.owners.slice(),
      /** 只读：bot AppID（卡片可拿它 + appSecret 自己换 token 调官方 API） */
      get appId(): string {
        try { return String((deps.credentialsGetter?.() || {}).appId || '') } catch { return '' }
      },
      /** 只读：bot AppSecret（同上；卡片是代码，直接给钥匙而不是包能力） */
      get appSecret(): string {
        try { return String((deps.credentialsGetter?.() || {}).appSecret || '') } catch { return '' }
      },
      /**
       * 静默进入 AI 上下文：作为一条 user/message 追加进会话，不唤醒 AI。
       *   复用框架 llmEffect 的 append_silent 档；AI 下一轮自然能看到。
       */
      appendSilent: (text: string): Promise<boolean> => runLlmEffect('append_silent', text),
      /**
       * 记录并唤醒 AI：追加进会话后触发一次 AI 回合（AI 可能回话/发群消息）。
       *   复用 llmEffect 的 append_wake 档。⚠️ 耗 token，别在高频点击里无脑调。
       */
      appendWake: (text: string): Promise<boolean> => runLlmEffect('append_wake', text),
      /** 带 token 的官方 API 调用（框架拿 token；模块只管 path） */
      api: async (
        path: string,
        opts?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
      ): Promise<{ ok: true; data: unknown } | { ok: false; err: { code: string; human: string } }> => {
        if (typeof deps.onApiCall !== 'function') {
          return { ok: false, err: { code: 'NO_API', human: '本次运行未注入 onApiCall，API 调用不可用' } };
        }
        return deps.onApiCall((opts && opts.method) || 'GET', path, opts ? opts.body : undefined);
      },
    dir: botplayExtDir(deps.dataRoot),
    store: {
      load(): Record<string, unknown> | null {
        try {
          const raw = readFileSync(stateFile, 'utf8');
          const o = JSON.parse(raw) as unknown;
          return o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
        } catch {
          return null; // 文件不存在/坏 → 当空状态(fail-soft)
        }
      },
      save(data: Record<string, unknown>): boolean {
        try {
          mkdirSync(dirname(stateFile), { recursive: true });
          const tmp = `${stateFile}.tmp-${Date.now()}`;
          writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
          renameSync(tmp, stateFile); // 原子写(tmp+rename, 仿 chat-ledger/botplay-store)
          return true;
        } catch (err) {
          deps.logger.warn?.(`[botplay-ext] ${ev.file} 状态写入失败: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        }
      },
      path: () => stateFile,
    },
    card(): BotplayExtCard & { dirty: boolean } {
      return deps.cardState as BotplayExtCard & { dirty: boolean };
    },
    emit: (text: string, at?: string | string[]): Promise<boolean> => {
      const ids = at === undefined ? [] : (Array.isArray(at) ? at : [at]);
      const prefix = ids.filter(Boolean).map((id) => `<@${id}> `).join('');
      return deps.emit(prefix + String(text ?? ''));
    },
    markdown: (content: string): Promise<boolean> => deps.markdown(String(content ?? '')),
    image: (source) => deps.image(source),
    text: (t: string) => (typeof deps.text === 'function' ? deps.text(String(t ?? '')) : Promise.resolve(false)),
    media: (kind, source) => (typeof deps.media === 'function' ? deps.media(kind, source) : Promise.resolve(false)),
    voice: (source) => (typeof deps.media === 'function' ? deps.media('voice', source) : Promise.resolve(false)),
    video: (source) => (typeof deps.media === 'function' ? deps.media('video', source) : Promise.resolve(false)),
    file: (source) => (typeof deps.media === 'function' ? deps.media('file', source) : Promise.resolve(false)),
    markdownCard: (c: string, kb?: unknown) => (typeof deps.markdownCard === 'function' ? deps.markdownCard(String(c ?? ''), kb) : Promise.resolve(false)),
    at: (id: string) => `<@${String(id ?? '')}>`,
    getMember: (id: string) => {
      const nm = deps.memberName(String(id ?? ''));
      return { openid: String(id ?? ''), name: nm, pureName: nm };
    },
    clickCount: (buttonId?: string) => deps.clickCount(buttonId),
    reloadSelf: () => deps.reloadSelf(),
    log: (...args: unknown[]): void => {
      try { deps.logger.info?.(`[botplay-ext:${ev.file}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`); } catch { /* 日志失败无所谓 */ }
    },
  };
}

// ─────────────────────────── 诊断日志(面板可见) ───────────────────────────

/**
 * 扩展诊断落盘: {dataRoot}/.qqbot-extensions/botplay/botplay-ext.log
 * 为什么单独一个文件: 事件加载/点击是**宿主进程内的静默失败**高发区(模块语法错、
 * 钩子抛错、路径不对), 全埋进 logger 时面板/主人根本看不到; 落个文件, 面板能读、主人能看。
 */
export function appendExtDiag(dataRoot: string, line: string): void {
  try {
    const dir = botplayExtDir(dataRoot);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'botplay-ext.log'), `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch { /* 诊断失败绝不抛 */ }
}

/** 读诊断尾部 N 行(面板用) */
export function readExtDiagTail(dataRoot: string, limit = 40): string[] {
  try {
    const p = join(botplayExtDir(dataRoot), 'botplay-ext.log');
    if (!existsSync(p)) return [];
    const lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
    return lines.slice(-Math.max(1, Math.min(500, limit)));
  } catch {
    return [];
  }
}
