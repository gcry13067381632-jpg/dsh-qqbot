/**
 * qq-approval.ts — QQ 远程审批: 把 dsh 的权限申请变成 QQ 消息, 由任务发起者在 QQ 里放行/拒绝
 *
 * 思路来源(必须注明):
 *   - wang-22-code/dsh-qqbot-bridge 的 src/approval.ts(QqApprovalController 设计)
 *     https://github.com/wang-22-code/dsh-qqbot-bridge(README「QQ 权限审批」)
 *   - 宿主机制为 dsh 标准事件 ctx.on('approval/request', (request, next) => …),
 *     官方 dsh-acp、dsh-web 审批弹窗同款接线(请求带 request.agent / request.callId,
 *     处理器返回 'allowed-once' | 'rejected' | 'cancelled', 或调用 next() 走宿主默认)。
 *
 * 本实现按本项目结构重写(非拷贝):
 *   - 发送走本项目 sender.sendMarkdown(自带 markdown→text→wakeup 降级链与撤回记录);
 *   - 会话定位用本项目 SessionManager.findByAgent(带 agent.id 兜底);
 *   - 入站拦截挂在本项目 gateway 的 bot.on('message') 最先(消费后不再进 agent)。
 *
 * 流程: 宿主 approval/request → 向"发起者所在会话"推 QQ 审批提示(一次性 CODE)
 *       → 入站 /approve|/deny CODE(或 允许/拒绝 CODE)被拦截
 *       → 校验"发起者本人 + 同会话" → 结算 allow-once / rejected。
 * 边界: CODE 一次性; approvalTimeoutMs 超时自动拒绝; agent 取消/宿主退出自动取消;
 *       只授权当前这一次操作; 群聊里其他成员看到 CODE 也无法批准(senderId 校验)。
 */
import type { ReplyTarget } from '@tencent-connect/qqbot-nodejs';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { QQBotSender } from '../transport/outbound-buffer.js';
import type { SessionManager } from '../session/index.js';
import type { SessionRecord } from '../session/types.js';
import type { Logger } from '../types.js';

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

/** dsh 宿主 approval/request 事件的请求形状(与本项目实际用到的字段) */
export interface ApprovalRequestLike {
  agent: unknown;
  toolName?: string;
  reason?: string;
  callId?: string;
  signal?: AbortSignal;
}

/** 入站消息的最小只读形状(与 transport/inbound.ts 的 msg 同形) */
interface ApprovableMessage {
  kind?: string;
  senderId?: string;
  content?: string;
  groupOpenid?: string;
  messageId?: string;
  [key: string]: unknown;
}

