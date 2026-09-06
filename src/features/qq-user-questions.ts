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
 */
import type { ReplyTarget } from '@tencent-connect/qqbot-nodejs';
import type { QQBotSender } from '../transport/outbound-buffer.js';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';

const BTN_PREFIX = 'q:';

interface PendingItem {
  qid: string;
  question: string;
  header: string;
  detail: string;
  opts: Array<{ label: string }>;
  /** 发起者 openid(群=member_openid, c2c=user_openid); 回调校验防止别人代答 */
  ownerId: string;
  deadlineAt: number;
  resolve: (ans: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
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

/** 选项按钮 keyboard(每行1个=竖排, 字宽不截断; QQ 最多5行 → 最多5个选项可见)
 *  permission: 群聊限定"发起对话者本人"可点(specify_user_ids=ownerId), 防群里其他人替你选 */
function optionsKeyboard(qid: string, token: string, opts: Array<{ label: string }>, ownerId?: string): { content: { rows: unknown[] } } {
  const maxRows = 5;
  const shown = opts.slice(0, maxRows);
  const permission: Record<string, unknown> = ownerId
    ? { type: 0, specify_user_ids: [ownerId] }
    : { type: 2 };
  const rows = shown.map((opt, idx) => ({
    buttons: [{
      id: `${BTN_PREFIX}${qid}:${token}:${idx}`,
      render_data: {
        label: String(opt.label ?? '').slice(0, 24),
        visited_label: String(opt.label ?? '').slice(0, 24),
        style: 1,
      },
      action: {
        type: 1,
        permission,
        data: `${BTN_PREFIX}${qid}:${token}:${idx}`,
        unsupport_tips: '请直接回复选项文字',
      },
    }],
  }));
  return { content: { rows } };
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
   * 宿主 user-questions/request 处理器。只 claim"会话可定位 + 第一个问题带选项"的场景;
   * 其余(无会话/无选项/多问题) → next() 交回宿主(Web UI 或原样)。
   */
  async request(
    req: { questions?: Array<Record<string, unknown>>; agent?: unknown; signal?: AbortSignal },
    next: () => Promise<unknown>,
  ): Promise<unknown> {
    const record = this.manager.findByAgent(req.agent as never);
    if (!record) return next();
    const questions = Array.isArray(req.questions) ? req.questions : [];
    if (questions.length === 0) return next();

    const q = questions[0] as {
      id?: string; question?: string; detail?: string; header?: string;
      options?: Array<{ label: string; description?: string }>;
    };
    const qid = String(q?.id ?? '');
    const opts = Array.isArray(q?.options) ? q.options : [];
    if (!qid || opts.length === 0 || opts.length > 25) return next();

    const timeoutMs = Math.max(5000, this.timeoutMsProvider() || 120000);
    const token = Math.random().toString(36).slice(2, 8);
    const key = `${qid}:${token}`;
    const headerRaw = String(q?.header ?? '');
    const detailRaw = String(q?.detail ?? '');
    const questionRaw = String(q?.question ?? '');

    // 先注册 pending(防按钮回调先于 Promise 建立到达)
    let resolver: (v: unknown) => void = () => undefined;
    const answer = new Promise<unknown>((resolve) => { resolver = resolve; });
    const item: PendingItem = {
      qid, question: questionRaw, header: headerRaw, detail: detailRaw,
      opts: opts.map((o) => ({ label: String(o?.label ?? '') })),
      ownerId: record.senderId,
      deadlineAt: Date.now() + timeoutMs,
      resolve: resolver, timer: setTimeout(() => this.settle(key, true), timeoutMs),
      signal: req.signal,
    };
    if (req.signal) {
      item.onAbort = () => this.settle(key, true);
      try { req.signal.addEventListener('abort', item.onAbort, { once: true }); } catch { /* ignore */ }
    }
    this.pending.set(key, item);

    const header = headerRaw ? `**${headerRaw}**\n\n` : '';
    const detail = detailRaw ? `\n\n${detailRaw}` : '';
    const prompt = `${header}❓ **${questionRaw}**${detail}\n\n⏱ ${Math.ceil(timeoutMs / 1000)} 秒内点下方按钮回答：`;

    try {
      await this.sender.sendMarkdownWithKeyboard(record.replyTarget, prompt, optionsKeyboard(qid, token, opts, record.senderId));
      this.logger.info(`QQ question sent: qid=${qid} opts=${opts.length}`);
    } catch (err) {
      this.logger.warn(`QQ question card failed: ${err instanceof Error ? err.message : String(err)}`);
      // 卡片不可用 → 文本列选项, 不 claim(回复走正常入站, agent 自己取答案)
      const lines = [`❓ ${questionRaw}`, '', ...opts.map((o, i) => `${i + 1}. ${o?.label ?? ''}`), '', '（直接回复序号或内容）'];
      try {
        await this.sender.sendMarkdown(record.replyTarget, lines.join('\n'));
      } catch (err2) {
        // QQ 文本降级也失败(限频/网络)≠ 提问结束: 保留 pending 供 Web 浮层兜底,
        // 不要 settle —— 否则 QQ 没送达时 web 也看不到。
        this.logger.error(`QQ question fallback text failed: ${err2 instanceof Error ? err2.message : String(err2)} (qid=${qid}, web 浮层可兜底)`);
        return answer;
      }
      this.settle(key, true);
    }
    return answer;
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
    this.settle(key, false, { answers: [{ id: item.qid, selected: [label] }] });
    return true;
  }

  /** 结算: timedOut/abort → 空答案(selected:[]); answered → 携带选择 */
  private settle(key: string, empty: boolean, value?: unknown): void {
    const item = this.pending.get(key);
    if (!item) return;
    this.pending.delete(key);
    clearTimeout(item.timer);
    if (item.signal && item.onAbort) {
      try { item.signal.removeEventListener('abort', item.onAbort); } catch { /* ignore */ }
    }
    item.resolve(empty ? { answers: [{ id: item.qid, selected: [] }] } : value);
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
    this.settle(key, false, { answers: [{ id: item.qid, selected: [label] }] });
    return { ok: true, msg: `已选择：${label}` };
  }

  dispose(): void {
    for (const key of [...this.pending.keys()]) this.settle(key, true);
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
