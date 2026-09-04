/**
 * SessionManager — 管理 QQ peer → dsh Agent 的映射和生命周期
 *
 * sessionKey 格式: `qqbot:${appId}:${kind}:${peerId}`
 *   - c2c:   peerId = senderId (用户 openid)
 *   - group: peerId = groupOpenid
 *
 * SessionId 由 sessionKey 确定性派生（SHA-256），
 * 保证同一个用户/群的消息始终路由到同一个会话，
 * 重启后可根据 key 恢复 session。
 *
 * 支持 agent-presets 系统：通过 setup hook 在 create/resume 时
 * 挂载 preset（工具集、prompt sections 等），实现场景化配置。
 */
import { createHash, randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Context } from '@deepseek-ai/cordis';
import type { ChatScope, Logger, ReplyTarget } from '../types.js';
import type { ImQQBotConfig } from '../config.js';
import { ModelResolver } from '../model/model-resolver.js';
import type { ModelRoute, ModelEntry } from '../model/types.js';
import { IdleEvictor } from './idle-evictor.js';
import type {
  SessionEventLike,
  DshAgent,
  DshAgentHandle,
  SessionsService,
  DshAgentRegistry,
  AgentPresetsLike,
  PresetComposition,
  SessionRecord,
  SessionStatus,
  TokenUsageStats,
} from './types.js';
import type { QQBotSender } from '../transport/outbound-buffer.js';
import { apply as mountChannelTools } from '../channel-tools.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachSessionToWorkspace } from './workspace-attach.js';

/** 通道工具注册诊断: 默认关闭; 设环境变量 QQBOT_DIAG_FILE 启用 */
const SM_DIAG_FILE = process.env.QQBOT_DIAG_FILE || '';
function diagSm(line: string): void {
  if (!SM_DIAG_FILE) return;
  try { appendFileSync(SM_DIAG_FILE, `${new Date().toISOString()} [sm] ${line}\n`); } catch { /* ignore */ }
}

/** agent ctx 上"通道工具已装载"标记(幂等/自愈用) */
const CTX_TOOLS_READY: unique symbol = Symbol('qqbotChannelToolsReady');

export class SessionManager {
  private sessions = new Map<string, SessionRecord>();
  private readonly evictor: IdleEvictor;
  private readonly modelResolver: ModelResolver;
  /** QQ 通道发送能力(由 bootstrap 注入)；仅作为 qqChannel service 暴露给通道工具，不在此注册工具 */
  private channelSender: QQBotSender | undefined;
  /** 最近一次 setup 收到的 agent ctx(工具自愈用；getOrCreate 完成后读走并清空) */
  private lastSetupCtx: Context | undefined;

  /** 注入 QQ 通道发送能力(供通道工具)；bootstrap 调用 */
  public installChannelSender(sender: QQBotSender): void {
    this.channelSender = sender;
  }

  /** 本实例图库目录(多账号: 每实例 cwd 独立; config.sticker.dataDir 可覆盖) */
  public get stickerDataDir(): string {
    return this.config.sticker?.dataDir || join(this.config.cwd || process.cwd(), '表情包');
  }

  /** 本实例定时任务目录(多账号: 每实例 cwd 独立) */
  public get scheduleDataDir(): string {
    return join(this.config.cwd || process.cwd(), '.qqbot');
  }

  constructor(
    private readonly ctx: Context,
    private readonly agents: DshAgentRegistry,
    private readonly config: ImQQBotConfig,
    private readonly logger: Logger,
  ) {
    this.modelResolver = new ModelResolver(ctx, config, logger);

    this.evictor = new IdleEvictor(
      this.sessions,
      config.sessionIdleTimeout,
      (key, record) => {
        this.logger.info(`evicting idle session: key=${key}`);
        this.sessions.delete(key);
        record.agent.cancel({ kind: 'user' });
        void record.handle.dispose().catch(() => {});
      },
    );
  }

  /**
   * 动态获取 sessions 服务（fork 能力，可选）
   */
  private getSessionsService(): SessionsService | undefined {
    try {
      return this.ctx.get('sessions') as SessionsService | undefined;
    } catch {
      return undefined;
    }
  }