interface PendingApproval {
  record: SessionRecord;
  toolName?: string;
  reason?: string;
  deadlineAt: number;
  resolve: (outcome: ApprovalOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** Web 浮层看到的待办条目(去敏: 不含 agent 引用) */
export interface WebPendingApproval {
  code: string;
  toolName: string;
  reason: string;
  deadlineAt: number;
  /** 发起者描述(群=群名/私聊=昵称, 尽力而为) */
  ownerHint: string;
}

export interface ParsedApprovalCommand {
  outcome: 'allowed-once' | 'rejected';
  code: string;
}

/** 只解析显式审批命令; 普通聊天消息原样放行给 agent */
export function parseApprovalCommand(content: string): ParsedApprovalCommand | null {
  const normalized = content.trim();
  const match = normalized.match(/^\/(approve|allow|deny|reject)\s+([A-Z0-9]{6})$/i)
    ?? normalized.match(/^(允许|同意|拒绝|不同意)\s+([A-Z0-9]{6})$/i);
  if (!match) return null;
  const action = match[1]!.toLowerCase();
  return {
    outcome: ['approve', 'allow', '允许', '同意'].includes(action) ? 'allowed-once' : 'rejected',
    code: match[2]!.toUpperCase(),
  };
}

/** 面板/卡片按钮动作负载: {v:'approval', code, act:'allow'|'deny'} */
const BTN_PREFIX = 'ap:';

/** 构造审批卡片按钮 keyboard(仅主人可点) */
export function approvalKeyboard(code: string): unknown {
  const btn = (label: string, act: string, style: number) => ({
    id: `${BTN_PREFIX}${act}:${code}`,
    render_data: { label, visited_label: label + ' ✓', style },
    action: {
      type: 1,
      permission: { type: 0 }, // 0=指定用户可操作; 具体主人 id 在发送端按 record 注入(见 request)
      data: `${BTN_PREFIX}${act}:${code}`,
      unsupport_tips: '请回复 /approve 或 /deny + 验证码',
    },
  });
  return {
    content: {
      rows: [
        { buttons: [btn('✅ 允许本次', 'allow', 1)] },
        { buttons: [btn('❌ 拒绝', 'deny', 0)] },
      ],
    },
  };
}

/** 从 keyboard 回调数据解析动作; 非审批按钮返回 null */
export function parseApprovalButton(data: string | undefined): { act: 'allow' | 'deny'; code: string } | null {
  if (!data || !data.startsWith(BTN_PREFIX)) return null;
  const rest = data.slice(BTN_PREFIX.length);
  const m = /^(allow|deny):([A-Z0-9]{6})$/.exec(rest);
  if (!m) return null;
  return { act: m[1] as 'allow' | 'deny', code: m[2]!.toUpperCase() };
}

/** QQ 载体的一次性审批 answerer(dsh approval/request → QQ 按钮卡片 → interaction 回调结算) */
export class QqApprovalController {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(
    private readonly manager: SessionManager,
    private readonly sender: QQBotSender,
    private readonly logger: Logger,
    /** 超时(ms)提供器: 每次 request 现读, 支持 Web 设置热改生效 */
    private readonly timeoutMsProvider: () => number,
  ) {}

  /** 宿主 approval/request 处理器: 定位发起者会话并发 QQ 审批提示 */
  async request(req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    const record = this.manager.findByAgent(req.agent as never);
    if (!record) return next();
    if (req.signal?.aborted) return 'cancelled';
    const timeoutMs = Math.max(1000, this.timeoutMsProvider() || 120000);
    const reason = String(req.reason ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);
    const tool = String(req.toolName ?? req.callId ?? '未知工具');
    const deadlineAt = Date.now() + timeoutMs;

    // 一次性 6 位大写码(与 parseApprovalCommand 正则一致)
    let code = '';
    do {
      code = Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
    } while (this.pending.has(code));

    const outcome = new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => this.settle(code, 'rejected'), timeoutMs);
      const pending: PendingApproval = {
        record, toolName: tool, reason, deadlineAt, resolve, timer, signal: req.signal,
      };
      if (req.signal) {
        pending.onAbort = () => this.settle(code, 'cancelled');
        req.signal.addEventListener('abort', pending.onAbort, { once: true });
      }
      this.pending.set(code, pending);
    });

    const seconds = Math.ceil(timeoutMs / 1000);
    const prompt = [
      '⚠️ **DSH 权限申请**',
      `工具：${tool}`,
      reason ? `原因：${reason}` : '',
      '',
      `仅本次有效，${seconds} 秒后自动拒绝。`,
      '（按钮不可用时请回复 `/approve|/deny + 验证码`）',
    ].filter(Boolean).join('\n');

