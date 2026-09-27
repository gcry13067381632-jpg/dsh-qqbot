import type { StickerGatesConfig } from '../config.js';
import type { Logger } from '../types.js';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { MediaKind } from '../transport/rich-media.js';
/** 闸门拒绝信号: sender.sendMedia 抛此错; send_media 工具 catch 转 ok:false, [MEDIA] 通道记日志 */
export declare class StickerGateDenied extends Error {
    constructor(reason: string);
}
export declare function isStickerGateDenied(err: unknown): err is StickerGateDenied;
/** 单条媒体发送的判定上下文 */
export interface MediaGateCtx {
    /** group openid; 私聊(null/undefined)不闸 */
    groupId?: string;
    kind: MediaKind;
    /** 本地绝对路径(已 resolve); URL 发送不算 sticker, 不闸 */
    localPath?: string;
}
export interface MediaGateVerdict {
    allowed: boolean;
    /** 该发送是否属于"库内表情包图"(即便 allowed, 也用于调用方决定是否记录流水) */
    isSticker: boolean;
    /** 拒绝原因(中文, 给工具回执/日志) */
    reason?: string;
}
/** 是否库内表情包路径: roots = [dataDir/lib] + gates.libRoots(追加前缀) */
export declare function isStickerPath(p: string | undefined, dataDir: string, libRoots?: string[]): boolean;
export declare function bindStickerGates(getter: () => StickerGatesConfig): void;
/**
 * 闸门状态(跨重启持久: used 去重 / budget 日预算)。
 * 窗口频率 ring / 活性 ring 为内存态(窗口短, 重启重计可接受, 与定稿一致)。
 */
declare class StickerGate {
    readonly dataDir: string;
    private readonly logger?;
    /** 每群活性 RingBuffer: groupId -> 群消息时间戳(ms) */
    private readonly activity;
    /** 每群我方发送窗口 ring: groupId -> 放行表情包时间戳(ms) */
    private readonly sentTimes;
    /** 同图去重: 本地路径 -> 最近发送 ts(惰性按 dupTTL 清理) */
    private used;
    /** 日预算: groupId -> {YYYY-MM-DD: 张数} */
    private budget;
    private saveTimer;
    private dirty;
    constructor(dataDir: string, logger?: Logger | undefined);
    private usedPath;
    private budgetPath;
    private sendlogPath;
    private load;
    /** 防抖落盘(发送低频, 1s 合并足够); 进程退出兜底走 flush() */
    private save;
    /** 立即落盘(退出兜底) */
    flush(): void;
    recordActivity(groupId: string, ts?: number): void;
    /** 近 windowSec 秒内的群消息条数 */
    countActivity(groupId: string, windowSec: number): number;
    private countSentInWindow;
    /**
     * 单张媒体发送判定(配置现读)。规则顺序:
     *   非库内 image(URL/非库路径/非图)→放行; 总开关关→放行; 私聊→放行;
     *   禁发群 → 活性下限 → 窗口频率 → 日预算 → 同图去重。
     * 放行后发送成功再调 noteSent 记录(发送失败不占预算)。
     */
    checkMedia(ctx: MediaGateCtx): MediaGateVerdict;
    /** 放行且发送成功后才调: 记发送窗口/日预算/同图去重 + 追加发送流水 */
    noteSent(groupId: string | undefined, localPath: string | undefined): void;
    /** 把媒体段原文 source 归一到本地绝对路径; URL 返回 undefined */
    resolveLocalPath(rawSource: string, cwd: string | undefined): string | undefined;
    /** 某媒体段是否属于库内表情包图(perTurn 计数用; 不发只判) */
    isStickerMediaSegment(kind: MediaKind, rawSource: string, cwd: string | undefined): boolean;
}
/** 启动早期按 config.cwd 解析的 dataDir 预初始化(防目录分裂, 与 configureStickerStore 同款纪律)。ns=实例标识。 */
export declare function initStickerGate(dataDir: string, logger?: Logger, ns?: string): StickerGate;
/** primary 是否已初始化(未初始化时不应无参调用以免误建目录) */
export declare function hasStickerGate(): boolean;
/** 获取闸门实例。带 dataDir → 按目录取; 带 ns → 按该实例 primary; 无参 → 全局 primary。 */
export declare function getStickerGate(dataDir?: string, logger?: Logger, ns?: string): StickerGate;
/** 出站侧把待落盘状态写盘(进程退出兜底; 全部实例都 flush) */
export declare function flushStickerGate(): void;
/**
 * sendRichOutbound 用: 组一个 perTurn(每轮张数)判定上下文。
 * 未初始化闸门(如单测/无 bot 场景) → perTurnMax=0 不限制, isSticker 恒 false, 不误建目录。
 */
export declare function stickerPerTurnCtx(cwd?: string): {
    perTurnMax: number;
    isSticker(kind: MediaKind, rawSource: string): boolean;
};
export declare function stickerActivityRecorder(dataDir?: string): (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;
export {};
//# sourceMappingURL=sticker-gate.d.ts.map