  // ── 模型相关（委托给 ModelResolver） ──

  getEffectiveModel(scope: ChatScope, peerId: string): ModelRoute | undefined {
    return this.modelResolver.getEffectiveRoute(this.sessionKey(scope, peerId));
  }

  /**
   * 切换模型（fork + 重建，对齐 dsh-TUI 的 switchModel）
   */
  async setModelOverride(scope: ChatScope, peerId: string, route: ModelRoute): Promise<void> {
    const key = this.sessionKey(scope, peerId);

    this.modelResolver.setOverride(key, route);

    const record = this.sessions.get(key);
    if (!record) {
      this.logger.info(`model pref saved (no active session): key=${key} → ${route.provider}/${route.model}`);
      return;
    }

    const sessionsService = this.getSessionsService();
    if (!sessionsService) {
      this.logger.warn(`fork unavailable, fallback to dispose: key=${key}`);
      this.sessions.delete(key);
      record.agent.cancel({ kind: 'user' });
      await record.handle.dispose().catch(() => {});
      return;
    }

    let seed: readonly unknown[];
    try {
      seed = sessionsService.fork(record.agent.session).events;
    } catch (err) {
      this.logger.warn(`fork failed, fallback to dispose: key=${key} err=${err instanceof Error ? err.message : String(err)}`);
      this.sessions.delete(key);
      record.agent.cancel({ kind: 'user' });
      await record.handle.dispose().catch(() => {});
      return;
    }

    const childId = SessionId(randomUUID());

    const composed = await this.composePreset(this.config.preset);
    const created = await this.agents.create({
      sessionId: childId,
      seed,
      meta: {
        cwd: this.config.cwd || process.cwd(),
        parentSession: record.sessionId,
        seedLength: seed.length,
        ...(composed.agentPreset ? { agentPreset: composed.agentPreset } : {}),
      },
      agentOptions: route,
      ...(composed.setup ? { setup: composed.setup } : {}),
    });

    this.modelResolver.setSessionId(key, childId);

    const oldHandle = record.handle;
    record.sessionId = childId;
    record.agent = created.agent;
    record.handle = created;
    record.agentPreset = composed.agentPreset;
    record.lastActivity = Date.now();

    void oldHandle.dispose().catch(() => {});
    this.logger.info(`model switched via fork: key=${key} → ${route.provider}/${route.model} sessionId=${childId}`);
  }

  clearModelOverride(scope: ChatScope, peerId: string): void {
    const key = this.sessionKey(scope, peerId);
    this.modelResolver.clearOverride(key);
    this.modelResolver.clearSessionId(key);
  }

  listAvailableModels(): ModelEntry[] {
    return this.modelResolver.listModels();
  }

  listProviders(): string[] {
    return this.modelResolver.listProviders();
  }

  // ── 会话状态 / 统计 ──

  getSessionRecord(scope: ChatScope, peerId: string): SessionRecord | undefined {
    return this.sessions.get(this.sessionKey(scope, peerId));
  }

  getStatus(scope: ChatScope, peerId: string): SessionStatus {
    const record = this.getSessionRecord(scope, peerId);
    const route = this.getEffectiveModel(scope, peerId);

    return {
      active: !!record,
      sessionId: record?.sessionId,
      provider: route?.provider,
      model: route?.model,
      preset: record?.agentPreset,
      lastActivity: record?.lastActivity,
      messageCount: this.countMessages(record),
    };
  }

  getTokenUsage(scope: ChatScope, peerId: string): TokenUsageStats {
    const record = this.getSessionRecord(scope, peerId);
    const stats: TokenUsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    const events = record?.agent.session.events;
    if (!events) return stats;

    for (const event of events) {
      if (event.type !== 'assistant/message' || !event.usage) continue;
      stats.input += event.usage.input ?? 0;
      stats.output += event.usage.output ?? 0;
      stats.cacheRead += event.usage.cacheRead ?? 0;
      stats.cacheWrite += event.usage.cacheWrite ?? 0;
    }

    return stats;
  }

