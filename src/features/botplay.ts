/**
 * botplay.ts — botplay 互动事件装配器(2026-09-08, Phase1 MVP)
 *
 * 设计定稿见工作区 参考文档/botplay互动事件装配器_设计完整稿.md(唯一权威):
 * 一句话本质 = 自定义 bot 互动事件: ①bot(非LLM)发出什么交互卡片 →
 * ②用户点哪个按钮 → ③这件事要不要/怎么影响 LLM, 全部可配置。
 *
 * 本文件职责(参照 qq-approval.ts / qq-user-questions.ts 的注册表范式):
 *   - BotplayController: 发卡(trigger) + interaction 回调结算(handleInteraction)
 *     + append 三档(no_append / append_silent / append_wake)
 *   - 事件配置从 live config(config.botplayEvents, settings 同源热更)现读;
 *     dock「🎮 互动事件」装配器编辑后保存即热更, 无需重启。
 *   - /botplay 命令经 triggerBotplay() 模块级注册表触发(仿 outbound-mode-switch)。
 *
 * Phase1 MVP 范围: schema 最小集(id/name/buttons[label,botAction.reply_text,
 * llmEffect.mode]/maxClicks/expireSec); perm 默认 all, triggerer 推荐;
 * 行为类型 reply_text 落地, jump_url/callback 预留。
 */
import type { ReplyTarget } from '@tencent-connect/qqbot-nodejs';
import type { QQBotSender } from '../transport/outbound-buffer.js';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';
import type { BotplayButtonConfig, BotplayEventConfig } from '../config.js';
import { readGroupMembers, readLedger } from './chat-ledger.js';

/** 按钮回调数据前缀 + 编码: bp:<cardId>:<buttonId>(button_data 是回调唯一凭证) */
const BTN_PREFIX = 'bp:';

/** 单次发卡的实例记录(防刷/过期/归属校验用) */
interface ActiveCard {
  cardId: string;
  eventId: string;
  /** triggerer=仅触发者本人时, 记录触发者 openid */
  triggererId?: string;
  /** maxClicks>0 时的剩余可点击数(点一次扣一) */
  remainClicks: number;
  /** 过期时间戳(ms) */
  expireAt: number;
}

export interface BotplayTriggerResult {
  ok: boolean;
  msg: string;
}

/** 默认 append 记录文本模板(事件级 llmEffect.contextText 留空时用它) */
function defaultContextText(eventName: string, buttonLabel: string): string {
  return `[互动事件·${eventName}] bot 发送了互动卡片, 用户点击了「${buttonLabel}」`;
}

/** 按模板渲染: 支持 {label} 占位; 末尾自动附加点击人身份(openid, 尽力带昵称) */
function renderContext(tpl: string | undefined, eventName: string, buttonLabel: string, clicker: string): string {
  let base = tpl && tpl.trim() ? String(tpl) : defaultContextText(eventName, buttonLabel);
  base = base.replace(/\{label\}/g, buttonLabel);
  // 点击人信息: 模板未显式包含时统一补一行(保证 AI 知道"谁点了")
  if (clicker && base.indexOf(clicker) < 0) {
    base += `\n(点击人: ${clicker})`;
  }
  return base;
}

/**
 * 构造事件卡片 keyboard(官方 msg_type=2 + keyboard)。
 * QQ 限制: rows ≤5 行 × 5 按钮/行; 这里采用每行 1 个(竖排, 字宽不截断)。
 * permission: 按事件 perm 决定 —— all→type2所有人 / triggerer→type0 指定触发者 /
 * owner→type0 主人白名单 / users→type0 指定 openid。
 */
