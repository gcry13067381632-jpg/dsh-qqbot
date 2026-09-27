import { chunkMarkdownText } from './chunker.js';
import { StreamingWriter } from './streaming-writer.js';
import { containsRecall, collectRecallIndices, extractRefTag, parseOutbound, stripDirectives, resolveSource, } from './rich-media.js';
import { stickerPerTurnCtx } from '../features/sticker-gate.js';
import { rememberBotReply } from '../features/bot-reply-memo.js';
/** 流式输出节流间隔(ms)：连续 chunk 累积后停顿该间隔才推送 */
const STREAM_THROTTLE_MS = 200;
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
export async function sendRichOutbound(bot, target, text, limit, cwd, logError, resolveTarget, 
/** 逐文本块目标(2026-09-10 主人定 passive 收尾): 传 (块序号i, 总块数total)=>ReplyTarget,
 *  用于「正文块>5 时第 6 块起转主动发送」; undefined=所有块用 resolveTarget/固定 target */
chunkTarget, 
/** 每成功发出一个正文块后回调(2026-09-10 主人定 passive 收尾 A 方案): outbound.ts 用它统计
 *  「**同一个 msg_id 下**已发出几个正文块」, 回合结束时决定是否把最后一块复制一份主动补发。
 *  带上 target 是因为 QQ 的被动回复 5 条上限**按 msg_id 计** —— msg_id 一变(群友中途发言)
 *  配额即重置, 计数必须跟着归零, 否则会误补发(2026-09-10 主人指出)。 */
onBlockSent, 
/** 引用短号查表(2026-09-13 主人定): 传短号(如 0913a) → 完整 msg_id; 台账见 transport/msg-index.ts */
refLookup) {
    // 引用消息(2026-09-13 主人定): 正文里的 [rf:短号] → 查本地台账还原完整 msg_id → 以"引用"形式发出
    const ref = extractRefTag(text);
    const refId = (() => {
        const idx = ref?.index;
        if (!idx)
            return '';
        if (refLookup) {
            try {
                const hit = refLookup(idx);
                if (hit)
                    return hit;
            }
            catch { /* 查表失败按无引用处理 */ }
        }
        // 兜底: AI 若直接写了完整 msg_id(ROBOT1.0_…)也接受
        if (/^ROBOT1\.0_/i.test(idx))
            return idx;
        logError?.(`im-qqbot: 引用短号 ${idx} 在台账里查不到, 本条按普通消息发出`);
        return '';
    })();
    // 叠加引用(2026-09-13 修): 保留 msgId(被动回复) + 加 referenceMessageId —— SDK send() 支持
    // body.msg_id 与 body.message_reference 并存。**所有**目标构造路径都要过这里。
    const withRef = (t) => refId ? { scope: t.scope, targetId: t.targetId, msgId: t.msgId, referenceMessageId: refId } : t;
    const eff = () => withRef(resolveTarget ? resolveTarget() : target);
    const hasRecall = containsRecall(text);
    const displayable = stripDirectives(text);
    // 只要含 [RECALL(:N)] 就执行，一条回复里多个 [RECALL] 逐个撤(可一次撤多条)；
    // 纯召回(去掉指令后无正文)且全未撤到 → 记录并停；否则继续发正文(正文已清所有指令，不会外显)
    if (hasRecall) {
        const indices = collectRecallIndices(text);
        let any = false;
        for (const idx of indices) {
            if (await bot.recallByIndex(target, idx))
                any = true;
        }
        if (!any && !displayable.trim()) {
            logError?.('im-qqbot: [RECALL] 无可撤回消息或已超时');
            return;
        }
    }
    else if (!displayable.trim()) {
        return;
    }
    // 用原始 text 解析(保留 [MEDIA])：媒体段单独发送，文本段各自剔除残留 [RECALL]
    const segments = parseOutbound(text);
    // P1 表情包闸门: perTurn(每轮最多 N 张)。每轮=一次 sendRichOutbound(一轮 assistant 回复文本)。
    // 非表情包图(URL/库外文件/音视频)不计；真实闸门(禁群/频率/预算/去重/活性)在 sender.sendMedia 单点。
    const perTurn = stickerPerTurnCtx(cwd);
    let turnStickerSent = 0;
    for (const seg of segments) {
        if (seg.type === 'media') {
            const isStickerSeg = perTurn.isSticker(seg.kind, seg.source);
            if (isStickerSeg && perTurn.perTurnMax > 0 && turnStickerSent >= perTurn.perTurnMax) {
                // 本轮已达每轮上限：吞掉后续表情包图(不打扰正文/不回执, 防 LLM 换图重试刷闸)
                logError?.(`im-qqbot: 表情包闸门: 本轮已达每轮上限 ${perTurn.perTurnMax} 张, 已忽略后续表情包`);
                continue;
            }
            const src = resolveSource(seg.source, cwd);
            const sourceOpt = src.kind === 'url' ? { url: src.url } : { localPath: src.path };
            try {
                await bot.sendMedia(eff(), seg.kind, sourceOpt);
                if (isStickerSeg)
                    turnStickerSent += 1;
            }
            catch (err) {
                if (err instanceof Error && err.name === 'StickerGateDenied') {
                    logError?.(`im-qqbot: 表情包闸门拦截: ${err.message}`);
                }
                else {
                    logError?.(`im-qqbot: 富媒体发送失败(${seg.kind}): ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }
        else {
            const clean = stripDirectives(seg.text);
            if (!clean.trim())
                continue;
            // QQ 对同会话极短时间连发多条会吞/乱序: 文本分块之间加 ~500ms 间隔限速
            const chunks = chunkMarkdownText(clean, limit).map((c) => String(c || '')).filter((c) => c.trim());
            for (let ci = 0; ci < chunks.length; ci++) {
                const chunk = chunks[ci];
                if (!chunk.trim())
                    continue;
                // 逐块目标: passive 收尾(正文块>5 第6块起转主动)由 chunkTarget 决定; 缺省用 eff()
                // ⚠️ 2026-09-13 修: chunkTarget 分支必须同样叠加引用 —— 原实现直接 chunkTarget(...) 绕过 eff(),
                // passive 模式(当前实例)下 [reference:] 标签被 stripDirectives 剔掉却没附引用, 主人两次实测都看不到引用
                const tgt = withRef(chunkTarget ? chunkTarget(ci, chunks.length) : (resolveTarget ? resolveTarget() : target));
                // 记住她刚说的话(2026-09-13): 相关度信号 relReply 要用「当前消息 vs 她上一条发言」判断
                // "是不是有人在接她的话" —— 内存级, 不落盘, 失败也不影响发送
                try {
                    if (tgt.scope === 'group')
                        rememberBotReply(tgt.targetId, chunk);
                }
                catch { /* ignore */ }
                await bot.sendMarkdown(tgt, chunk);
                onBlockSent?.(chunk, tgt);
                if (ci < chunks.length - 1)
                    await new Promise((r) => setTimeout(r, 500));
            }
        }
    }
}
export class OutboundBuffer {
    record;
    bot;
    limit;
    logger;
    cwd;
    resolveTarget;
    chunkTarget;
    onBlockSent;
    refLookup;
    buffer = '';
    flushing = false;
    writer;
    constructor(record, bot, limit, logger, streamingEnabled, cwd = undefined, resolveTarget, 
    /** 逐文本块目标(2026-09-10 passive 收尾; 正文块>5 第6块起转主动) */
    chunkTarget, 
    /** 每成功发出一个正文块后回调(见 sendRichOutbound 同名参数) */
    onBlockSent, 
    /** 引用短号查表(见 sendRichOutbound 同名参数; 2026-09-13 主人定) */
    refLookup) {
        this.record = record;
        this.bot = bot;
        this.limit = limit;
        this.logger = logger;
        this.cwd = cwd;
        this.resolveTarget = resolveTarget;
        this.chunkTarget = chunkTarget;
        this.onBlockSent = onBlockSent;
        this.refLookup = refLookup;
        this.writer = streamingEnabled
            ? new StreamingWriter({ bot, target: record.replyTarget, logger, throttleMs: STREAM_THROTTLE_MS })
            : null;
    }
    /** 追加文本增量 */
    append(text) {
        this.buffer += text;
        this.writer?.append(text);
    }
    /** 获取当前累积文本 */
    get text() {
        return this.buffer;
    }
    /** 发送所有累积文本：流式优先，降级静态 */
    async flush() {
        if (this.flushing || !this.buffer.trim())
            return;
        this.flushing = true;
        try {
            if (this.writer) {
                await this.writer.finish();
                // 流式成功（未降级）→ 直接返回
                if (!this.writer.shouldFallback)
                    return;
            }
            // 降级：静态发送（writer 不存在 or 流式失败）→ 富媒体感知发送
            await sendRichOutbound(this.bot, this.record.replyTarget, this.buffer, this.limit, this.cwd, (m) => this.logger.error(m), this.resolveTarget, this.chunkTarget, this.onBlockSent, this.refLookup);
        }
        catch (err) {
            this.logger.error(`im-qqbot: flush failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.buffer = '';
            this.flushing = false;
        }
    }
    /** 取消（异常/丢弃），中止流式并清空缓冲 */
    cancel() {
        this.writer?.abort();
        this.buffer = '';
    }
}
//# sourceMappingURL=outbound-buffer.js.map