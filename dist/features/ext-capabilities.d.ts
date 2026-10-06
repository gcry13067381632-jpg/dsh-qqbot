import type { Logger } from '../types.js';
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
export type ExtApiResult = {
    ok: true;
    data: unknown;
} | {
    ok: false;
    err: {
        code: string;
        human: string;
    };
};
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
    agent?: {
        session?: unknown;
        followup?: (msg: unknown) => unknown;
    } | undefined;
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
    api(path: string, opts?: {
        method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
        body?: unknown;
    }): Promise<ExtApiResult>;
    store: {
        load<T = unknown>(): T | undefined;
        save(value: unknown): boolean;
        path: string;
    };
    appendSilent(text: string): Promise<boolean>;
    appendWake(text: string): Promise<boolean>;
    canAppendSilent(): boolean;
    user: {
        openid: string;
        name: string;
        isOwner: boolean;
    };
    owners: string[];
    peer: {
        scope: string;
        peerId: string;
    };
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
    restart(opts?: {
        requireOwner?: boolean;
        delayMs?: number;
    }): boolean;
}
/**
 * 造一份扩展能力包。**永远不会抛**：拿不到的依赖 → 对应能力返回 false / 空值。
 *
 * @param deps - 见 {@link ExtCapsDeps}
 * @returns 能力包（见 {@link ExtCapabilities}）
 */
export declare function makeExtCaps(deps: ExtCapsDeps): ExtCapabilities;
//# sourceMappingURL=ext-capabilities.d.ts.map