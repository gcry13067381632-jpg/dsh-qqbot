import { join } from 'node:path';
import { readGroupMembers } from './chat-ledger.js';
const BTN_PREFIX = 'q:';
/** 抢答按钮前缀（claim）：点击后把回答权转移给点击者，全员可点 */
const CLAIM_PREFIX = 'qc:';
/** 选项字母表(文字兜底按它映射) */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** QQ 卡片按钮上限: 最多 5 行, 每行 1 个选项 → 最多 5 个可点按钮 */
const CARD_MAX_OPTIONS = 5;
/** 单个问题的选项上限(超出交回宿主, 不接管) */
const MAX_OPTIONS = 26;
/** 单次提问最多接管几个问题(超出交回宿主) */
const MAX_QUESTIONS = 5;
/** 选项按钮 keyboard(每行1个=竖排, 字宽不截断; QQ 最多5行 → 最多5个按钮)
 *  label 带字母前缀(A. xxx) —— 与文字兜底/卡片正文的字母表对齐。
 *  permission: 群聊限定"发起对话者本人"可点(specify_user_ids=ownerId), 防群里其他人替你选 */
function optionsKeyboard(item, token, ownerId) {
    const shown = item.opts.slice(0, CARD_MAX_OPTIONS);
    const permission = ownerId
        ? { type: 0, specify_user_ids: [ownerId] }
        : { type: 2 };
    const rows = shown.map((opt, idx) => {
        const label = `${LETTERS[idx] ?? String(idx + 1)}. ${String(opt.label ?? '')}`.slice(0, 24);
        return {
            buttons: [{
                    id: `${BTN_PREFIX}${item.qid}:${token}:${idx}`,
                    render_data: { label, visited_label: label, style: 1 },
                    action: {
                        type: 1,
                        permission,
                        data: `${BTN_PREFIX}${item.qid}:${token}:${idx}`,
                        unsupport_tips: '按钮不可用时, 发 /答 A (或 /答 你的回答)',
                    },
                }],
        };
    });
    // ── 抢答按钮（2026-09-30 主人定）──────────────────────────────
    //   放在最上面：**全员可点**（permission type 2）。谁先点谁把回答权抢走
    //   （回调里改写 item.ownerId 并重发卡片），之后其他人再点只收到「已被 XXX 抢到」。
    //   用途：机器人问错人 / 被问的人不在 / 想"谁先看到谁答"。
    if (item.claimable && !item.claimed) {
        const claimLabel = '🙋 我来回答';
        rows.unshift({
            buttons: [{
                    id: `${CLAIM_PREFIX}${item.qid}:${token}`,
                    render_data: { label: claimLabel, visited_label: claimLabel, style: 1 },
                    action: {
                        type: 1,
                        permission: { type: 2 },
                        data: `${CLAIM_PREFIX}${item.qid}:${token}`,
                        unsupport_tips: '按钮不可用时, 直接发 /答 A (或 /答 你的回答)',
                    },
                }],
        });
    }
    return { content: { rows } };
}
/** 选项字母表(卡片正文用): `A. xxx` 一行一个, 列全 */
function optionsLines(opts, from = 0) {
    return opts.map((o, i) => `${LETTERS[i] ?? String(i + 1)}. ${String(o?.label ?? '')}`).slice(from);
}
/** 卡片/文字提示的正文 */
function promptOf(item, timeoutMs, forCard) {
    const header = item.header ? `**${item.header}**\n\n` : '';
    const detail = item.detail ? `\n\n${item.detail}` : '';
    const seq = item.total > 1 ? `（第 ${item.index}/${item.total} 问）` : '';
    const ask = `${header}❓ **${item.question}**${seq}${detail}`;
    const list = optionsLines(item.opts).map((l) => `  ${l}`).join('\n');
    const point = forCard && item.opts.length <= CARD_MAX_OPTIONS
        ? `⏱ ${Math.ceil(timeoutMs / 1000)} 秒内点下方按钮回答：`
        : `⏱ ${Math.ceil(timeoutMs / 1000)} 秒内回答：`;
    const tips = [
        `按钮点不动或想自己打字时, 用斜杠回答: \`/答 ${LETTERS[0] ?? 'A'}\`` + (item.multiSelect ? '（多选 `/答 A,C`）' : ''),
        item.total > 1 ? `多个提问并存用 \`/答 #${item.index} 你的选择\`` : '',
        item.opts.length > CARD_MAX_OPTIONS ? `选项超过 ${CARD_MAX_OPTIONS} 个, 第 ${CARD_MAX_OPTIONS + 1} 个起请用 \`/答 字母\` 选择` : '',
        '想自由回答: `/答 你的话`（原样转给 AI）',
    ].filter(Boolean).join('；');
    return `${ask}\n\n${list}\n\n${point}\n（${tips}）`;
}
/** 取出文本里所有 `<@内容>` 标注(内容可能是 openid, 也可能是昵称) */
function atTokens(text) {
    const out = [];
    for (const m of String(text || '').matchAll(/<@([^<>\n]{1,64})>/g)) {
        const v = String(m[1] ?? '').trim();
        if (v)
            out.push(v);
    }
    return out;
}
/** 32 位字母数字 = openid(QQ 的 member_openid/user_openid 形状) */
function looksLikeOpenid(s) {
    return /^[0-9A-Za-z]{32}$/.test(s);
}
/**
 * 解析"这张提问卡片该谁回答"(按钮 permission.type=0 + specify_user_ids 显式指定人):
 *  ① 本次提问的 question/header 文本里的 `<@openid>` **或 `<@昵称>`** —— 显式指定(优先级最高)
 *  ①b 文本里没写任何 `<@...>` 标注、但**唯一**命中某位群成员的昵称 → 也算点名
 *  ② 最近真人 user/message 文本里的 `<@openid>`/`<@昵称>`: 取最后一个(提问目标句末; 前面常是 @bot 自己)
 *  ③ 消息发送者壳 [昵称 (openid)]
 *  ④ 兜底: 会话发起者 record.senderId
 * 注: 群投票/谁都能点可走 permission.type:2(owner 为空时 optionsKeyboard 已处理)。
 * 2026-09-24 增强(主人需求): 支持**昵称匹配** —— 不必手打 32 位 openid, 写 `<@某群友昵称>` 即可。
 */