    try {
      // ① 按钮卡片优先: 按钮仅发起者本人可点(permission.specify_user_ids = 发起者 openid)
      const kb = approvalKeyboard(code);
      const ownerIds = record.scope === 'group' ? [record.senderId] : [];
      const kbRows = kb as { content: { rows: Array<{ buttons: Array<{ action: { permission: { type: number } } }> }> } };
      for (const row of kbRows.content.rows) {
        for (const b of row.buttons) {
          if (ownerIds.length > 0) (b.action.permission as { specify_user_ids?: string[] }).specify_user_ids = ownerIds;
        }
      }
      const sent = await this.sender.sendMarkdownWithKeyboard(record.replyTarget, prompt, kb);
      if (sent !== undefined || ownerIds.length > 0) {
        // 有 keyboard 支持或明确成功 → 按钮模式
        this.logger.info(`QQ approval requested (button): code=${code} tool=${tool}`);
      }
    } catch (err) {
      // ② 按钮不可用(未开通/被拒) → 降级纯文本码
      this.logger.warn(`QQ approval button failed, fallback text: ${err instanceof Error ? err.message : String(err)}`);
      try {
        const textPrompt = [
          '⚠️ **DSH 权限申请**',
          `工具：${tool}`,
          reason ? `原因：${reason}` : '',
          '',
          `允许本次操作：\`/approve ${code}\``,
          `拒绝本次操作：\`/deny ${code}\``,
          `仅本次有效，${seconds} 秒后自动拒绝。`,
        ].filter(Boolean).join('\n');
        await this.sender.sendMarkdown(record.replyTarget, textPrompt);
      } catch (err2) {
        // QQ 通道不可用(限频/网络)≠ 审批结束: 保留 pending 供 Web 浮层兜底处理,
        // 不要 settle 删除 —— 否则 QQ 没送达时 web 也看不到(双通道同时失效)。
        this.logger.error(`QQ approval prompt failed: ${err2 instanceof Error ? err2.message : String(err2)} (code=${code}, web 浮层可兜底)`);
        return outcome;
      }
    }
    return outcome;
  }

  /**
   * 入站拦截(挂在 bot.on('message') 最前): 命中 /approve|/deny CODE 则结算并消费消息。
   * @returns true = 消息已被审批逻辑消费(调用方不要再派发给 agent)
   */
  async handleInbound(msg: ApprovableMessage, replyTarget: ReplyTarget): Promise<boolean> {
    const command = parseApprovalCommand(msg.content ?? '');
    if (!command) return false;

    const pending = this.pending.get(command.code);
    if (!pending) {
      try { await this.sender.sendMarkdown(replyTarget, '该权限申请不存在或已过期。'); } catch { /* ignore */ }
      return true;
    }

    // 双校验: 必须是"任务发起者本人"且"同一会话"(群聊里其他成员看到 CODE 也不能批)
    const rec = pending.record;
    const sameSender = msg.senderId === rec.senderId;
    const samePeer = rec.scope === 'c2c'
      ? msg.kind === 'c2c' && msg.senderId === rec.peerId
      : msg.kind === 'group' && msg.groupOpenid === rec.peerId;
    if (!sameSender || !samePeer) {
      try { await this.sender.sendMarkdown(replyTarget, '你无权处理这项权限申请。'); } catch { /* ignore */ }
      return true;
    }

    this.settleWithReceipt(command.code, command.outcome, pending, replyTarget);
    return true;
  }

  /**
   * 按钮回调结算(bot.on('interaction') 转发过来; type=11 消息按钮)。
   * 命中审批按钮 → 校验发起者本人 → settle + 回执。
   * @returns true = 已被审批消费(调用方无需其它处理)
   */
  async handleInteraction(event: unknown, replyTarget: ReplyTarget): Promise<boolean> {
    const e = event as {
      data?: { type?: number; resolved?: { button_data?: string } };
      group_member_openid?: string;
      user_openid?: string;
    };
    if (e?.data?.type !== 11) return false;
    const parsed = parseApprovalButton(e.data.resolved?.button_data);
    if (!parsed) return false;

    const pending = this.pending.get(parsed.code);
    if (!pending) {
      try { await this.sender.sendMarkdown(replyTarget, '该权限申请不存在或已过期。'); } catch { /* ignore */ }
      return true;
    }
    // 校验发起者本人: c2c 看 user_openid; group 看 group_member_openid
    const presserId = e.group_member_openid ?? e.user_openid ?? '';
    if (!presserId || presserId !== pending.record.senderId) {
      try { await this.sender.sendMarkdown(replyTarget, '你无权处理这项权限申请。'); } catch { /* ignore */ }
      return true;
    }
    this.settleWithReceipt(parsed.code, parsed.act === 'allow' ? 'allowed-once' : 'rejected', pending, replyTarget);
    return true;
  }

  /** settle + 留痕注入 + QQ 回执(按钮与文本两条路共用) */
  private settleWithReceipt(
    code: string,
    outcome: 'allowed-once' | 'rejected',
    pending: PendingApproval,
    replyTarget: ReplyTarget,
  ): void {
    this.settle(code, outcome);
    // 留痕(不打扰, 正经注入): agent.inject 注入 plugin/notice —— 不唤醒、排队下个 step
    const toolName = pending.toolName || '';
    try {
      const agent = (pending.record.agent as { inject?: (m: unknown) => void } | undefined);
      if (agent && typeof agent.inject === 'function') {
        const allowed = outcome === 'allowed-once';
        agent.inject(createUserMessage({
          content: [{
            type: 'text' as const,
            text: `主人已在 QQ ${allowed ? '批准' : '拒绝'}一次工具权限申请${toolName ? `(工具: ${toolName})` : ''}。`,
          }],
          source: {
            kind: 'plugin' as const, plugin: 'qqbot-approval', form: 'notice' as const,
            summary: `主人${allowed ? '批准' : '拒绝'}了工具${toolName || ''}的权限申请`,
          } as never,
        }));
      }
    } catch { /* 注入失败不影响裁决 */ }
    try {
      void this.sender.sendMarkdown(
        replyTarget,
        outcome === 'allowed-once' ? '✅ 已允许本次操作。' : '❌ 已拒绝本次操作。',
      );
    } catch { /* ignore */ }
  }

  /** 结算: 清定时器/中止监听/pending 项并 resolve */
  private settle(code: string, outcome: ApprovalOutcome): void {
    const pending = this.pending.get(code);
    if (!pending) return;
    this.pending.delete(code);
    clearTimeout(pending.timer);
    if (pending.signal && pending.onAbort) {
      try { pending.signal.removeEventListener('abort', pending.onAbort); } catch { /* ignore */ }
    }
    pending.resolve(outcome);
  }

  /** Web 浮层拉取待办列表(去敏) */
  listPendingForWeb(): WebPendingApproval[] {
    const out: WebPendingApproval[] = [];
    for (const [code, p] of this.pending) {
      out.push({
        code,
        toolName: p.toolName ?? '',
        reason: p.reason ?? '',
        deadlineAt: p.deadlineAt,
        ownerHint: p.record.scope === 'group'
          ? `群 ${String(p.record.peerId ?? '').slice(0, 12)}`
          : `私聊 ${String(p.record.senderId ?? '').slice(0, 12)}`,
      });
    }
    return out.sort((a, b) => a.deadlineAt - b.deadlineAt);
  }

  /** Web 浮层点按钮: 按 code 结算(与 QQ 按钮/文本码共用 pending, 先到先得) */
  decideByWeb(code: string, act: 'allow' | 'deny'): { ok: boolean; msg: string } {
    const pending = this.pending.get(code);
    if (!pending) return { ok: false, msg: '该申请不存在或已过期' };
    this.settleWithReceipt(code, act === 'allow' ? 'allowed-once' : 'rejected', pending, pending.record.replyTarget);
    return { ok: true, msg: act === 'allow' ? '已允许本次操作' : '已拒绝本次操作' };
  }

  dispose(): void {
    for (const code of [...this.pending.keys()]) this.settle(code, 'cancelled');
  }
}

