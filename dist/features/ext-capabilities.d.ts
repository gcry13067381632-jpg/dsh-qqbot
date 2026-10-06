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
}
/**
 * 造一份扩展能力包。**永远不会抛**：拿不到的依赖 → 对应能力返回 false / 空值。
 *
 * @param deps - 见 {@link ExtCapsDeps}
 * @returns 能力包（见 {@link ExtCapabilities}）
 */
export declare function makeExtCaps(deps: ExtCapsDeps): ExtCapabilities;
//# sourceMappingURL=ext-capabilities.d.ts.map