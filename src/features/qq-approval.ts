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
  resolve: (outcome: ApprovalOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
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

/** QQ 载体的一次性审批 answerer(dsh approval/request → QQ 提示 → /approve CODE) */
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

    // 一次性 6 位大写码(与 parseApprovalCommand 正则一致)
    let code = '';
    do {
      code = Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
    } while (this.pending.has(code));

    const outcome = new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => this.settle(code, 'rejected'), timeoutMs);
      const pending: PendingApproval = { record, resolve, timer, signal: req.signal };
      if (req.signal) {
        pending.onAbort = () => this.settle(code, 'cancelled');
        req.signal.addEventListener('abort', pending.onAbort, { once: true });
      }
      this.pending.set(code, pending);
    });

    const reason = String(req.reason ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);
    const tool = String(req.toolName ?? req.callId ?? '未知工具');
    const seconds = Math.ceil(timeoutMs / 1000);
    const prompt = [
      '⚠️ **DSH 权限申请**',
      `工具：${tool}`,
      reason ? `原因：${reason}` : '',
      '',
      `允许本次操作：\`/approve ${code}\``,
      `拒绝本次操作：\`/deny ${code}\``,
      `仅本次有效，${seconds} 秒后自动拒绝。`,
    ].filter(Boolean).join('\n');

    try {
      await this.sender.sendMarkdown(record.replyTarget, prompt);
      this.logger.info(`QQ approval requested: code=${code} tool=${tool}`);
    } catch (err) {
      this.logger.error(`QQ approval prompt failed: ${err instanceof Error ? err.message : String(err)}`);
      this.settle(code, 'unavailable');
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

    this.settle(command.code, command.outcome);
    try {
      await this.sender.sendMarkdown(
        replyTarget,
        command.outcome === 'allowed-once' ? '✅ 已允许本次操作。' : '❌ 已拒绝本次操作。',
      );
    } catch { /* ignore */ }
    return true;
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

  dispose(): void {
    for (const code of [...this.pending.keys()]) this.settle(code, 'cancelled');
  }
}