// ─────────────────────────────────────────────────────────────
// 审批事件接入(宿主机制考古结论, 2026-09-05 专家 agent 源码实证):
//   ApprovalService.decide() 用 ctx.waterfall(scopeTarget(agent), 'approval/request', …) 派发
//   (dsh-user-approval/lib/index.js:179)。waterfall 为【严格注册序、单赢家】:
//   先注册的监听先被调用, 返回非 next() 值即终结链路。
//   Web GUI 转发器 dsh-api-remotes 在宿主引导期(早于一切 profile 插件)注册
//   (dsh-api-remotes/lib/index.js:98,111-120), 浏览器连着且 agent 有 GUI 会话时
//   它挂起请求不 next() → 内层任何监听都轮不到(这就是"插件收不到审批"的根因)。
//   官方 ACP 模式(dsh-acp/lib/index.js:1118-1141)= 插件 apply ctx 上 ctx.on,
//   handler 先做 ownership 判断(不是自己的 agent → 立即 next())。
//   要抢在 GUI 前: 注册时传 { prepend: true } 把本监听插到链首。
// ─────────────────────────────────────────────────────────────

type ApprovalDispatch = (req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>;

let dispatch: ApprovalDispatch | undefined;

/** bootstrap 注册实际处理器(内含开关闸门 + ownership 由调用方处理); 传 undefined 可卸载 */
export function setApprovalDispatch(fn: ApprovalDispatch | undefined): void {
  dispatch = fn;
}

/** 生成挂在插件 apply ctx 的审批监听(ACP 模式): 非本 bot agent / 未启用 → next() 快速放行 */
export function makeApprovalListener(): (req: unknown, next: () => Promise<string>) => Promise<string> {
  return ((req: unknown, next: () => Promise<string>) => {
    console.log('[qq-approval] ctx listener fired');
    if (!dispatch) return next();
    return dispatch(req as never, next as never);
  }) as (req: unknown, next: () => Promise<string>) => Promise<string>;
}

// ── 按实例(ns)注册的审批控制器注册表 —— Web 审批浮层(settings-host 同源路由)经此读写 ──
const approvalControllers = new Map<string, QqApprovalController>();

export function registerApprovalController(ns: string, c: QqApprovalController | undefined): void {
  if (c) approvalControllers.set(ns, c);
  else approvalControllers.delete(ns);
}

/** 汇总所有实例的待办(web 浮层拉取) */
export function listAllPendingWeb(): Array<WebPendingApproval & { ns: string }> {
  const out: Array<WebPendingApproval & { ns: string }> = [];
  for (const [ns, c] of approvalControllers) {
    for (const p of c.listPendingForWeb()) out.push({ ns, ...p });
  }
  return out.sort((a, b) => a.deadlineAt - b.deadlineAt);
}

/** 跨实例结算: 返回 {ok, ns?, msg} */
export function decideByWebAny(code: string, act: 'allow' | 'deny'): { ok: boolean; ns?: string; msg: string } {
  for (const [ns, c] of approvalControllers) {
    const r = c.decideByWeb(code, act);
    if (r.ok) return { ok: true, ns, msg: r.msg };
  }
  return { ok: false, msg: '该申请不存在或已过期' };
}