export function botplayKeyboard(
  cardId: string,
  buttons: BotplayButtonConfig[],
  perm: NonNullable<BotplayEventConfig['perm']>,
  ownerIds: string[],
  triggererId?: string,
): { content: { rows: unknown[] } } {
  const shown = buttons.slice(0, 5); // QQ 行上限=5(每行1按钮)
  let permission: Record<string, unknown>;
  const specify: string[] = [];
  if (perm.type === 'triggerer' && triggererId) specify.push(triggererId);
  else if (perm.type === 'owner') specify.push(...ownerIds);
  else if (perm.type === 'users') specify.push(...(perm.userIds ?? []));
  permission = specify.length > 0 ? { type: 0, specify_user_ids: specify } : { type: 2 };
  const rows = shown.map((b) => ({
    buttons: [{
      id: `${BTN_PREFIX}${cardId}:${b.id}`,
      render_data: {
        label: String(b.label ?? '').slice(0, 20),
        visited_label: String(b.visitedLabel || b.label || '').slice(0, 20),
        style: b.style === 0 ? 0 : 1,
      },
      action: {
        type: 1, // 回调
        permission,
        data: `${BTN_PREFIX}${cardId}:${b.id}`,
        unsupport_tips: '请在支持的客户端点击按钮',
      },
    }],
  }));
  return { content: { rows } };
}

/** 从 interaction button_data 解析 cardId + buttonId; 非 botplay 按钮返回 null */
export function parseBotplayButton(data: string | undefined): { cardId: string; buttonId: string } | null {
  if (!data || !data.startsWith(BTN_PREFIX)) return null;
  const rest = data.slice(BTN_PREFIX.length);
  const idx = rest.indexOf(':');
  if (idx <= 0 || idx >= rest.length - 1) return null;
  return { cardId: rest.slice(0, idx), buttonId: rest.slice(idx + 1) };
}

export class BotplayController {
  private readonly cards = new Map<string, ActiveCard>();

  constructor(
    private readonly manager: SessionManager,
    private readonly sender: QQBotSender,
    private readonly logger: Logger,
    /** live 事件配置 getter(config.botplayEvents, 每次现读支持热更) */
    private readonly eventsGetter: () => BotplayEventConfig[],
    /** 主人 openid 白名单 getter(config.groupAdmin.owners; perm=owner 用) */
    private readonly ownersGetter: () => string[],
    /** 台账 dataDir getter(表情包目录; 点击人昵称反查, 与 dock 禁言面板同源) */
    private readonly ledgerDataDirGetter: () => string,
  ) {}

  /** 列出所有事件(公开, dock/命令共用) */
  listEvents(): BotplayEventConfig[] {
    return Array.isArray(this.eventsGetter()) ? this.eventsGetter() : [];
  }

  /** 按事件 id 精确查(live 现读) */
  findEvent(eventId: string): BotplayEventConfig | undefined {
    return this.listEvents().find((e) => e.id === eventId);
  }

  /**
   * 触发发卡(/botplay 事件名)。定位会话用命令上下文所在 scope/peerId,
   * 归属人 = 触发者本人 openid(group=c2c 同 senderId)。
   */
  async trigger(
    target: ReplyTarget,
    eventId: string,
    triggererId: string,
  ): Promise<BotplayTriggerResult> {
    const ev = this.findEvent(eventId);
    if (!ev) return { ok: false, msg: `事件不存在: ${eventId}(发 /botplay 查看列表)` };
    if (!Array.isArray(ev.buttons) || ev.buttons.length === 0) {
      return { ok: false, msg: `事件「${ev.name}」没有配置按钮` };
    }
    const expireSec = Math.max(30, Number(ev.expireSec ?? 600) || 600);
    const maxClicks = Math.max(0, Number(ev.maxClicks ?? 0) || 0);
    const cardId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const perm = ev.perm ?? { type: 'all' };
    const ownerIds = this.ownersGetter();
    this.cards.set(cardId, {
      cardId,
      eventId: ev.id,
      triggererId: perm.type === 'triggerer' ? triggererId : undefined,
      remainClicks: maxClicks > 0 ? maxClicks : 0,
      expireAt: Date.now() + expireSec * 1000,
    });

    const kb = botplayKeyboard(cardId, ev.buttons, perm, ownerIds, triggererId);
    const prompt = [
      `## 🎮 ${ev.name}`,
      '',
      '点下方按钮完成互动 👇',
      '',
      `⏱ 本卡片 ${expireSec} 秒内有效。`,
    ].join('\n');
    try {
      await this.sender.sendMarkdownWithKeyboard(target, prompt, kb);
      this.logger.info(`[botplay] 发卡 ok event=${ev.id} card=${cardId} target=${target.scope}:${target.targetId} perm=${perm.type}`);
      return { ok: true, msg: `已发出「${ev.name}」互动卡片 🎮` };
    } catch (err) {
      this.logger.warn(`[botplay] 发卡失败 event=${ev.id}: ${err instanceof Error ? err.message : String(err)}`);
      this.cards.delete(cardId);
      return { ok: false, msg: `发卡失败: ${err instanceof Error ? err.message : String(err)}(可能未开通卡片权限)` };
    }
  }