function resolveCardOwner(record, inlineText, resolver) {
    /** 标注内容 → openid: 是 openid 直接用; 是昵称则走台账匹配 */
    const fromToken = (tok) => {
        if (looksLikeOpenid(tok))
            return tok;
        return resolver?.byName(tok) ?? null;
    };
    // ① 提问文本里的点名 = 显式指定(id 或昵称写在 header/question 都算)
    if (inlineText) {
        const toks = atTokens(inlineText);
        for (let i = toks.length - 1; i >= 0; i--) {
            const hit = fromToken(toks[i]);
            if (hit)
                return hit;
        }
        // ①b 没写 <@...> 标注时: 文本里唯一出现的成员昵称也算点名
        if (toks.length === 0) {
            const hit = resolver?.byText(inlineText) ?? null;
            if (hit)
                return hit;
        }
    }
    try {
        const evs = record.agent?.session?.events;
        if (Array.isArray(evs) && evs.length > 0) {
            const from = Math.max(0, evs.length - 60);
            for (let i = evs.length - 1; i >= from; i--) {
                const ev = evs[i];
                if (!ev || ev.type !== 'user/message')
                    continue;
                const data = ev.data && typeof ev.data === 'object' ? ev.data : ev;
                const src = data.source;
                if (src && src.kind === 'plugin')
                    continue;
                const content = Array.isArray(data.content) ? data.content : [];
                const text = content.map((b) => (b?.text ?? '')).join('\n');
                if (!text)
                    continue;
                // ② 最近真人消息点名(取最后一个 @): openid 或昵称都认
                const toks = atTokens(text);
                for (let k = toks.length - 1; k >= 0; k--) {
                    const hit = fromToken(toks[k]);
                    if (hit)
                        return hit;
                }
                // ③ 消息发送者壳
                const shell = text.match(/\[\[^\]\n]*?\s*\(([A-Za-z0-9]{32})\)\]/);
                if (shell)
                    return shell[1];
                return record.senderId;
            }
        }
    }
    catch { /* 解析失败回落 */ }
    return record.senderId;
}
/**
 * 把一条**文字回复**解析成对某问题的答案(2026-09-11 主人定的文字兜底):
 *   - 先去口语前缀(`选`/`选择`/`选：` 等);
 *   - 用 `,`/`，`/空格/`、`/`;` 切 token;
 *   - token 命中规则: ①单个字母 A-Z → 第 N 个选项 ②纯数字 1-26 → 第 N 个选项
 *     ③与该问题某个选项 label 完全相同(去空白/忽略大小写) → 那个选项;
 *   - 所有 token 都命中 → option(非多选时只取第一个);
 *   - 否则(含"自定义:xxx"这类) → custom, 原文透传给 AI。
 * @returns null = 这条不该当成答案(空文本)
 */
