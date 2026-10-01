import { inferMediaKind } from '../transport/media-kind.js';
import { replaceBotMention } from '../shared/mention-clean.js';
import { buildQuoteBlock } from '../transport/inbound.js';
import { slimQuoteBlockOneLine } from '../transport/quote-text.js';
import { resolveMentionNames } from '../features/chat-ledger.js';
/** 文本 + 带 URL 附件折叠为一行段。
 *  ⚠️ 2026-09-10 主人纠正两点:
 *  ① **语音 URL 不能跳过** —— dock 的仿 QQ 聊天界面靠它调 /chat/voice-play 把 SILK 转 mp3 播放;
 *  ② **语音的 ASR 转录要一并记入** —— 否则历史(冷却派发/批量打包)里只剩一条音频链接,
 *     AI 看不到"这条语音说了什么"(2026-09-10 主人实测发现)。
 *  格式约定(与 dock chatSplitMedia 对齐):
 *    转录独立成一行纯文本 → dock 当普通文本显示(不套 📎 附件样式);
 *    `[语音: <url>]` 单独一行 → dock 的 chatAttachmentKind 认 `[语音` 判 voice 并建播放器。 */
export function foldMedia(msg, quote, stickerDir = '', gid) {
    const parts = [];
    // ⚠️ 2026-10-01 修（主人实测: **聚合进历史**的那条消息里没有引用块 —— 当前消息有、历史里没有）:
    //   本中间件是链上第 4 步, 而 SDK 的 quoteRef 原来挂第 11 步 ⇒ 记历史时 ctx.state.quote 还没赋值。
    //   修法两半: ① quoteRef 前移到本中间件之前(见 middleware-setup.ts); ② 这里把引用块拼进历史 content。
    //   压成一行 —— 历史行是"一条一行"的形状(和 [图片: path] 的处理一致), 多行会看不出是谁说的。
    // 压成一行 + 限长 140 字（“📷 被引用的图片: <路径>” 这类附件行**豁免截断** —— 那是唯一线索）
    const qb = quote ? slimQuoteBlockOneLine(buildQuoteBlock(quote, stickerDir), 140) : '';
    if (qb)
        parts.push(qb);
    // 2026-09-11 主人要求: 历史里的 @bot 长 id 也清洗成 @bot(省 token)
    // 2026-10-01 主人实测：@**别人**的 `<@openid>` 在上下文里是 32 位 id（谁也看不出 @ 的是谁）→
    //   查群成员台账换成 `@昵称`（台账目录就是表情包目录 = stickerDir）；查不到退化成 @短id。
    const text = resolveMentionNames(replaceBotMention((msg.content ?? '').trim(), msg.mentions, msg.wasMentioned), stickerDir, gid);
    // 排版: 多行正文退 2 格(单行不缩进)
    if (text)
        parts.push(text.includes('\n') ? text.split('\n').map((l) => '  ' + l).join('\n') : text);
    for (const att of msg.attachments ?? []) {
        if (!att.url)
            continue;
        // ⚠️ 2026-09-10: 类型一律走 inferMediaKind 推断 —— QQ 群聊图片/视频的 content_type
        //    实测是 'file', 按 content_type 判断会把历史里的视频/图片折成 `[文件: url]`
        //    (dock 显示成 📎 附件, 且 AI 也分不清类型)。
        const kind = inferMediaKind(att);
        if (kind === 'voice') {
            const asr = String(att.asr_refer_text ?? '').trim();
            if (asr)
                parts.push(asr); // 转录(纯文本行)
            parts.push(`[语音: ${att.url}]`); // 音频链接(带标签, dock 判 voice)
            continue;
        }
        const label = kind === 'image' ? '图片'
            : kind === 'video' ? '视频'
                : kind === 'file' ? '文件' : '附件';
        parts.push(`[${label}: ${att.url}]`);
    }
    return parts.join('\n');
}
/** 内容里是否含 `<@{appId}>` / `<@!{appId}>`（与 SDK mention-gate 同款兜底扫描） */
function detectMentionInContent(content, appId) {
    if (!content || !appId)
        return false;
    const safe = appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return content.includes(`<@${safe}>`) || content.includes(`<@!${safe}>`);
}
/**
 * 这条消息是否 @ 了 bot。
 *
 * ⚠️ 2026-09-15 修（主人实测「历史消息里 @ 了她也不回话」）：
 *   原来读 `ctx.state.mention.wasMentioned` —— 但本中间件挂在 **mentionGate 之前**
 *   （链上第 4 步 vs 第 5 步），而 `ctx.state.mention` 恰恰是由 SDK 的 mentionGate 赋值的
 *   ⇒ 这里永远读到 undefined，历史条目上的 `mentioned` 标记从来没写对过
 *   ⇒ 聚合派发时"窗口历史里 @ 了她"识别不出来 ⇒ 点名豁免失效 ⇒ 低分被拦。
 *   判据与 SDK mention-gate.js 完全一致（三选一）：
 *     ① rawEventType === 'GROUP_AT_MESSAGE_CREATE'（平台权威信号）
 *     ② mentions[].is_you === true
 *     ③ content 含 <@{appId}> / <@!{appId}>
 */
function detectWasMentioned(msg, appId) {
    if (msg.rawEventType === 'GROUP_AT_MESSAGE_CREATE')
        return true;
    if (Array.isArray(msg.mentions) && msg.mentions.some((m) => m?.is_you === true))
        return true;
    return detectMentionInContent(msg.content, appId);
}
/**
 * 构建增强版群历史缓冲中间件（API 对齐 SDK historyBuffer）：
 *   1. 把当前群消息(媒体 URL 折叠进 content)记入 store（去重按 messageId）；
 *   2. 向下游暴露 ctx.state.history = 已缓冲历史（不含当前消息，旧→新）。
 */
export function mediaHistoryBuffer(options) {
    const { limit, store, recordOnSkip, groupKey, skipWhen, appId, stickerDir = '' } = options;
    return async (ctx, next) => {
        const key = groupKey(ctx);
        if (!key) {
            await next();
            return;
        }
        const buffered = await store.list(key, limit);
        ctx.state.history = buffered;
        // 命中 skipWhen(如已知斜杠命令) → 不进 AI 历史, 直接放行下游由命令层处理
        if (skipWhen && skipWhen(ctx)) {
            await next();
            return;
        }
        const raw = ctx.message;
        // 2026-09-15 修: 自己判(见 detectWasMentioned 注释), 不再读这个阶段读不到的 ctx.state.mention
        const wasMentioned = detectWasMentioned(raw, appId);
        raw.wasMentioned = wasMentioned;
        // 2026-09-12: 顺带记一个"这条 @ 过 bot"的标志 —— 打包进上下文时**只有这种行才带 openid**
        // (主人要求: 其余历史行一律只给昵称, 每行省 20+ token)。SDK 的 HistoryEntry 无此字段, 用交叉类型塞进去。
        const entry = {
            senderId: ctx.message.senderId,
            senderName: ctx.message.senderName,
            content: foldMedia(raw, ctx.state.quote, stickerDir, ctx.message.kind === 'group' ? ctx.message.groupOpenid : undefined),
            timestamp: Date.parse(ctx.message.timestamp) || Date.now(),
            messageId: ctx.message.messageId,
            ...(wasMentioned ? { mentioned: true } : {}),
        };
        try {
            await store.append(key, entry, limit);
        }
        catch (err) {
            ctx.log.error?.(`[media-history] append failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (ctx.stopped && !recordOnSkip) {
            return;
        }
        await next();
    };
}
//# sourceMappingURL=media-history.js.map