  /**
   * interaction 回调结算(bootstrap interaction 分发转发; type=11 消息按钮)。
   * 流程: 解析 bp:<cardId>:<buttonId> → 查卡(过期/点满) → 查事件配置(live)
   * → 校验按钮存在与点击人权限 → 执行 botAction → 按 llmEffect.mode append/唤醒。
   * @returns true = 已被 botplay 消费(调用方无需其它处理)
   */
  async handleInteraction(event: unknown, replyTarget: ReplyTarget): Promise<boolean> {
    const e = event as {
      data?: { type?: number; resolved?: { button_data?: string } };
      group_member_openid?: string;
      user_openid?: string;
    };
    if (e?.data?.type !== 11) return false;
    const parsed = parseBotplayButton(e.data.resolved?.button_data);
    if (!parsed) return false;

    const card = this.cards.get(parsed.cardId);
    if (!card) {
      // 卡不存在(重启后内存清空/已失效) → 提示重发
      await this.safeReply(replyTarget, '这张互动卡片已失效, 请重新发 /botplay 触发~');
      return true;
    }
    // 过期校验
    if (Date.now() > card.expireAt) {
      this.cards.delete(parsed.cardId);
      await this.safeReply(replyTarget, '这张互动卡片已超时失效, 请重新发 /botplay~');
      return true;
    }
    const ev = this.findEvent(card.eventId);
    if (!ev) {
      this.cards.delete(parsed.cardId);
      await this.safeReply(replyTarget, '该互动事件已被删除, 请让管理员重新配置~');
      return true;
    }
    const btn = (Array.isArray(ev.buttons) ? ev.buttons : []).find((b) => b.id === parsed.buttonId);
    if (!btn) {
      await this.safeReply(replyTarget, '按钮配置已更新, 请重新触发这张卡片~');
      return true;
    }

    // 点击人权限校验(与发卡 permission 双保险; 群看 member_openid, c2c 看 user_openid)
    const presser = e.group_member_openid ?? e.user_openid ?? '';
    const perm = ev.perm ?? { type: 'all' };
    const allowed = this.checkPerm(perm, card, presser);
    if (!allowed) {
      await this.safeReply(replyTarget, '这个按钮只有指定的人能点哦~');
      return true;
    }

    // 连点防刷: maxClicks>0 时扣减, 点满失效
    if (card.remainClicks > 0) {
      card.remainClicks -= 1;
      if (card.remainClicks <= 0) {
        this.cards.delete(parsed.cardId);
      }
    }

    // ① bot(非LLM)行为
    const actionType = btn.botAction?.type ?? 'reply_text';
    if (actionType === 'reply_text') {
      const text = String(btn.botAction?.text ?? '').trim();
      if (text) {
        try {
          await this.sender.sendMarkdown(replyTarget, text);
        } catch (err) {
          this.logger.warn(`[botplay] reply_text 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else if (actionType === 'jump_url') {
      // Phase2: 官方 action.type=0 跳转; Phase1 不落地, 仅提示
      await this.safeReply(replyTarget, '跳转行为在 Phase2 开放~');
    }
    // callback=仅结算, 无 bot 回复

    // ② LLM 影响三档(注入文本带点击人身份: 昵称(openid), 台账/会话历史反查)
    const mode = btn.llmEffect?.mode ?? 'no_append';
    if (mode !== 'no_append') {
      const clicker = this.clickerLabel(replyTarget, presser);
      const text = renderContext(btn.llmEffect?.contextText, ev.name, btn.label ?? '', clicker);
      await this.applyEffect(mode, replyTarget, text, presser);
    }
    return true;
  }

  /**
   * 点击人可读标签(与 dock 禁言面板/审批同源的昵称反查):
   *   ①群成员台账 group-members.jsonl(gid:mid → name, 由 chat-ledger 中间件持续记录)
   *   ②私聊台账 known-chats.jsonl(c2c:id → name)
   *   ③会话最近 user/message 消息壳 [昵称 (openid)] 兜底
   *   ④全 miss 回落 openid。
   */
  private clickerLabel(target: ReplyTarget, presser: string): string {
    if (!presser) return '未知用户';
    // ① 台账(host 侧与 dock 禁言同源: dataDir=表情包目录, 同 group-members.jsonl)
    try {
      const dataDir = this.ledgerDataDirGetter();
      if (dataDir) {
        if (target.scope === 'group') {
          const members = readGroupMembers(dataDir, target.targetId);
          const hit = members.find((m) => m.mid === presser);
          if (hit && hit.name) return `${hit.name}(${presser.slice(0, 8)}…)`;
        } else {
          const chats = readLedger(dataDir);
          const hit = chats.filter((c) => c.scope === 'c2c' && c.id === presser).sort((a, b) => b.ts - a.ts)[0];
          if (hit && hit.name) return `${hit.name}(${presser.slice(0, 8)}…)`;
        }
      }
    } catch { /* 台账读取失败, 走下一步 */ }
    // ③ 会话消息壳兜底
    const record = this.manager.findByPeer(target.scope, target.targetId);
    try {
      const evs = record?.agent?.session?.events;
      if (Array.isArray(evs)) {
        const from = Math.max(0, evs.length - 80);
        for (let i = evs.length - 1; i >= from; i--) {
          const ev = evs[i] as { type?: string; data?: Record<string, unknown> } | undefined;
          if (!ev || ev.type !== 'user/message') continue;
          const data = ev.data && typeof ev.data === 'object' ? ev.data : (ev as unknown as Record<string, unknown>);
          const src = data.source as { kind?: string } | undefined;
          if (src && src.kind === 'plugin') continue;
          const content = Array.isArray(data.content) ? (data.content as Array<{ text?: string }>) : [];
          const text = content.map((b) => (b?.text ?? '')).join('\n');
          if (!text) continue;
          // 壳格式: [昵称 (openid32)] 正文 (inbound.ts buildUserMessage)
          const idx = text.indexOf(`(${presser})`);
          if (idx > 1) {
            const head = text.slice(0, idx).replace(/^\[+/, '').trim();
            if (head && !head.includes(presser)) return `${head}(${presser.slice(0, 8)}…)`;
          }
        }
      }
    } catch { /* 解析失败回落 */ }
    return presser;
  }

  /** 权限判定: all 放行 / triggerer=触发者本人 / owner=主人白名单 / users=指定 openid */
  private checkPerm(
    perm: NonNullable<BotplayEventConfig['perm']>,
    card: ActiveCard,
    presser: string,
  ): boolean {
    if (perm.type === 'all') return true;
    if (!presser) return false; // 无人身份不给点
    if (perm.type === 'triggerer') return !!card.triggererId && presser === card.triggererId;
    if (perm.type === 'owner') return this.ownersGetter().includes(presser);
    if (perm.type === 'users') return (perm.userIds ?? []).includes(presser);
    return false;
  }

  /**
   * append 三档落点: 往该 peer 的会话写上下文/唤醒 AI。
   * ⚠️ 会话不在内存(重启后未恢复/被 idle 回收)→ getOrCreate 恢复/重建(不触发回合),
   *    保证 append/injectToPeer 有 record 可挂 —— 这是"点击没反应"的常见根因。
   */
  private async applyEffect(mode: 'append_silent' | 'append_wake', target: ReplyTarget, text: string, presser: string): Promise<void> {
    let record = this.manager.findByPeer(target.scope, target.targetId);
    if (!record) {
      try {
        record = await this.manager.getOrCreate(target.scope, target.targetId, presser || 'unknown', target);
        this.logger.info(`[botplay] 会话不在, 已 getOrCreate 恢复 ${target.scope}:${target.targetId}`);
      } catch (err) {
        this.logger.warn(`[botplay] getOrCreate 失败: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
    if (mode === 'append_silent') {
      // 记录不唤醒: 复用 group-join-request.ts:216 姿势 —— session.append 只落上下文
      const sess = (record.agent as unknown as {
        session?: { append?: (type: string, data: unknown, opts?: { surfaceOp?: string }) => unknown };
      } | undefined)?.session;
      if (!sess || typeof sess.append !== 'function') return;
      try {
        const { createUserMessage } = await import('@deepseek-ai/dsh-llm');
        const msg = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
        sess.append('user/message', msg, { surfaceOp: 'append' });
        this.logger.info(`[botplay] append_silent ok ${target.scope}:${target.targetId}`);
      } catch (err) {
        this.logger.warn(`[botplay] append_silent 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    // append_wake: 记录 + 唤醒 AI(走 injectToPeer followup, AI 开回合自然回应)
    try {
      const ok = await this.manager.injectToPeer(target.scope, target.targetId, text);
      this.logger.info(`[botplay] append_wake ${ok ? 'ok' : 'miss'} ${target.scope}:${target.targetId}`);
    } catch (err) {
      this.logger.warn(`[botplay] append_wake 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async safeReply(target: ReplyTarget, text: string): Promise<void> {
    try { await this.sender.sendMarkdown(target, text); } catch { /* 回复失败不致命 */ }
  }

  /** 清理全部活动卡(dispose 用) */
  clear(): void {
    this.cards.clear();
  }
}

// ── 按实例(ns)注册表 + 命令/触发共用入口(仿 outbound-mode-switch / qq-approval) ──
const botplayControllers = new Map<string, BotplayController>();

export function registerBotplayController(ns: string, c: BotplayController | undefined): void {
  if (c) botplayControllers.set(ns, c);
  else botplayControllers.delete(ns);
}

/** /botplay 命令触发入口: bootstrap 注册实现(带 sender/manager) */
type TriggerFn = (target: ReplyTarget, eventId: string, triggererId: string) => Promise<BotplayTriggerResult>;

let triggerImpl: TriggerFn | undefined;

export function setBotplayTriggerImpl(fn: TriggerFn | undefined): void {
  triggerImpl = fn;
}

export async function triggerBotplay(target: ReplyTarget, eventId: string, triggererId: string): Promise<BotplayTriggerResult> {
  if (!triggerImpl) return { ok: false, msg: 'botplay 未就绪(插件未启动)' };
  return triggerImpl(target, eventId, triggererId);
}

/** 取某 ns 的事件列表(dock 装配器读; settings value 里其实已有, 此出口备用) */
export function listBotplayEventsAny(): Array<BotplayEventConfig & { ns: string }> {
  const out: Array<BotplayEventConfig & { ns: string }> = [];
  for (const [ns, c] of botplayControllers) {
    for (const e of c.listEvents()) out.push({ ns, ...e });
  }
  return out;
}

/** 会话定位 → ReplyTarget(命令层用; senderId 即触发者) */
export function resolveCommandTarget(
  cmdCtx: { message?: { kind?: string; groupOpenid?: string; senderId?: string; messageId?: string } },
): { target: ReplyTarget; triggererId: string } {
  const msg = cmdCtx.message ?? {};
  const isGroup = msg.kind === 'group';
  const peerId = isGroup ? (msg.groupOpenid ?? msg.senderId ?? '') : (msg.senderId ?? '');
  return {
    target: { scope: isGroup ? 'group' : 'c2c', targetId: peerId, msgId: msg.messageId },
    triggererId: msg.senderId ?? '',
  };
}