export function parseQuestionAnswer(raw, item) {
    const text = String(raw ?? '').trim();
    if (text === '')
        return null;
    const body = text.replace(/^(选|选择|选择：|选：|答|答案[:：]?)\s*/u, '').trim();
    const tokens = body.split(/[,，、;；\s]+/u).filter((t) => t !== '');
    if (tokens.length === 0)
        return null;
    const idxOf = (tok) => {
        const up = tok.toUpperCase();
        // ① 单个字母: A=0, B=1 ...
        if (/^[A-Z]$/u.test(up)) {
            const i = LETTERS.indexOf(up);
            return i >= 0 && i < item.opts.length ? i : null;
        }
        // ② 纯数字: 1=0, 2=1 ...
        if (/^\d{1,2}$/u.test(tok)) {
            const n = Number(tok);
            return n >= 1 && n <= item.opts.length ? n - 1 : null;
        }
        // ③ 与选项文字完全相同
        const norm = (s) => s.replace(/\s+/gu, '').toLowerCase();
        const i = item.opts.findIndex((o) => norm(String(o?.label ?? '')) === norm(tok));
        return i >= 0 ? i : null;
    };
    const indices = [];
    for (const tok of tokens) {
        const i = idxOf(tok);
        if (i === null)
            return { kind: 'custom', text }; // 有任何一个 token 不命中 → 整条当自由文本
        if (!indices.includes(i))
            indices.push(i);
    }
    if (indices.length === 0)
        return { kind: 'custom', text };
    const picked = item.multiSelect ? indices : [indices[0]];
    return { kind: 'option', indices: picked, labels: picked.map((i) => String(item.opts[i]?.label ?? '')) };
}
export class QqUserQuestionsController {
    manager;
    sender;
    logger;
    timeoutMsProvider;
    pending = new Map();
    constructor(manager, sender, logger, timeoutMsProvider) {
        this.manager = manager;
        this.sender = sender;
        this.logger = logger;
        this.timeoutMsProvider = timeoutMsProvider;
    }
    /**
     * 群成员昵称 → openid 解析器(2026-09-24 主人需求: 提问卡片支持"昵称匹配"指定收件人)。
     * 数据源 = 本地群成员台账 `{dataRoot}/表情包/group-members.jsonl`(在群里发过言/申请过入群的人);
     * 群聊之外、或台账里查不到 → 返回 undefined, 调用方按老逻辑回落(会话发起者)。
     * ⚠️ 从没发过言的人查不到(官方群成员列表接口未开放) —— 那种情况请照旧写 <@32位openid>。
     */
    ownerResolverFor(record) {
        try {
            const scope = record?.replyTarget?.scope;
            const gid = scope === 'group' ? String(record?.replyTarget?.targetId ?? '') : '';
            if (!gid)
                return undefined;
            const members = readGroupMembers(join(this.manager.dataRoot, '表情包'), gid);
            if (!Array.isArray(members) || members.length === 0)
                return undefined;
            const byName = (name) => {
                const key = String(name ?? '').trim().replace(/^[＠@]+/u, '').trim();
                if (!key)
                    return null;
                // 精确同名: 台账按最近发言倒序 → 第一个就是最近说话的那位
                const exact = members.filter((m) => m.name === key);
                const f = exact[0];
                if (f && f.mid)
                    return f.mid;
                // 包含匹配: 必须唯一命中, 否则宁可不指定(避免绑错人)
                const part = members.filter((m) => typeof m.name === 'string' && m.name.length > 0 && m.name.includes(key));
                const p = part[0];
                if (part.length === 1 && p && p.mid)
                    return p.mid;
                return null;
            };
            const byText = (text) => {
                const hits = new Set();
                for (const m of members) {
                    const nm = String(m.name ?? '').trim();
                    if (nm.length < 2 || !m.mid)
                        continue;
                    if (String(text ?? '').includes(nm))
                        hits.add(m.mid);
                }
                const arr = [...hits];
                return arr.length === 1 ? arr[0] : null;
            };
            return { byName, byText };
        }
        catch {
            return undefined;
        }
    }
    /**
     * 宿主 user-questions/request 处理器。只 claim"会话可定位 + 每个问题都带选项"的场景;
     * 其余(无会话/无选项/选项过多/问题过多) → next() 交回宿主(Web UI 或原样)。
     * 多问题时依次发卡, 回答用 `#2 B` 指定; 全部答完或超时后一起回给宿主。
     */
    async request(req, next) {
        const record = this.manager.findByAgent(req.agent);
        if (!record)
            return next();
        const questions = Array.isArray(req.questions) ? req.questions : [];
        if (questions.length === 0 || questions.length > MAX_QUESTIONS)
            return next();
        const parsed = questions.map((q) => {
            const raw = q;
            return {
                qid: String(raw?.id ?? ''),
                question: String(raw?.question ?? ''),
                header: String(raw?.header ?? ''),
                detail: String(raw?.detail ?? ''),
                multiSelect: raw?.multiSelect === true,
                opts: (Array.isArray(raw?.options) ? raw.options : []).map((o) => ({ label: String(o?.label ?? '') })),
            };
        });
        // 只有"每个问题都有选项且不超过上限"才接管 —— 否则答案形状与宿主期望不符, 交回 Web UI 更稳
        if (parsed.some((q) => q.qid === '' || q.opts.length === 0 || q.opts.length > MAX_OPTIONS))
            return next();
        const timeoutMs = Math.max(5000, this.timeoutMsProvider() || 120000);
        const token = Math.random().toString(36).slice(2, 8);
        const peerKey = `${record.replyTarget.scope}:${record.replyTarget.targetId}`;
        // 卡片可点人: 从最近真人消息解析——被点名的最后一人(@)优先, 其次消息发送者壳, 回落会话发起者
        // (修复: 主人让 bot 问群友时, 卡片应绑被问者而不是 bot/主人, 否则被问者点卡片=无权限)
        const owner = resolveCardOwner(record, parsed.map((q) => `${q.header} ${q.question}`).join(' '), this.ownerResolverFor(record));
        this.logger.info(`QQ question owner resolved: ${owner ? owner.slice(0, 8) + '…' : '(全员可点)'}`);
        // 先注册 pending(防按钮回调/文字回复先于 Promise 建立到达)
        let resolver = () => undefined;
        const answer = new Promise((resolve) => { resolver = resolve; });
        const group = {
            qids: parsed.map((q) => q.qid),
            answers: new Map(),
            resolve: resolver,
            timer: setTimeout(() => this.finishGroup(group), timeoutMs),
            keys: [],
            signal: req.signal,
        };
        if (req.signal) {
            group.onAbort = () => this.finishGroup(group);
            try {
                req.signal.addEventListener('abort', group.onAbort, { once: true });
            }
            catch { /* ignore */ }
        }
        const items = parsed.map((q, i) => {
            const key = `${q.qid}:${token}`;
            const item = {
                qid: q.qid, question: q.question, header: q.header, detail: q.detail,
                opts: q.opts, ownerId: owner, multiSelect: q.multiSelect,
                peerKey, group, index: i + 1, total: parsed.length,
                // ── 抢答按钮（2026-09-30 主人定）──────────────────────────
                //   卡片上多一个「🙋 我来回答」：**全员可点、只能抢一次**，
                //   抢到即把回答权转移给他（ownerId 改写 + 补发绑他的卡片）。
                //   默认开启：解决"机器人问错人 / 被问的人不在 / 谁先看到谁答"。
                //   ⚠️ 单问题时才加（多问题时抢答语义混乱：一张卡 5 个按钮上限，
                //      抢答按钮要占一行，问题多了会挤掉选项）。
                claimable: parsed.length === 1,
                deadlineAt: Date.now() + timeoutMs,
            };
            group.keys.push(key);
            this.pending.set(key, item);
            return item;
        });
        // 依次发卡(多问题 = 多张卡, 各自带序号与字母表)
        for (const item of items) {
            try {
                await this.sender.sendMarkdownWithKeyboard(record.replyTarget, promptOf(item, timeoutMs, true), optionsKeyboard(item, token, owner));
                this.logger.info(`QQ question sent: qid=${item.qid} opts=${item.opts.length} (${item.index}/${item.total})`);
            }
            catch (err) {
                this.logger.warn(`QQ question card failed: ${err instanceof Error ? err.message : String(err)}`);
                // 卡片不可用 → 发纯文字选项清单; **保留 pending**(文字兜底能收答案, 不再像以前那样直接放弃)
                try {
                    await this.sender.sendMarkdown(record.replyTarget, promptOf(item, timeoutMs, false));
                }
                catch (err2) {
                    // 连文字都发不出去(限频/网络) ≠ 提问结束: 保留 pending 供 Web 浮层兜底
                    this.logger.error(`QQ question fallback text failed: ${err2 instanceof Error ? err2.message : String(err2)} (qid=${item.qid}, web 浮层可兜底)`);
                }
            }
        }
        return answer;
    }
    /**
     * 入站文字兜底(2026-09-11 主人需求): 待答提问期间, 发起者发来的文字也算回答 ——
     *   命中选项(字母/序号/选项原文, 支持多选) → 选中结算;
     *   其它文字 → 作为自由回答(custom)透传给 AI。
     * 非本会话/非发起者/斜杠命令 → 不消费(交回正常入站链)。
     * @returns true = 消息已被提问逻辑消费(调用方不要再派发给 agent)
     */
    async handleInbound(msg, replyTarget) {
        const scope = msg.kind === 'group' ? 'group' : 'c2c';
        const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId ?? '') : (msg.senderId ?? '');
        const peerKey = `${scope}:${peerId}`;
        const text = String(msg.content ?? '').trim();
        if (text === '' || text.startsWith('/'))
            return false;
        const items = [...this.pending.values()].filter((p) => p.peerKey === peerKey);
        if (items.length === 0)
            return false;
        // 只认"卡片指定的那个人"的回答(与按钮回调同一判据); 别人说话照常进 agent
        const sender = String(msg.senderId ?? '');
        const owner = items[0].ownerId;
        if (owner && sender && sender !== owner)
            return false;
        // 目标是哪一问: `#2 xxx` 指定第 2 问; 否则取序号最小的未答问题
        let target;
        let body = text;
        const seq = /^#\s*(\d{1,2})\s*([\s\S]*)$/u.exec(text);
        if (seq) {
            const want = Number(seq[1]);
            body = String(seq[2] ?? '').trim();
            target = items.find((p) => p.index === want);
            if (!target)
                return false;
            if (body === '')
                return false;
        }
        else {
            target = items.slice().sort((a, b) => a.index - b.index)[0];
        }
        if (!target)
            return false;
        const parsedAnswer = parseQuestionAnswer(body, target);
        if (!parsedAnswer)
            return false;
        if (parsedAnswer.kind === 'option') {
            await this.receipt(replyTarget, `已选择：${parsedAnswer.labels.join(' / ')}`);
            this.settleAnswer(target, { selected: parsedAnswer.labels });
        }
        else {
            await this.receipt(replyTarget, `已回复：${parsedAnswer.text}`);
            this.settleAnswer(target, { selected: [], custom: parsedAnswer.text });
        }
        return true;
    }
    /**
     * 斜杠命令兜底入口(`/答` / `/ans`, 2026-09-11 主人定): 与 handleInbound 同一套解析与结算,
     * 但**不依赖消息在链上的位置** —— 命令层在 @门控之后、延迟聚合之上就执行完并 ctx.stop。
     * 为什么必须有它: 裸文字作答在群里被 mentionGate 拦下, 私聊/群消息又被 debounce 聚合层
     * 直接吞进 agent(那一层自己调 transport.handleInbound, 绕过 message 处理器), 实测无效;
     * 而以 `/` 开头的消息被 debounce 直放行(见 gateway/debounce.ts), 命令层随即处理。
     * @returns ok=false 时 msg 是给用户看的提示(命令层原样回执)
     */
    answerByText(args) {
        const peerKey = `${args.scope}:${args.peerId}`;
        const raw = String(args.text ?? '').trim();
        if (raw === '')
            return { ok: false, msg: '没看到回答内容' };
        const items = [...this.pending.values()].filter((p) => p.peerKey === peerKey);
        if (items.length === 0)
            return { ok: false, msg: '当前没有待回答的提问(可能已超时或被撤回)。' };
        // 只认卡片指定的那个人(与按钮回调、文字兜底同一判据)
        const sender = String(args.senderId ?? '');
        const owner = items[0].ownerId;
        if (owner && sender && sender !== owner)
            return { ok: false, msg: '这个问题不是问你的哦~' };
        // `#2 xxx` 指定第 2 问; 否则取序号最小的未答项
        let target;
        let body = raw;
        const seq = /^#\s*(\d{1,2})\s*([\s\S]*)$/u.exec(raw);
        if (seq) {
            const want = Number(seq[1]);
            body = String(seq[2] ?? '').trim();
            target = items.find((p) => p.index === want);
            if (!target)
                return { ok: false, msg: `没有第 ${want} 个待答提问(当前共 ${items.length} 个)。` };
            if (body === '')
                return { ok: false, msg: '请在 #N 后面写上你的选择' };
        }
        else {
            target = items.slice().sort((a, b) => a.index - b.index)[0];
        }
        if (!target)
            return { ok: false, msg: '当前没有待回答的提问。' };
        const parsedAnswer = parseQuestionAnswer(body, target);
        if (!parsedAnswer)
            return { ok: false, msg: '没看到回答内容' };
        const head = target.total > 1 ? `第 ${target.index}/${target.total} 问：` : '';
        if (parsedAnswer.kind === 'option') {
            this.settleAnswer(target, { selected: parsedAnswer.labels });
            return { ok: true, msg: `${head}已选择：${parsedAnswer.labels.join(' / ')}` };
        }
        this.settleAnswer(target, { selected: [], custom: parsedAnswer.text });
        return { ok: true, msg: `${head}已回复：${parsedAnswer.text}` };
    }
    /** interaction 回调: data = q:<qid>:<token>:<idx> → 按选项 label 组 answer; 仅发起者本人可答 */
    async handleInteraction(event, replyTarget) {
        const e = event;
        if (e?.data?.type !== 11)
            return false;
        const data = e.data.resolved?.button_data;
        if (!data || (!data.startsWith(BTN_PREFIX) && !data.startsWith(CLAIM_PREFIX)))
            return false;
        /** 点击者 openid（群聊看 group_member_openid，私聊看 user_openid） */
        const presser = e.group_member_openid ?? e.user_openid ?? '';
        // ── 抢答分支（2026-09-30 主人定）：全员可点、先到先得，点击即转移回答权 ──
        //   带 `claimable` 的问题会多一个「🙋 我来回答」按钮（permission type=2 全员可点）。
        //   第一个人点 → 改写 item.ownerId 为他（此后选项回调与文字兜底都按新 owner 判），
        //   第二个人再点 → 只收到「已被 XXX 抢到」，不会误答。
        if (data.startsWith(CLAIM_PREFIX)) {
            const cm = /^qc:([^:]+):([^:]+)$/.exec(data);
            if (!cm)
                return false;
            const item = this.pending.get(`${cm[1]}:${cm[2]}`);
            if (!item) {
                try {
                    this.sender.sendMarkdown(replyTarget, '这个问题已经结束啦~').catch(() => undefined);
                }
                catch { /* ignore */ }
                return true;
            }
            if (!presser)
                return true;
            // 已被别人抢走 → 明确拒绝
            if (item.claimed && item.ownerId && item.ownerId !== presser) {
                try {
                    this.sender.sendMarkdown(replyTarget, `手慢了～已经被 <@${item.ownerId}> 抢到啦`).catch(() => undefined);
                }
                catch { /* ignore */ }
                return true;
            }
            // 自己已经是 owner（重复点）→ 友好提示
            if (item.ownerId === presser) {
                try {
                    this.sender.sendMarkdown(replyTarget, '你已经抢到啦，直接点下面的选项，或发 /答 A').catch(() => undefined);
                }
                catch { /* ignore */ }
                return true;
            }
            // ★ 权限转移：改写 ownerId + 标记已抢；原 owner 与其他人此后都会被拒
            item.ownerId = presser;
            item.claimed = true;
            item.claimedBy = presser;
            this.logger.info(`QQ question claimed: qid=${item.qid} by=${presser.slice(0, 8)}…`);
            try {
                await this.sender.sendMarkdown(replyTarget, `✅ <@${presser}> 抢到了回答权，请点下面的选项，或直接发 /答 A（也可自由回答）`);
            }
            catch { /* ignore */ }
            // 选项按钮的 permission 是"发送时烘焙"的、已发的卡片改不了 →
            // 必须补发一张绑新 owner 的卡片，抢到的人才能点选项。
            try {
                const left = Math.max(5000, item.deadlineAt - Date.now());
                await this.sender.sendMarkdownWithKeyboard(replyTarget, promptOf(item, left, true), optionsKeyboard(item, cm[2], item.ownerId));
            }
            catch { /* 补发失败不影响 /答 文字通道 */ }
            return true;
        }
        const m = /^q:([^:]+):([^:]+):(\d+)$/.exec(data);
        if (!m)
            return false;
        const qid = m[1];
        const token = m[2];
        const idx = Number(m[3]);
        const key = `${qid}:${token}`;
        const item = this.pending.get(key);
        if (!item)
            return false;
        // 防别人代答: 必须等于【当前 owner】—— owner 可能已被"抢答"改写，
        // 所以这里必须重新读 item.ownerId，不能用发送卡片时的快照。
        if (item.ownerId && presser && presser !== item.ownerId) {
            try {
                this.sender.sendMarkdown(replyTarget, '这个问题不是问你的哦~').catch(() => undefined);
            }
            catch { /* ignore */ }
            return true;
        }
        const label = item.opts[idx]?.label ?? '';
        if (!label)
            return false;
        try {
            this.sender.sendMarkdown(replyTarget, `已选择：${label}`).catch(() => undefined);
        }
        catch { /* ignore */ }
        this.settleAnswer(item, { selected: [label] });
        return true;
    }
    /** 回执(QQ 直发, 失败不影响结算) */
    async receipt(replyTarget, text) {
        try {
            await this.sender.sendMarkdown(replyTarget, text);
        }
        catch { /* ignore */ }
    }
    /** 结算单个问题: 写进组, 该批全部答完 → 一次交回宿主 */
    settleAnswer(item, ans) {
        for (const [k, v] of this.pending) {
            if (v === item) {
                this.pending.delete(k);
                break;
            }
        }
        const group = item.group;
        group.answers.set(item.qid, ans);
        if (group.answers.size >= group.qids.length)
            this.finishGroup(group);
    }
    /**
     * 该批提问收尾: 清定时器/监听 + 清理未答项的 pending + 按 qid 顺序组装宿主 answer。
     * 超时/取消时未答的问题给空答案(selected: []) —— 与宿主原语义一致。
     */
    finishGroup(group) {
        clearTimeout(group.timer);
        if (group.signal && group.onAbort) {
            try {
                group.signal.removeEventListener('abort', group.onAbort);
            }
            catch { /* ignore */ }
        }
        for (const [k, v] of [...this.pending]) {
            if (v.group === group)
                this.pending.delete(k);
        }
        const answers = group.qids.map((qid) => {
            const a = group.answers.get(qid);
            if (!a)
                return { id: qid, selected: [] };
            return a.custom === undefined
                ? { id: qid, selected: a.selected }
                : { id: qid, selected: a.selected, custom: a.custom };
        });
        group.resolve({ answers });
    }
    /** Web 浮层拉取待办问题列表 */
    listPendingForWeb() {
        const out = [];
        for (const [key, p] of this.pending) {
            out.push({
                key,
                question: p.question,
                header: p.header,
                detail: p.detail,
                options: p.opts,
                deadlineAt: p.deadlineAt,
            });
        }
        return out.sort((a, b) => a.deadlineAt - b.deadlineAt);
    }
    /** Web 浮层点选项: key + 选项下标 → 与 QQ 按钮同源结算(先到先得) */
    decideByWeb(key, optIdx) {
        const item = this.pending.get(key);
        if (!item)
            return { ok: false, msg: '该问题不存在或已过期' };
        const label = item.opts[optIdx]?.label;
        if (!label)
            return { ok: false, msg: '无效选项' };
        this.settleAnswer(item, { selected: [label] });
        return { ok: true, msg: `已选择：${label}` };
    }
    dispose() {
        for (const group of new Set([...this.pending.values()].map((p) => p.group))) {
            this.finishGroup(group);
        }
    }
}
// ── 按实例(ns)注册的提问控制器注册表 —— Web 提问浮层(settings-host 同源路由)经此读写 ──
const questionControllers = new Map();
export function registerQuestionController(ns, c) {
    if (c)
        questionControllers.set(ns, c);
    else
        questionControllers.delete(ns);
}
/** 汇总所有实例的待办提问 */
export function listAllPendingQuestionsWeb() {
    const out = [];
    for (const [ns, c] of questionControllers) {
        for (const p of c.listPendingForWeb())
            out.push({ ns, ...p });
    }
    return out.sort((a, b) => a.deadlineAt - b.deadlineAt);
}
/** 跨实例结算提问 */
export function decideQuestionByWebAny(key, optIdx) {
    for (const [ns, c] of questionControllers) {
        const r = c.decideByWeb(key, optIdx);
        if (r.ok)
            return { ok: true, ns, msg: r.msg };
    }
    return { ok: false, msg: '该问题不存在或已过期' };
}
/**
 * 斜杠命令(`/答` / `/ans`)的结算入口: 按实例 ns 找到提问控制器 → 把文字当答案结算(2026-09-11 主人定)。
 * 命令层在 @门控之后、延迟聚合之上执行, 是**唯一可靠**的用户文字作答通道
 * (裸文字在群里被 mentionGate 拦、私聊被 debounce 聚合层直接吞进 agent, 实测无效)。
 */
export function answerPendingQuestionByText(args) {
    const ns = String(args.ns ?? '').trim();
    const c = ns !== ''
        ? questionControllers.get(ns)
        : (questionControllers.size === 1 ? [...questionControllers.values()][0] : undefined);
    if (!c)
        return { ok: false, msg: `提问控制器未注册(ns=${ns || '(未指定)'})` };
    return c.answerByText({ scope: args.scope, peerId: args.peerId, senderId: args.senderId, text: args.text });
}
//# sourceMappingURL=qq-user-questions.js.map