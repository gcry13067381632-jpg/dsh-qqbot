/**
 * qq-user-questions.ts — QQ 远程提问: 把 AI 的 ask_user_question 变成 QQ 按钮卡片
 *
 * 机制(与 QQ 远程审批同款): 宿主 ctx 上 `user-questions/request` 是 Agent 作用域的
 * waterfall 事件(dsh-user-questions/lib: UserQuestionService.ask → waterfall 派发)。
 * Web UI 答案器在宿主引导期注册(dsh-client-ui-user-questions), 会在浏览器连着且
 * agent 有 GUI 会话时先 claim —— 所以本监听必须 { prepend: true } 抢在它前面。
 *
 * 形状(@deepseek-ai/dsh-user-questions/types):
 *   request = { questions: [{ id, question, detail?, header?, options?:[{label,...}], multiSelect? }], agent?, signal? }
 *   answer   = { answers: [{ id, selected: string[], custom? }] }
 *
 * 2026-09-11 增强(主人需求, 本轮新增):
 *   ① 按钮 label 带字母前缀(A. / B. / …), 卡片正文列出**全部**选项字母表;
 *   ② **文字选项兜底**: 待答期间直接回文字也算回答 ——
 *        回 `A` / `2`            → 选第 1 / 第 2 个选项(字母与序号都认);
 *        回 `A,C` / `1 3` / `选 1 3` → 多选;
 *        回选项原文(与某个 label 完全一致) → 选它;
 *        回**其它任意文字**       → 作为自由回答(custom)透传给 AI(answers[].custom);
 *   ③ 多问题(questions > 1): 依次发卡, 回答时可用 `#2 B` 指定第 2 问;
 *   ④ 选项超过按钮上限(QQ 卡片最多 5 行 → 5 个可点按钮)时, 卡片正文照样列全, 靠文字兜底补齐;
 *   ⑤ 按钮卡片发送失败时不再放弃提问 —— 退化成纯文字选项清单, pending 保留(文字兜底能收答案)。
 */
import type { ReplyTarget } from '@tencent-connect/qqbot-nodejs';
import type { QQBotSender } from '../transport/outbound-buffer.js';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';

const BTN_PREFIX = 'q:';
/** 选项字母表(文字兜底按它映射) */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** QQ 卡片按钮上限: 最多 5 行, 每行 1 个选项 → 最多 5 个可点按钮 */
const CARD_MAX_OPTIONS = 5;
/** 单个问题的选项上限(超出交回宿主, 不接管) */
const MAX_OPTIONS = 26;
/** 单次提问最多接管几个问题(超出交回宿主) */
const MAX_QUESTIONS = 5;

interface PendingItem {
  qid: string;
  question: string;
  header: string;
  detail: string;
  opts: Array<{ label: string }>;
  /** 发起者 openid(群=member_openid, c2c=user_openid); 回调/文字兜底都校验, 防止别人代答 */
  ownerId: string;
  /** 是否多选(宿主给的 multiSelect) */
  multiSelect: boolean;
  /** 会话键 `scope:peerId`: 文字兜底据此判断"这条消息是不是在回答本问题" */
  peerKey: string;
  /** 同批问题共享的组(多问题时按组收集全部答案后统一 resolve) */
  group: PendingGroup;
  /** 本问题在该批中的序号(1 起; 文字兜底用 `#2 B` 指定) */
  index: number;
  /** 该批问题总数 */
  total: number;
  deadlineAt: number;
}