  exportMarkdown(scope: ChatScope, peerId: string): string {
    const record = this.getSessionRecord(scope, peerId);
    if (!record) return '';

    const events = record.agent.session.events;
    if (!events || events.length === 0) return '';

    const lines: string[] = [`# QQ 会话导出\n`, `> session: ${record.sessionId}\n`];

    for (const event of events) {
      if (event.type === 'user/message') {
        const text = extractMessageText(event.message);
        if (text) lines.push(`## 用户\n\n${text}\n`);
      } else if (event.type === 'assistant/message') {
        const text = extractMessageText(event.message);
        if (text) lines.push(`## 助手\n\n${text}\n`);
      }
    }

    return lines.join('\n');
  }

  private countMessages(record: SessionRecord | undefined): number {
    const events = record?.agent.session.events;
    if (!events) return 0;

    let count = 0;
    for (const event of events) {
      if (event.type === 'user/message' || event.type === 'assistant/message') {
        count += 1;
      }
    }
    return count;
  }

  // ── Session 生命周期管理 ──

  private sessionKey(scope: ChatScope, peerId: string): string {
    return `qqbot:${this.config.appId}:${scope}:${peerId}`;
  }

  private deriveSessionId(sessionKey: string): string {
    const hash = createHash('sha256').update(sessionKey).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  private currentSessionId(sessionKey: string): string {
    return this.modelResolver.getSessionId(sessionKey) ?? this.deriveSessionId(sessionKey);
  }

  private async composePreset(presetId?: string): Promise<PresetComposition> {
    let presets: AgentPresetsLike | undefined;
    try {
      presets = this.ctx.get('agentPresets') as AgentPresetsLike | undefined;
    } catch {
      // agentPresets 服务未注入，降级跳过
    }

    // 通道级装配(与 preset 无关)：QQ 会话创建时 provide qqChannel 供通道工具 execute 解析。
    // ⚠️ 工具注册分层规则(宿主机制, 专家团查明):
    //   - 有 agent-presets(web): 工具由 preset 的 agent.cordis.yml 声明为插件行, 经 loader 装进 standing 层
    //     (与 tool-fs 同层) → LLM 可见。此处只 provide qqChannel, 不重复注册。
    //   - 无 presets(devqq 最小装配): 此处直接注册到 agentCtx(own 层) 兜底。
    const provideChannel =
      this.channelSender === undefined
        ? undefined
        : (agentCtx: Context) => {
            this.lastSetupCtx = agentCtx;
            try {
              (agentCtx as { provide?: (n: string, v: unknown) => unknown }).provide?.('qqChannel', {
                manager: this,
                sender: this.channelSender as QQBotSender,
              });
            } catch { /* ignore */ }
          };
    const registerOnAgentCtx =
      this.channelSender === undefined
        ? undefined
        : async (agentCtx: Context) => {
            if ((agentCtx as unknown as { [k: symbol]: unknown })[CTX_TOOLS_READY] === true) {
              diagSm('agentCtx 注册跳过(已装载过)');
              return;
            }
            try {
              await mountChannelTools(agentCtx as never);
              (agentCtx as unknown as { [k: symbol]: unknown })[CTX_TOOLS_READY] = true;
              this.logger.info('im-qqbot: 通道工具已注册到 agentCtx(send_media/recall_message/list_stickers)');
              diagSm('agentCtx 注册完成(mountChannelTools 正常返回)');
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              this.logger.warn?.(`im-qqbot: 装载通道工具失败(跳过): ${msg}`);
              diagSm(`agentCtx 注册异常: ${msg}`);
            }
          };
    const channelSetup = (agentCtx: Context) => (async () => {
      provideChannel?.(agentCtx);
      // 群守则 → systemPrompt.section(常驻 system, 每请求必见, 不再每轮塞 user 历史省 token):
      // text() 每次渲染现读 live config(面板热改即对新回合生效); 仅群会话返回守则(私聊返回空)。
      try {
        const sp = (agentCtx as { systemPrompt?: { section?: (o: unknown) => unknown } }).systemPrompt;
        if (sp && typeof sp.section === 'function') {
          sp.section({
            name: 'qqbot:group-rules',
            order: 50,
            text: (context: { agent?: unknown }) => {
              try {
                const rec = this.findByAgent(context?.agent as never);
                if (!rec || rec.scope !== 'group') return '';
                return this.config.groupPrompt?.trim() || '';
              } catch { return ''; }
            },
          });
        }
      } catch { /* 守则 section 注册失败不影响会话 */ }
      // 有 presets(standing 装配)时由 preset 插件行装载工具, 不再注册 agentCtx
      if (!presets) {
        diagSm('无 agent-presets → agentCtx 直接注册(devqq 路径)');
        await registerOnAgentCtx?.(agentCtx);
      } else {
        diagSm('有 agent-presets → 工具由 preset 装配层提供, 仅 provide qqChannel');
      }
    })();

    if (!presets) return channelSetup ? { setup: channelSetup } : {};

    try {
      const resolved = await presets.resolve(presetId);
      const resolvedId = resolved.id;
      return {
        agentPreset: resolvedId,
        setup: async (agentCtx: Context) => {
          await presets.mount(agentCtx, resolvedId);
          if (channelSetup) await channelSetup(agentCtx);
        },
      };
    } catch (err) {
      this.logger.warn(
        `im-qqbot: preset ${presetId ?? '(default)'} unavailable: ${err instanceof Error ? err.message : String(err)} — using host composition`,
      );
      return channelSetup ? { setup: channelSetup } : {};
    }
  }

  /** 获取或恢复或创建会话（get → resume → create） */
  async getOrCreate(
    scope: ChatScope,
    peerId: string,
    senderId: string,
    replyTarget: ReplyTarget,
  ): Promise<SessionRecord> {
    const key = this.sessionKey(scope, peerId);
    const existing = this.sessions.get(key);

    if (existing) {
      existing.replyTarget = replyTarget;
      existing.lastActivity = Date.now();
      return existing;
    }

    const route = this.modelResolver.getEffectiveRoute(key);
    const sessionId = SessionId(this.currentSessionId(key));
    this.logger.info(`getOrCreate: key=${key} route=${route ? `${route.provider}/${route.model}` : 'host-default'} sessionId=${sessionId}`);

    let agent: DshAgent;
    let handle: DshAgentHandle | undefined;
    let agentPreset: string | undefined;

    const live = this.agents.get(sessionId);
    if (live) {
      agent = live;
      this.logger.info(`reusing live agent: key=${key}`);
    } else {
      // preset 只解析一次：resume/create 共用同一组合，避免重复 resolve/mount 目录
      const composed = await this.composePreset(this.config.preset);
      agentPreset = composed.agentPreset;
      try {
        const resumeRoute = this.modelResolver.getResumeRoute(key);
        const resumed = await this.agents.resume({
          resumeSessionId: sessionId,
          ...(resumeRoute ? { agentOptions: resumeRoute } : {}),
          ...(composed.setup ? { setup: composed.setup } : {}),
        });
        agent = resumed.agent;
        handle = resumed;
        this.logger.info(`resumed session: key=${key} preset=${agentPreset ?? 'none'} route=${resumeRoute ? `${resumeRoute.provider}/${resumeRoute.model}` : 'session-own'}`);
      } catch {
        const created = await this.agents.create({
          sessionId,
          meta: {
            cwd: this.config.cwd || process.cwd(),
            ...(agentPreset ? { agentPreset } : {}),
          },
          ...(route ? { agentOptions: route } : {}),
          ...(composed.setup ? { setup: composed.setup } : {}),
        });
        agent = created.agent;
        handle = created;
        this.logger.info(`created new session: key=${key} preset=${agentPreset ?? 'none'}`);
      }
    }

    const record: SessionRecord = {
      sessionKey: key,
      sessionId,
      agent,
      handle: handle ?? { agent, dispose: async () => {} },
      replyTarget,
      scope,
      peerId,
      senderId,
      lastActivity: Date.now(),
      agentPreset,
      // 自愈用：setup 若正常跑到 channelSetup，此处拿到 agent ctx 且标记已装载
      agentCtx: this.lastSetupCtx,
      channelToolsReady: (this.lastSetupCtx as unknown as { [k: symbol]: unknown } | undefined)?.[CTX_TOOLS_READY] === true,
    };
    this.lastSetupCtx = undefined;

    this.sessions.set(key, record);

    // 修复侧边栏归属(上游 PR #21 移植): 创建/恢复会话后挂到 cwd 对应工作区分组,
    // 防刷新后落 Ungrouped。幂等 + fail-soft(内部全吞), fire-and-forget 不阻塞主链。
    void attachSessionToWorkspace(this.ctx, this.config.cwd, sessionId, this.logger);

    return record;
  }

  /**
   * 通道工具自愈：若会话因宿主初始化竞态没装上 send_media/recall/list_stickers，
   * 在消息处理路径上补一次注册(幂等)。修复"开着浏览器重启 → 会话无工具"问题。
   */
  async ensureChannelTools(record: SessionRecord): Promise<void> {
    if (!this.channelSender || record.channelToolsReady) return;
    const agentCtx = record.agentCtx as Context | undefined;
    if (!agentCtx) {
      diagSm('ensureChannelTools: 跳过(无 agentCtx, setup 未执行到)');
      return;
    }
    try {
      await mountChannelTools(agentCtx);
      (agentCtx as unknown as { [k: symbol]: unknown })[CTX_TOOLS_READY] = true;
      record.channelToolsReady = true;
      this.logger.info('im-qqbot: 工具自愈补注册完成(send_media/recall_message/list_stickers)');
      diagSm('ensureChannelTools: 自愈补注册成功');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn?.(`im-qqbot: 工具自愈补注册失败: ${msg}`);
      diagSm(`ensureChannelTools: 失败 ${msg}`);
    }
  }

  findBySessionId(sessionId: string): SessionRecord | undefined {
    for (const record of this.sessions.values()) {
      if (record.sessionId === sessionId) return record;
    }
    return undefined;
  }

  findByAgent(agent: DshAgent): SessionRecord | undefined {
    for (const record of this.sessions.values()) {
      if (record.agent === agent) return record;
    }
    // 兜底: 宿主可能给工具传入同会话的另一个 agent 实例(热更新/多实例后引用不一致), 但 id 稳定
    const aid = (agent as { id?: unknown } | undefined)?.id;
    if (aid !== undefined) {
      for (const record of this.sessions.values()) {
        if (record.agent.id === aid) return record;
      }
    }
    return undefined;
  }

  /**
   * 定时/主动注入: 向某会话塞一条新消息(像收到新消息, AI 带上下文处理并回复到 QQ)。
   * 会话当前不在(被回收/未建立)→ 返回 false, 由调用方决定(计数/跳过)。
   */
  async injectToPeer(scope: ChatScope, peerId: string, text: string): Promise<boolean> {
    const key = this.sessionKey(scope, peerId);
    const record = this.sessions.get(key);
    if (!record) return false;
    try {
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      });
      record.agent.followup(message);
      record.lastActivity = Date.now();
      this.logger.info(`injectToPeer: ${key} ok`);
      return true;
    } catch (err) {
      this.logger.warn?.(`injectToPeer failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  async remove(scope: ChatScope, peerId: string): Promise<void> {
    const key = this.sessionKey(scope, peerId);
    const record = this.sessions.get(key);
    if (!record) return;
    this.sessions.delete(key);
    this.modelResolver.clearSessionId(key);
    record.agent.cancel({ kind: 'user' });
    await record.handle.dispose().catch(() => {});
    this.logger.info(`session removed: key=${key}`);
  }

  async disposeAll(): Promise<void> {
    this.evictor.dispose();
    const records = [...this.sessions.values()];
    this.sessions.clear();
    for (const record of records) {
      record.agent.cancel({ kind: 'user' });
    }
    await Promise.allSettled(records.map((r) => r.handle.dispose()));
    this.logger.info(`all sessions disposed (count=${records.length})`);
  }

  get size(): number {
    return this.sessions.size;
  }
}

/** 从消息对象中提取纯文本（用于导出/统计） */
function extractMessageText(
  message: SessionEventLike['message'],
): string {
  const blocks = message?.content;
  if (!blocks || !Array.isArray(blocks)) return '';

  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}
