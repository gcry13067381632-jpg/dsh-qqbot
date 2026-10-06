import type { Logger } from '../types.js';
/** 自定义事件模块根目录名(相对数据根) */
export declare const BOTPLAY_EXT_SUBDIR: string;
/** 模块自有状态文件目录名(相对自定义事件模块根; 与 .mjs 同屋, 升级/重装都不动) */
export declare const BOTPLAY_EXT_DATA_SUBDIR = "data";
/** 自定义事件模块根目录绝对路径 */
export declare function botplayExtDir(dataRoot: string): string;
/** 某个模块的状态文件绝对路径 */
export declare function botplayExtStatePath(dataRoot: string, file: string): string;
/** 自定义模块可提供的按钮(与事件 JSON 的按钮同形, 便于两边共用 keyboard 生成) */
export interface BotplayExtButton {
    id: string;
    label: string;
    visitedLabel?: string;
    style?: number;
    botAction?: {
        type?: string;
        text?: string;
        url?: string;
    };
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
    card(): BotplayExtCard & {
        dirty: boolean;
    };
    /** 发文本(支持 <@openid> @人; 群/私聊自动走对链路) */
    emit(text: string, at?: string | string[]): Promise<boolean>;
    /** 发 markdown(按钮卡片正文那种富文本) */
    markdown(content: string): Promise<boolean>;
    /** 发图(网络图 url / 本地文件 localPath) */
    image(source: {
        url?: string;
        localPath?: string;
    }): Promise<boolean>;
    /** 发纯文本(与 markdown 分开: 纯文本不走卡片通道) */
    text(text: string): Promise<boolean>;
    /** 发任意媒体: kind = image / voice / video / file */
    media(kind: 'image' | 'voice' | 'video' | 'file', source: {
        url?: string;
        localPath?: string;
    }): Promise<boolean>;
    /** 发语音 */
    voice(source: {
        url?: string;
        localPath?: string;
    }): Promise<boolean>;
    /** 发视频 */
    video(source: {
        url?: string;
        localPath?: string;
    }): Promise<boolean>;
    /** 发文件 */
    file(source: {
        url?: string;
        localPath?: string;
    }): Promise<boolean>;
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
    api(path: string, opts?: {
        method?: "GET" | "POST" | "PATCH" | "DELETE";
        body?: unknown;
    }): Promise<{
        ok: true;
        data: unknown;
    } | {
        ok: false;
        err: {
            code: string;
            human: string;
        };
    }>;
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
    getMember(openid: string): {
        openid: string;
        name: string;
        pureName: string;
    };
    /** 本实例该按钮被点过的总次数 */
    clickCount(buttonId?: string): number;
    /** 热重载本模块(下次解析卡片时用新代码) */
    reloadSelf(): Promise<{
        ok: boolean;
        msg: string;
    }>;
    /** 模块日志(落插件 logger) */
    log(...args: unknown[]): void;
    /**
     * ★ **内核句柄（"遥控器"）**= 插件自己的 cordis Context —— 与扩展工具/命令的 `env.ctx` 是同一个东西。
     *
     * 注意到命名差异：**这个对象本身就叫 `ctx`，所以遥控器放在 `ctx.kernel` 上**（避免 `ctx.ctx`）。
     *
     * 拿到它能做受控能力做不到的事：`ctx.get('sessions')` / `ctx.compaction.compactNow(...)` /
     * `ctx.on('session/event', fn)` / `ctx.webServer.register(...)` / `ctx.tools.register(...)`。
     *
     * ⚠️ 三条代价：① 形状跟随 dsh 版本（升级可能失效，成品能力才是主路）
     * ② `register`/`on` 返回的 disposer **要自己收尾**，否则热重载会累积
     * ③ 全权限 —— 这是你自己机器上自己写的代码，权利归你；但别转手给不信任的代码。
     */
    kernel: unknown;
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
export interface BotplayExtCtxDeps {
    dataRoot: string;
    logger: Logger;
    owners: string[];
    /** bot 凭证 getter（卡片 = 代码，直接把钥匙给它，让它自己调官方 API） */
    credentialsGetter?: () => {
        appId: string;
        appSecret: string;
    };
    /** 当前实例卡片状态(可写; ctx.card() 直接操作它) */
    cardState: BotplayExtCardState;
    /** 发文本 */
    emit(text: string): Promise<boolean>;
    /** 发 markdown */
    markdown(content: string): Promise<boolean>;
    /** 发图 */
    image(source: {
        url?: string;
        localPath?: string;
    }): Promise<boolean>;
    /** 发纯文本（可选；缺省 = 该能力返回 false） */
    text?(text: string): Promise<boolean>;
    /** 发任意媒体（可选）：kind = image / voice / video / file */
    media?(kind: 'image' | 'voice' | 'video' | 'file', source: {
        url?: string;
        localPath?: string;
    }): Promise<boolean>;
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
    onApiCall?: (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<{
        ok: true;
        data: unknown;
    } | {
        ok: false;
        err: {
            code: string;
            human: string;
        };
    }>;
    /** 热重载自己 */
    reloadSelf(): Promise<{
        ok: boolean;
        msg: string;
    }>;
    /** 本实例该按钮(不传=全部按钮)被点过的次数 */
    clickCount(buttonId?: string): number;
    /** 诊断日志落盘(可选; 面板可看) */
    diag?: (line: string) => void;
    /** ★ 插件 ctx（"遥控器"）：与扩展工具/命令对齐，卡片也能拿到全权限 */
    kernel?: unknown;
}
/** 构造一个卡片实例的 ctx(每次 resolveCard / onClick 都 new 一个, 保证 user 是最新的点击人) */
export declare function makeExtContext(deps: BotplayExtCtxDeps, ev: {
    id: string;
    name: string;
    file: string;
    maxClicks?: number;
    expireSec?: number;
    scope: 'group' | 'c2c';
    peerId: string;
}, cardId: string, clicker?: {
    openid: string;
    clickedBefore: number;
}): BotplayExtContext;
/**
 * 扩展诊断落盘: {dataRoot}/.qqbot-extensions/botplay/botplay-ext.log
 * 为什么单独一个文件: 事件加载/点击是**宿主进程内的静默失败**高发区(模块语法错、
 * 钩子抛错、路径不对), 全埋进 logger 时面板/主人根本看不到; 落个文件, 面板能读、主人能看。
 */
export declare function appendExtDiag(dataRoot: string, line: string): void;
/** 读诊断尾部 N 行(面板用) */
export declare function readExtDiagTail(dataRoot: string, limit?: number): string[];
//# sourceMappingURL=botplay-ext.d.ts.map