/** 一批提问(一次 ask_user_question 的全部问题) —— 全部答完/超时后统一 resolve 宿主 */
interface PendingGroup {
  /** 该批问题的 qid 顺序(resolve 时按此顺序出答案) */
  qids: string[];
  /** qid → 已收答案 */
  answers: Map<string, { selected: string[]; custom?: string }>;
  resolve: (ans: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  /** 该批占用的 pending key(收尾清理用) */
  keys: string[];
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** Web 浮层看到的待办提问(去敏) */
export interface WebPendingQuestion {
  /** 唯一键 = qid:token(web 结算回传用) */
  key: string;
  question: string;
  header: string;
  detail: string;
  options: Array<{ label: string }>;
  deadlineAt: number;
}

/** 选项按钮 keyboard(每行1个=竖排, 字宽不截断; QQ 最多5行 → 最多5个按钮)
 *  label 带字母前缀(A. xxx) —— 与文字兜底/卡片正文的字母表对齐。
 *  permission: 群聊限定"发起对话者本人"可点(specify_user_ids=ownerId), 防群里其他人替你选 */
function optionsKeyboard(item: PendingItem, token: string, ownerId?: string): { content: { rows: unknown[] } } {
  const shown = item.opts.slice(0, CARD_MAX_OPTIONS);
  const permission: Record<string, unknown> = ownerId
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
  return { content: { rows } };
}

/** 选项字母表(卡片正文用): `A. xxx` 一行一个, 列全 */
function optionsLines(opts: Array<{ label: string }>, from = 0): string[] {
  return opts.map((o, i) => `${LETTERS[i] ?? String(i + 1)}. ${String(o?.label ?? '')}`).slice(from);
}

/** 卡片/文字提示的正文 */
function promptOf(item: PendingItem, timeoutMs: number, forCard: boolean): string {
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

/**
 * 解析"这张提问卡片该谁回答"(按钮 permission.type=0 + specify_user_ids 显式指定人):
 *  ① 本次提问的 question/header 文本里的 <@openid> —— 工具输入直接写明 id 指定(优先级最高)
 *  ② 最近真人 user/message 文本里的 <@openid>: 取最后一个(提问目标句末; 前面常是 @bot 自己)
 *  ③ 消息发送者壳 [昵称 (openid)]
 *  ④ 兜底: 会话发起者 record.senderId
 * 注: 群投票/谁都能点可走 permission.type:2(owner 为空时 optionsKeyboard 已处理)。
 */
function resolveCardOwner(record: { senderId: string; agent?: { session?: { events?: readonly unknown[] } } }, inlineText?: string): string {
  const firstAt = (text: string): string | null => {
    const ats: string[] = [];
    for (const m of String(text || '').matchAll(/<@([A-Za-z0-9]{32})>/g)) ats.push(m[1]!);
    return ats.length > 0 ? ats[ats.length - 1]! : null;
  };
  // ① 提问文本里的点名 = 显式指定(id 写在 header/question 都算)
  if (inlineText) {
    const hit = firstAt(inlineText);
    if (hit) return hit;
  }
  try {
    const evs = record.agent?.session?.events;
    if (Array.isArray(evs) && evs.length > 0) {
      const from = Math.max(0, evs.length - 60);
      for (let i = evs.length - 1; i >= from; i--) {
        const ev = evs[i] as { type?: string; data?: Record<string, unknown> } | undefined;
        if (!ev || ev.type !== 'user/message') continue;
        const data = ev.data && typeof ev.data === 'object' ? ev.data : (ev as unknown as Record<string, unknown>);
        const src = data.source as { kind?: string } | undefined;
        if (src && src.kind === 'plugin') continue;
        const content = Array.isArray(data.content) ? (data.content as Array<{ text?: string }>) : [];
        const text = content.map((b) => (b?.text ?? '')).join('\n');
        if (!text) continue;
        // ② 最近真人消息点名(取最后一个 @)
        const hit = firstAt(text);
        if (hit) return hit;
        // ③ 消息发送者壳
        const shell = text.match(/\[\[^\]\n]*?\s*\(([A-Za-z0-9]{32})\)\]/);
        if (shell) return shell[1]!;
        return record.senderId;
      }
    }
  } catch { /* 解析失败回落 */ }
  return record.senderId;
}

/** 文字兜底的解析结果: 命中选项(可能多选) 或 自由文本 */
export type ParsedQuestionAnswer =
  | { kind: 'option'; indices: number[]; labels: string[] }
  | { kind: 'custom'; text: string };

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
export function parseQuestionAnswer(raw: string, item: Pick<PendingItem, 'opts' | 'multiSelect'>): ParsedQuestionAnswer | null {
  const text = String(raw ?? '').trim();
  if (text === '') return null;

  const body = text.replace(/^(选|选择|选择：|选：|答|答案[:：]?)\s*/u, '').trim();
  const tokens = body.split(/[,，、;；\s]+/u).filter((t) => t !== '');
  if (tokens.length === 0) return null;

  const idxOf = (tok: string): number | null => {
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
    const norm = (s: string): string => s.replace(/\s+/gu, '').toLowerCase();
    const i = item.opts.findIndex((o) => norm(String(o?.label ?? '')) === norm(tok));
    return i >= 0 ? i : null;
  };

  const indices: number[] = [];
  for (const tok of tokens) {
    const i = idxOf(tok);
    if (i === null) return { kind: 'custom', text }; // 有任何一个 token 不命中 → 整条当自由文本
    if (!indices.includes(i)) indices.push(i);
  }
  if (indices.length === 0) return { kind: 'custom', text };
  const picked = item.multiSelect ? indices : [indices[0]!];
  return { kind: 'option', indices: picked, labels: picked.map((i) => String(item.opts[i]?.label ?? '')) };
}

export class QqUserQuestionsController {
  private readonly pending = new Map<string, PendingItem>();

  constructor(
    private readonly manager: SessionManager,
    private readonly sender: QQBotSender,
    private readonly logger: Logger,
    private readonly timeoutMsProvider: () => number,
  ) {}

  /**
   * 宿主 user-questions/request 处理器。只 claim"会话可定位 + 每个问题都带选项"的场景;
   * 其余(无会话/无选项/选项过多/问题过多) → next() 交回宿主(Web UI 或原样)。
   * 多问题时依次发卡, 回答用 `#2 B` 指定; 全部答完或超时后一起回给宿主。
   */
  async request(
    req: { questions?: Array<Record<string, unknown>>; agent?: unknown; signal?: AbortSignal },
    next: () => Promise<unknown>,
  ): Promise<unknown> {
    const record = this.manager.findByAgent(req.agent as never);
    if (!record) return next();
    const questions = Array.isArray(req.questions) ? req.questions : [];
    if (questions.length === 0 || questions.length > MAX_QUESTIONS) return next();

    const parsed = questions.map((q) => {
      const raw = q as {
        id?: string; question?: string; detail?: string; header?: string;
        options?: Array<{ label: string; description?: string }>; multiSelect?: boolean;
      };
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
    if (parsed.some((q) => q.qid === '' || q.opts.length === 0 || q.opts.length > MAX_OPTIONS)) return next();

    const timeoutMs = Math.max(5000, this.timeoutMsProvider() || 120000);
    const token = Math.random().toString(36).slice(2, 8);
    const peerKey = `${record.replyTarget.scope}:${record.replyTarget.targetId}`;
    // 卡片可点人: 从最近真人消息解析——被点名的最后一人(@)优先, 其次消息发送者壳, 回落会话发起者
    // (修复: 主人让 bot 问群友时, 卡片应绑被问者而不是 bot/主人, 否则被问者点卡片=无权限)
    const owner = resolveCardOwner(record, parsed.map((q) => `${q.header} ${q.question}`).join(' '));

    // 先注册 pending(防按钮回调/文字回复先于 Promise 建立到达)
    let resolver: (v: unknown) => void = () => undefined;
    const answer = new Promise<unknown>((resolve) => { resolver = resolve; });
    const group: PendingGroup = {
      qids: parsed.map((q) => q.qid),
      answers: new Map(),
      resolve: resolver,
      timer: setTimeout(() => this.finishGroup(group), timeoutMs),
      keys: [],
      signal: req.signal,
    };
    if (req.signal) {
      group.onAbort = () => this.finishGroup(group);
      try { req.signal.addEventListener('abort', group.onAbort, { once: true }); } catch { /* ignore */ }
    }

    const items: PendingItem[] = parsed.map((q, i) => {
      const key = `${q.qid}:${token}`;
      const item: PendingItem = {
        qid: q.qid, question: q.question, header: q.header, detail: q.detail,
        opts: q.opts, ownerId: owner, multiSelect: q.multiSelect,
        peerKey, group, index: i + 1, total: parsed.length,
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
      } catch (err) {
        this.logger.warn(`QQ question card failed: ${err instanceof Error ? err.message : String(err)}`);
        // 卡片不可用 → 发纯文字选项清单; **保留 pending**(文字兜底能收答案, 不再像以前那样直接放弃)
        try {
          await this.sender.sendMarkdown(record.replyTarget, promptOf(item, timeoutMs, false));
        } catch (err2) {
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
  async handleInbound(
    msg: { kind?: string; senderId?: string; content?: string; groupOpenid?: string },
    replyTarget: ReplyTarget,
  ): Promise<boolean> {
    const scope: 'c2c' | 'group' = msg.kind === 'group' ? 'group' : 'c2c';
    const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId ?? '') : (msg.senderId ?? '');
    const peerKey = `${scope}:${peerId}`;
    const text = String(msg.content ?? '').trim();
    if (text === '' || text.startsWith('/')) return false;

    const items = [...this.pending.values()].filter((p) => p.peerKey === peerKey);
    if (items.length === 0) return false;

    // 只认"卡片指定的那个人"的回答(与按钮回调同一判据); 别人说话照常进 agent
    const sender = String(msg.senderId ?? '');
    const owner = items[0]!.ownerId;
    if (owner && sender && sender !== owner) return false;

    // 目标是哪一问: `#2 xxx` 指定第 2 问; 否则取序号最小的未答问题
    let target: PendingItem | undefined;
    let body = text;
    const seq = /^#\s*(\d{1,2})\s*([\s\S]*)$/u.exec(text);
    if (seq) {
      const want = Number(seq[1]);
      body = String(seq[2] ?? '').trim();
      target = items.find((p) => p.index === want);
      if (!target) return false;
      if (body === '') return false;
    } else {
      target = items.slice().sort((a, b) => a.index - b.index)[0];
    }
    if (!target) return false;

    const parsedAnswer = parseQuestionAnswer(body, target);
    if (!parsedAnswer) return false;

    if (parsedAnswer.kind === 'option') {
      await this.receipt(replyTarget, `已选择：${parsedAnswer.labels.join(' / ')}`);
      this.settleAnswer(target, { selected: parsedAnswer.labels });
    } else {
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
  answerByText(args: { scope: 'c2c' | 'group'; peerId: string; senderId?: string; text: string }): { ok: boolean; msg: string } {
    const peerKey = `${args.scope}:${args.peerId}`;
    const raw = String(args.text ?? '').trim();
    if (raw === '') return { ok: false, msg: '没看到回答内容' };

    const items = [...this.pending.values()].filter((p) => p.peerKey === peerKey);
    if (items.length === 0) return { ok: false, msg: '当前没有待回答的提问(可能已超时或被撤回)。' };

    // 只认卡片指定的那个人(与按钮回调、文字兜底同一判据)
    const sender = String(args.senderId ?? '');
    const owner = items[0]!.ownerId;
    if (owner && sender && sender !== owner) return { ok: false, msg: '这个问题不是问你的哦~' };

    // `#2 xxx` 指定第 2 问; 否则取序号最小的未答项
    let target: PendingItem | undefined;
    let body = raw;
    const seq = /^#\s*(\d{1,2})\s*([\s\S]*)$/u.exec(raw);
    if (seq) {
      const want = Number(seq[1]);
      body = String(seq[2] ?? '').trim();
      target = items.find((p) => p.index === want);
      if (!target) return { ok: false, msg: `没有第 ${want} 个待答提问(当前共 ${items.length} 个)。` };
      if (body === '') return { ok: false, msg: '请在 #N 后面写上你的选择' };
    } else {
      target = items.slice().sort((a, b) => a.index - b.index)[0];
    }
    if (!target) return { ok: false, msg: '当前没有待回答的提问。' };

    const parsedAnswer = parseQuestionAnswer(body, target);
    if (!parsedAnswer) return { ok: false, msg: '没看到回答内容' };
    const head = target.total > 1 ? `第 ${target.index}/${target.total} 问：` : '';
    if (parsedAnswer.kind === 'option') {
      this.settleAnswer(target, { selected: parsedAnswer.labels });
      return { ok: true, msg: `${head}已选择：${parsedAnswer.labels.join(' / ')}` };
    }
    this.settleAnswer(target, { selected: [], custom: parsedAnswer.text });
    return { ok: true, msg: `${head}已回复：${parsedAnswer.text}` };
  }

  /** interaction 回调: data = q:<qid>:<token>:<idx> → 按选项 label 组 answer; 仅发起者本人可答 */
  async handleInteraction(event: unknown, replyTarget: ReplyTarget): Promise<boolean> {
    const e = event as {
      data?: { type?: number; resolved?: { button_data?: string } };
      group_member_openid?: string;
      user_openid?: string;
    };
    if (e?.data?.type !== 11) return false;
    const data = e.data.resolved?.button_data;
    if (!data || !data.startsWith(BTN_PREFIX)) return false;

    const m = /^q:([^:]+):([^:]+):(\d+)$/.exec(data);
    if (!m) return false;
    const qid = m[1]!;
    const token = m[2]!;
    const idx = Number(m[3]);
    const key = `${qid}:${token}`;
    const item = this.pending.get(key);
    if (!item) return false;

    // 防别人代答: 群聊看 group_member_openid, c2c 看 user_openid, 必须等于发起者
    const presser = e.group_member_openid ?? e.user_openid ?? '';
    if (item.ownerId && presser && presser !== item.ownerId) {
      try { this.sender.sendMarkdown(replyTarget, '这个问题不是问你的哦~').catch(() => undefined); } catch { /* ignore */ }
      return true;
    }

    const label = item.opts[idx]?.label ?? '';
    if (!label) return false;
    try { this.sender.sendMarkdown(replyTarget, `已选择：${label}`).catch(() => undefined); } catch { /* ignore */ }
    this.settleAnswer(item, { selected: [label] });
    return true;
  }

  /** 回执(QQ 直发, 失败不影响结算) */
  private async receipt(replyTarget: ReplyTarget, text: string): Promise<void> {
    try { await this.sender.sendMarkdown(replyTarget, text); } catch { /* ignore */ }
  }

  /** 结算单个问题: 写进组, 该批全部答完 → 一次交回宿主 */
  private settleAnswer(item: PendingItem, ans: { selected: string[]; custom?: string }): void {
    for (const [k, v] of this.pending) {
      if (v === item) {
        this.pending.delete(k);
        break;
      }
    }
    const group = item.group;
    group.answers.set(item.qid, ans);
    if (group.answers.size >= group.qids.length) this.finishGroup(group);
  }

  /**
   * 该批提问收尾: 清定时器/监听 + 清理未答项的 pending + 按 qid 顺序组装宿主 answer。
   * 超时/取消时未答的问题给空答案(selected: []) —— 与宿主原语义一致。
   */
  private finishGroup(group: PendingGroup): void {
    clearTimeout(group.timer);
    if (group.signal && group.onAbort) {
      try { group.signal.removeEventListener('abort', group.onAbort); } catch { /* ignore */ }
    }
    for (const [k, v] of [...this.pending]) {
      if (v.group === group) this.pending.delete(k);
    }
    const answers = group.qids.map((qid) => {
      const a = group.answers.get(qid);
      if (!a) return { id: qid, selected: [] };
      return a.custom === undefined
        ? { id: qid, selected: a.selected }
        : { id: qid, selected: a.selected, custom: a.custom };
    });
    group.resolve({ answers });
  }

  /** Web 浮层拉取待办问题列表 */
  listPendingForWeb(): WebPendingQuestion[] {
    const out: WebPendingQuestion[] = [];
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
  decideByWeb(key: string, optIdx: number): { ok: boolean; msg: string } {
    const item = this.pending.get(key);
    if (!item) return { ok: false, msg: '该问题不存在或已过期' };
    const label = item.opts[optIdx]?.label;
    if (!label) return { ok: false, msg: '无效选项' };
    this.settleAnswer(item, { selected: [label] });
    return { ok: true, msg: `已选择：${label}` };
  }

  dispose(): void {
    for (const group of new Set([...this.pending.values()].map((p) => p.group))) {
      this.finishGroup(group);
    }
  }
}

// ── 按实例(ns)注册的提问控制器注册表 —— Web 提问浮层(settings-host 同源路由)经此读写 ──
const questionControllers = new Map<string, QqUserQuestionsController>();

export function registerQuestionController(ns: string, c: QqUserQuestionsController | undefined): void {
  if (c) questionControllers.set(ns, c);
  else questionControllers.delete(ns);
}

/** 汇总所有实例的待办提问 */
export function listAllPendingQuestionsWeb(): Array<WebPendingQuestion & { ns: string }> {
  const out: Array<WebPendingQuestion & { ns: string }> = [];
  for (const [ns, c] of questionControllers) {
    for (const p of c.listPendingForWeb()) out.push({ ns, ...p });
  }
  return out.sort((a, b) => a.deadlineAt - b.deadlineAt);
}

/** 跨实例结算提问 */
export function decideQuestionByWebAny(key: string, optIdx: number): { ok: boolean; ns?: string; msg: string } {
  for (const [ns, c] of questionControllers) {
    const r = c.decideByWeb(key, optIdx);
    if (r.ok) return { ok: true, ns, msg: r.msg };
  }
  return { ok: false, msg: '该问题不存在或已过期' };
}

/**
 * 斜杠命令(`/答` / `/ans`)的结算入口: 按实例 ns 找到提问控制器 → 把文字当答案结算(2026-09-11 主人定)。
 * 命令层在 @门控之后、延迟聚合之上执行, 是**唯一可靠**的用户文字作答通道
 * (裸文字在群里被 mentionGate 拦、私聊被 debounce 聚合层直接吞进 agent, 实测无效)。
 */
export function answerPendingQuestionByText(args: {
  ns?: string;
  scope: 'c2c' | 'group';
  peerId: string;
  senderId?: string;
  text: string;
}): { ok: boolean; msg: string } {
  const ns = String(args.ns ?? '').trim();
  const c = ns !== ''
    ? questionControllers.get(ns)
    : (questionControllers.size === 1 ? [...questionControllers.values()][0] : undefined);
  if (!c) return { ok: false, msg: `提问控制器未注册(ns=${ns || '(未指定)'})` };
  return c.answerByText({ scope: args.scope, peerId: args.peerId, senderId: args.senderId, text: args.text });
}
