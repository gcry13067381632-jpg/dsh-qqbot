/**
 * OutboundBuffer — 出站文本缓冲
 *
 * 收集流式 chunk，流式优先投递（StreamingWriter），降级为静态发送。
 * 独立文件便于单测。
 */
import type { SessionRecord } from '../session/index.js';
import type { Logger, ReplyTarget } from '../types.js';
/** QQ 流式会话（openStream 返回） */
export interface StreamSessionLike {
    update(content: string): Promise<unknown>;
    complete(): Promise<unknown>;
}
/** QQ Bot 发送接口 */
export interface QQBotSender {
    sendMarkdown(target: ReplyTarget, content: string): Promise<unknown>;
    /** 发送带内联按钮(keyboard)的 markdown 消息 —— 审批卡片/提问卡片用 */
    sendMarkdownWithKeyboard(target: ReplyTarget, content: string, keyboard: unknown): Promise<unknown>;
    openStream(target: ReplyTarget): StreamSessionLike;
    /** 发送富媒体(图片/语音/视频/文件)；url/localPath 二选一；返回新消息 id(若可得) */
    sendMedia(target: ReplyTarget, kind: 'image' | 'video' | 'voice' | 'file', source: {
        url?: string;
        localPath?: string;
    }): Promise<{
        id?: string;
    }>;
    /** 撤本 bot 最近发给该 peer 的消息；成功返回 true */
    recallLast(target: ReplyTarget): Promise<boolean>;
    /** 撤本 bot 发给该 peer 的最近第 index 条(index=1 最近一条, 2 倒数第二条...)；成功返回 true */
    recallByIndex(target: ReplyTarget, index: number): Promise<boolean>;
    /** c2c 主动召回消息(官方 is_wakeup:true, 30天窗; 群聊目标应走 sendMarkdown)。2026-09-10 修跨会话 c2c 发送 */
    sendC2cWakeup(target: ReplyTarget, content: string): Promise<unknown>;
}
/**
 * 富媒体感知发送一段完整文本：
 *  1) 若整段为 [RECALL] 指令(去掉指令后无实质内容) → 触发 bot.recallLast
 *  2) 否则解析 [MEDIA:kind|src]，媒体段逐个 bot.sendMedia，文本段照常分块 sendMarkdown
 *  富媒体指令与 [RECALL] 从展示文本中剔除；任一失败不抛(逐项记录由调用方/logger)。
 *
 * resolveTarget(可选): 每次实际发送(每条媒体/每个文本分块)前调用一次, 返回该条的目标。
 * 用于「适配主动」出站: 同一条入站消息的连续回复数到限后自动切主动(去掉 msg_id)。
 * 注意: [RECALL] 撤回动作不消耗计数, 固定用传入 target。
 */
export declare function sendRichOutbound(bot: QQBotSender, target: ReplyTarget, text: string, limit: number, cwd: string | undefined, logError?: (msg: string) => void, resolveTarget?: () => ReplyTarget, 
/** 逐文本块目标(2026-09-10 主人定 passive 收尾): 传 (块序号i, 总块数total)=>ReplyTarget,
 *  用于「正文块>5 时第 6 块起转主动发送」; undefined=所有块用 resolveTarget/固定 target */
chunkTarget?: (i: number, total: number) => ReplyTarget, 
/** 每成功发出一个正文块后回调(2026-09-10 主人定 passive 收尾 A 方案): outbound.ts 用它统计
 *  「**同一个 msg_id 下**已发出几个正文块」, 回合结束时决定是否把最后一块复制一份主动补发。
 *  带上 target 是因为 QQ 的被动回复 5 条上限**按 msg_id 计** —— msg_id 一变(群友中途发言)
 *  配额即重置, 计数必须跟着归零, 否则会误补发(2026-09-10 主人指出)。 */
onBlockSent?: (text: string, target: ReplyTarget) => void, 
/** 引用短号查表(2026-09-13 主人定): 传短号(如 0913a) → 完整 msg_id; 台账见 transport/msg-index.ts */
refLookup?: (index: string) => string | undefined): Promise<void>;
export declare class OutboundBuffer {
    private readonly record;
    private readonly bot;
    private readonly limit;
    private readonly logger;
    private readonly cwd;
    private readonly resolveTarget?;
    /** 逐文本块目标(2026-09-10 passive 收尾; 正文块>5 第6块起转主动) */
    private readonly chunkTarget?;
    /** 每成功发出一个正文块后回调(见 sendRichOutbound 同名参数) */
    private readonly onBlockSent?;
    /** 引用短号查表(见 sendRichOutbound 同名参数; 2026-09-13 主人定) */
    private readonly refLookup?;
    private buffer;
    private flushing;
    private readonly writer;
    constructor(record: SessionRecord, bot: QQBotSender, limit: number, logger: Logger, streamingEnabled: boolean, cwd?: string | undefined, resolveTarget?: (() => ReplyTarget) | undefined, 
    /** 逐文本块目标(2026-09-10 passive 收尾; 正文块>5 第6块起转主动) */
    chunkTarget?: ((i: number, total: number) => ReplyTarget) | undefined, 
    /** 每成功发出一个正文块后回调(见 sendRichOutbound 同名参数) */
    onBlockSent?: ((text: string, target: ReplyTarget) => void) | undefined, 
    /** 引用短号查表(见 sendRichOutbound 同名参数; 2026-09-13 主人定) */
    refLookup?: ((index: string) => string | undefined) | undefined);
    /** 追加文本增量 */
    append(text: string): void;
    /** 获取当前累积文本 */
    get text(): string;
    /** 发送所有累积文本：流式优先，降级静态 */
    flush(): Promise<void>;
    /** 取消（异常/丢弃），中止流式并清空缓冲 */
    cancel(): void;
}
//# sourceMappingURL=outbound-buffer.d.ts.map