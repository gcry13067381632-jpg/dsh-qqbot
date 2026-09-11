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
import { FIXED_CHANNEL_CONTEXT } from '../config.js';
import { dataRootOf, stickerDirOf } from '../gateway/data-root.js';
import { SettingsReader } from '../model/settings-reader.js';
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
import { createGroupAdmin } from '../api/group-admin.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachSessionToWorkspace, unarchiveSession } from './workspace-attach.js';

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
  /** 群守则热更新: 每次 system prompt 渲染现读 settings.yaml(SettingsReader fresh 模式) */
  private liveSettingsReader: SettingsReader | undefined;

  /** 注入 QQ 通道发送能力(供通道工具)；bootstrap 调用 */
  public installChannelSender(sender: QQBotSender): void {
    this.channelSender = sender;
  }

  /** 本实例工作目录(多账号独立; 缺省进程 cwd) */
  public get cwd(): string {
    return this.config.cwd || process.cwd();
  }

  /** 插件数据根(表情包/.qqbot/扩展统一挂其下; config.dataRoot 缺省=cwd) */
  public get dataRoot(): string {
    return dataRootOf(this.config);
  }

  /** 本实例图库目录(多账号: 每实例数据根独立; config.sticker.dataDir 可覆盖) */
  public get stickerDataDir(): string {
    return stickerDirOf(this.config);
  }

  /** 本实例定时任务目录(多账号: 每实例数据根独立) */
  public get scheduleDataDir(): string {
    return join(dataRootOf(this.config), '.qqbot');
  }

  /** 本实例群管理客户端(懒建; groupAdmin.enabled=false 时 undefined) */
  public get groupAdmin(): ReturnType<typeof createGroupAdmin> | undefined {
    if (!this.config.groupAdmin?.enabled) return undefined;
    if (!this._groupAdmin) {
      this._groupAdmin = createGroupAdmin({ appId: this.config.appId, appSecret: this.config.appSecret });
    }
    return this._groupAdmin;
  }
  private _groupAdmin?: ReturnType<typeof createGroupAdmin>;

  /** 对话内默认管理群(web/非群会话时群工具用它; 空=未配置) */
  public get manageGroup(): string {
    return this.config.groupAdmin?.manageGroup ?? '';
  }

  /** 当前出站模式(adaptive/passive/silent/nothink; 命令与 channel 工具读它显示当前值) */
  public get outboundMode(): string {
    return (this.config as { outboundMode?: string }).outboundMode || 'adaptive';
  }

  /** 实例 settingsNs(多账号实例 id; 无则默认 im-qqbot) */
  public get settingsNs(): string {
    return ((this.config as { settingsNs?: string }).settingsNs ?? '').trim() || 'im-qqbot';
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

    // 2026-09-11 主人定: 被归档的 QQ 会话在**被消息触发时**自动拉回可见(见 workspace-attach.ts)。
    // 这里不装任何守卫/拦截/定时器 —— 纯触发式, 落点在 getOrCreate 的两条路径上:
    //   ① 命中已有活跃记录 → unarchiveSession(); ② 新建/恢复 → attachSessionToWorkspace()。
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
    const key = this.sessionKey(scope, peerId);
    const rec = this.sessions.get(key);
    // 2026-09-11: 优先读宿主 agent 实际生效模型 —— web 会话级模型设置会改宿主
    // agent.options.provider/model(推理真用那个); 探测失败(fail-soft)回落配置链。
    if (rec?.agent) {
      try {
        const o = (rec.agent as unknown as { options?: { provider?: string; model?: string } }).options;
        if (o?.provider && o?.model) return { provider: o.provider, model: o.model };
      } catch { /* fail-soft */ }
    }
    // 2026-09-11: 模型偏好绑定会话 —— 取当前会话的 sessionId 查 override
    const sid = rec?.sessionId ?? this.currentSessionId(key);
    return this.modelResolver.getEffectiveRoute(key, sid);
  }

  /**
   * 切换模型（fork + 重建，对齐 dsh-TUI 的 switchModel）
   * ⚠️ 2026-09-11 主人定: 模型偏好改为绑定会话(sessionId)——override 存到 fork 后的
   *    新会话 id, 使新会话/新档不再继承 peer 级旧偏好(修复"新建会话默认火山")。
   */
  async setModelOverride(scope: ChatScope, peerId: string, route: ModelRoute): Promise<void> {
    const key = this.sessionKey(scope, peerId);

    const record = this.sessions.get(key);
    if (!record) {
      // 无活跃会话：挂到当前/派生 sessionId(下次 create/resume 会命中)
      const sid = this.currentSessionId(key);
      this.modelResolver.setOverride(key, sid, route);
      this.logger.info(`model pref saved (no active session): key=${key} sid=${sid} → ${route.provider}/${route.model}`);
      return;
    }

    // fork 旧会话历史作为 seed → 子会话保留上下文继续聊(换模型不丢记忆)
    await this.forkCurrentSession(key, record, route, true);
    // fork 后 record.sessionId = childId；override 挂到新会话(会话级绑定)
    this.modelResolver.setOverride(key, record.sessionId, route);
    this.logger.info(`model pref saved (forked): key=${key} sid=${record.sessionId} → ${route.provider}/${route.model}`);
  }

  /**
   * 开新会话(2026-09-08 修 /bot-new 假实现; 同日加 preset 切换):
   * 当前会话 fork 成 childId(旧会话存档为 parent, 磁盘记录仍在可回看),
   * 用同模型建新 agent 替换活跃记录。inherit=true 继承旧对话上下文(切模型用);
   * false = 全新空档(不继承旧上下文, 旧会话存档可回看)。
   * presetId 给定时: 记录该会话的 preset 覆盖并用于新档(如 /new code 切人格);
   * 不传则沿用当前生效 preset(config 或之前会话覆盖)。
   * 无活跃记录(会话损坏/重启后没聊过)时不再失败: 轮换 sessionId 直接另起新档。
   * @returns 'forked'=从当前会话 fork 出新档 | 'rotated'=无活跃记录另起全新档 | 'failed'=创建失败
   */
  async startNewSession(
    scope: ChatScope,
    peerId: string,
    inherit = false,
    presetId?: string,
    fallback?: { replyTarget?: ReplyTarget; senderId?: string },
  ): Promise<'forked' | 'rotated' | 'failed'> {
    const key = this.sessionKey(scope, peerId);
    const record = this.sessions.get(key);

    // 2026-09-11 主人反馈「炸了的会话在 QQ 上没法弃号重开」:
    // 会话在磁盘上损坏(历史加载失败)时内存里没有活跃记录, 原实现在此直接 return false →
    // QQ 侧 /bot-new 只会回「当前没有活跃会话, 无需开新」, 主人无路可走。
    // 现改为: 轮换 sessionId 直接另起新档(坏档文件原样保留在磁盘, 不删也不修)。
    if (!record) {
      if (presetId) {
        try { this.modelResolver.setSessionPreset(key, presetId); } catch { /* ignore */ }
      }
      const replyTarget: ReplyTarget = fallback?.replyTarget ?? { scope, targetId: peerId };
      try {
        await this.getOrCreate(scope, peerId, fallback?.senderId ?? '', replyTarget, { forceNew: true });
        this.logger.info(`startNewSession: 无活跃记录 → 已另起新档 key=${key}${presetId ? ` preset=${presetId}` : ''}`);
        return 'rotated';
      } catch (err) {
        this.logger.warn(`startNewSession(rotated) failed: key=${key} err=${err instanceof Error ? err.message : String(err)}`);
        return 'failed';
      }
    }

    // preset 覆盖: 显式给出则落盘(重启后恢复同 preset)
    if (presetId) {
      try { this.modelResolver.setSessionPreset(key, presetId); } catch { /* ignore */ }
    }

    const route = this.modelResolver.getEffectiveRoute(key, record.sessionId);
    await this.forkCurrentSession(key, record, route, inherit);
    return 'forked';
  }

  /** 当前会话生效 preset: 会话覆盖(/new 指定) > config.preset */
  private effectivePreset(key: string): string | undefined {
    const override = this.modelResolver.getSessionPreset(key);
    return override || this.config.preset;
  }

  /** 当前会话实际生效的人格(展示用): 会话记录 agentPreset(已挂载) > effectivePreset */
  getEffectivePreset(scope: ChatScope, peerId: string): string | undefined {
    const key = this.sessionKey(scope, peerId);
    const record = this.sessions.get(key);
    return record?.agentPreset || this.effectivePreset(key);
  }

  /**
   * 热切换预设(2026-09-10 主人确认: 设置页就是这么热切的):
   * 直接调宿主 agentPresets.recompose(agent.ctx, id) —— 重绑 agent 的 scope 父级
   * 到目标 preset 的 standing mount, 立即生效、不丢会话历史、不 fork。
   * 这是宿主「账号和预设」设置页同款通道(实测语气即变)。
   * @returns 'ok' | 'no-session' | 'no-preset' | 'recompose-failed'
   */
  async switchPreset(scope: ChatScope, peerId: string, presetId: string): Promise<string> {
    const key = this.sessionKey(scope, peerId);
    const record = this.sessions.get(key);
    if (!record) return 'no-session';
    if (!(await this.hasPreset(presetId))) return 'no-preset';

    const agentCtx = (record.agent as { ctx?: Context } | undefined)?.ctx;
    if (!agentCtx) return 'recompose-failed';

    try {
      const presets = this.ctx.get('agentPresets') as {
        recompose?: (agentCtx: Context, id: string) => Promise<unknown>;
      } | undefined;
      if (!presets || typeof presets.recompose !== 'function') {
        this.logger.warn(`switchPreset: 宿主未提供 agentPresets.recompose, 回退 fork 通道`);
        return 'recompose-failed';
      }
      await presets.recompose(agentCtx, presetId);
      // 记录会话 preset 覆盖(重启后恢复同人格; 与 /new 一致)
      try { this.modelResolver.setSessionPreset(key, presetId); } catch { /* ignore */ }
      // 更新 record 上的 agentPreset 展示字段(会话状态/日志用)
      record.agentPreset = presetId;
      this.logger.info(`switchPreset ok: key=${key} → preset=${presetId} (host recompose, 热切不丢历史)`);
      return 'ok';
    } catch (err) {
      this.logger.warn(`switchPreset failed: key=${key} err=${err instanceof Error ? err.message : String(err)}`);
      return 'recompose-failed';
    }
  }

  /** 列出宿主可用 agent presets(供 /presets 命令; 失败返回空) */
  async listPresets(): Promise<Array<{ id: string; name?: string; broken?: boolean }>> {
    try {
      const presets = this.ctx.get('agentPresets') as {
        list?: () => Promise<Array<{ id: string; name?: string; broken?: boolean }>>;
      } | undefined;
      if (!presets || typeof presets.list !== 'function') return [];
      return await presets.list();
    } catch {
      return [];
    }
  }

  /** 校验 preset id 是否存在(供 /new <id>; 未知/损坏返回 false) */
  async hasPreset(id: string): Promise<boolean> {
    const list = await this.listPresets();
    return list.some((p) => p.id === id && !p.broken);
  }

  // ── 宿主权限档位(permissionPresets)桥接(2026-09-08, QQ 里切权限) ──

  private permissionPresetsService(): { names?: string[]; optionOf?: (n: string) => { value: string; name: string; description?: string }; current?: (s: unknown) => string; set?: (s: unknown, n: string) => void } | undefined {
    try {
      return this.ctx.get('permissionPresets') as ReturnType<SessionManager['permissionPresetsService']>;
    } catch {
      return undefined;
    }
  }

  /** 列出宿主权限档(如 workspace-write / danger-full-access / read-only) */
  async listPermissionPresets(): Promise<Array<{ value: string; name: string; description?: string }>> {
    const svc = this.permissionPresetsService();
    if (!svc || !Array.isArray(svc.names) || typeof svc.optionOf !== 'function') return [];
    return svc.names.map((n) => svc.optionOf!(n));
  }

  /** 当前会话权限档名 */
  currentPermissionPreset(scope: ChatScope, peerId: string): string {
    const svc = this.permissionPresetsService();
    if (!svc || typeof svc.current !== 'function') return '';
    const rec = this.sessions.get(this.sessionKey(scope, peerId));
    if (!rec) return '';
    try { return svc.current((rec.agent as { session?: unknown }).session); } catch { return ''; }
  }

  /** 切权限档: 校验名字 → svc.set(session, name) */
  async switchPermissionPreset(scope: ChatScope, peerId: string, name: string): Promise<{ ok: boolean; msg: string }> {
    const svc = this.permissionPresetsService();
    if (!svc || typeof svc.set !== 'function') {
      return { ok: false, msg: '宿主未提供 permissionPresets 服务(需装配 dsh-permission-presets)' };
    }
    const list = await this.listPermissionPresets();
    const hit = list.find((p) => p.value === name);
    if (!hit) {
      const lines = [`未知权限档「${name}」— 可用:`];
      for (const p of list) lines.push(`- ${p.value}${p.name && p.name !== p.value ? `(${p.name})` : ''}${p.description ? ` — ${p.description}` : ''}`);
      return { ok: false, msg: lines.join('\n') };
    }
    const rec = this.sessions.get(this.sessionKey(scope, peerId));
    if (!rec) return { ok: false, msg: '当前没有活跃会话, 请先聊一句再切' };
    try {
      svc.set((rec.agent as { session?: unknown }).session, name);
      this.logger.info(`[permission] 权限档 → ${name} (${scope}:${peerId})`);
      return { ok: true, msg: `✅ 权限档已切换: **${hit.name ?? name}**${hit.description ? `\n${hit.description}` : ''}` };
    } catch (err) {
      return { ok: false, msg: `切换失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }


  /** fork 当前会话 → 新 childId; inherit=true 用旧历史做 seed(切模型), false 全新空档; 失败降级 dispose */
  private async forkCurrentSession(
    key: string,
    record: SessionRecord,
    route: ModelRoute | undefined,
    inherit: boolean,
  ): Promise<void> {
    const sessionsService = this.getSessionsService();
    if (!sessionsService) {
      this.logger.warn(`fork unavailable, fallback to dispose: key=${key}`);
      this.sessions.delete(key);
      record.agent.cancel({ kind: 'user' });
      await record.handle.dispose().catch(() => {});
      return;
    }

    let seed: readonly unknown[] | undefined;
    if (inherit) {
      try {
        seed = sessionsService.fork(record.agent.session).events;
      } catch (err) {
        this.logger.warn(`fork failed, fallback to dispose: key=${key} err=${err instanceof Error ? err.message : String(err)}`);
        this.sessions.delete(key);
        record.agent.cancel({ kind: 'user' });
        await record.handle.dispose().catch(() => {});
        return;
      }
    }

    const childId = SessionId(randomUUID());

    const composed = await this.composePreset(this.effectivePreset(key));
    const created = await this.agents.create({
      sessionId: childId,
      ...(seed ? { seed } : {}),
      meta: {
        cwd: this.config.cwd || process.cwd(),
        parentSession: record.sessionId,
        ...(seed ? { seedLength: seed.length } : {}),
        ...(composed.agentPreset ? { agentPreset: composed.agentPreset } : {}),
      },
      ...(route ? { agentOptions: route } : {}),
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
    this.logger.info(`forked session: key=${key} → ${childId} ${seed ? '(继承历史)' : '(全新空档, 旧会话存档为 parent)'} route=${route ? `${route.provider}/${route.model}` : 'session-own'}`);
  }

  clearModelOverride(scope: ChatScope, peerId: string): void {
    const key = this.sessionKey(scope, peerId);
    const rec = this.sessions.get(key);
    const sid = rec?.sessionId ?? this.currentSessionId(key);
    this.modelResolver.clearOverride(key, sid);
    this.modelResolver.clearSessionId(key);
  }

  async listAvailableModels(): Promise<ModelEntry[]> {
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
    // 工具永久挂载(2026-09-06 主人定): QQ 会话创建/恢复的 setup 事务内一律把 channel-tools 注册到
    //   agentCtx(own 层, 幂等) → 新会话即刻带工具、重启 resume 也带; 不再依赖 preset 声明
    //   (任意预设走 QQ 都可用, preset 文件零改动; 账号页预设过滤已放开)。
    //   standing 层若与 preset 自带装配并存, channel-tools 内部幂等跳过重复, 无副作用。
    //   安全: setup 只由 QQ 会话管理器(getOrCreate/create/resume)执行, 纯 web 会话不经过 → 不挂。
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
      // 守则/身份 context 注册已移至 ensureGroupRules(每次消息自愈钩子, 幂等)。
      // QQ 工具: setup 事务(create/resume 都执行)内无条件注册到 agentCtx own 层(幂等)——
      // 有 presets 也注册(此前只 provide、留给 preset 装配; 2026-09-06 改为永久挂载)。
      await registerOnAgentCtx?.(agentCtx);
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
    opts?: { forceNew?: boolean },
  ): Promise<SessionRecord> {
    const key = this.sessionKey(scope, peerId);
    const wantCwd = this.config.cwd || process.cwd();
    const prevCfg = this.modelResolver.getSessionCfg(key);

    // ── cwd 指纹校验(2026-09-08, 响应上游 issue #43: cwd 改了要能换会话) ──
    // 背景: sessionId 由 sessionKey 确定性派生, 与 cwd 无关 → 改 cwd 后 resume 仍命中旧 cwd 会话。
    // ⚠️ 只比 cwd 不比 preset: preset 有热更新通道(dock 人格编辑器保存即热更), 改 preset 不应扔会话历史。
    // 变更处理:
    //   ① 活跃会话在内存 → fork 继承历史 + 新 cwd 建新档(对话无缝迁移, 旧档存档可回看)= 热迁移
    //   ② 无活跃会话(重启后首条消息)→ 无法 fork 旧会话(不在内存), 清记录走 create 用新 cwd(旧文件保留可回看)
    if (prevCfg && (prevCfg.cwd ?? '') !== wantCwd) {
      const active = this.sessions.get(key);
      if (active) {
        this.logger.info(`getOrCreate: cwd 已变更, fork 热迁移(继承历史): key=${key} old=${prevCfg.cwd ?? '(未记录)'} new=${wantCwd}`);
        // forkCurrentSession 内部用 this.config.cwd(新值)建子会话并继承历史 seed;
        // fork 后 active 记录的 sessionId/agent 已被替换为新档, 直接补 target 返回即可。
        await this.forkCurrentSession(key, active, this.modelResolver.getEffectiveRoute(key, active.sessionId), true);
        active.replyTarget = replyTarget;
        active.lastActivity = Date.now();
        return active;
      }
      this.logger.info(`getOrCreate: cwd 已变更且无活跃会话, 弃旧开新: key=${key} old=${prevCfg.cwd ?? '(未记录)'} new=${wantCwd}(旧会话文件保留)`);
      this.modelResolver.clearSessionId(key);
      this.modelResolver.clearSessionCfg(key);
    }

    const existing = this.sessions.get(key);
    if (existing) {
      existing.replyTarget = replyTarget;
      existing.lastActivity = Date.now();
      // 会话已存在且配置一致 → 指纹刷新为当前值(防止误判)
      try { this.modelResolver.setSessionCfg(key, { cwd: wantCwd }); } catch { /* ignore */ }
      // 2026-09-11 主人定「触发会话时反归档」: 这条消息把该会话激活了 → 顺带把它从归档里拉回可见。
      // (主人主动归档的会话保持归档, 只有真的被消息用到才回来; 幂等 + fail-soft, 不阻塞主链)
      void unarchiveSession(this.ctx, existing.sessionId, this.logger);
      return existing;
    }

    // 2026-09-11 主人反馈「炸了的会话在 QQ 上没法弃号重开」: 磁盘会话损坏(历史加载失败)时
    // resume 必失败, 且 sessionId 是 sessionKey 确定性派生的(重试还是同一个坏档)。
    // forceNew → 先把本 peer 的 sessionId 轮换成全新随机 id(断开坏档, 旧档文件原样保留),
    // 后面走标准创建链: resume 命中不到 → 落到 create, 得到干净新档; 下次入站也 resume 新档。
    if (opts?.forceNew) {
      const rotated = SessionId(randomUUID());
      try { this.modelResolver.setSessionId(key, rotated); } catch { /* ignore */ }
      try { this.modelResolver.setSessionCfg(key, { cwd: wantCwd }); } catch { /* ignore */ }
      this.logger.info(`getOrCreate(forceNew): 弃档重开 key=${key} new=${rotated}`);
    }

    // 2026-09-11: 先定 sessionId, 再按「会话级」查模型路由 —— 新会话(sessionId 无 override)回落全局默认
    const sessionId = SessionId(this.currentSessionId(key));
    const route = this.modelResolver.getEffectiveRoute(key, sessionId);
    this.logger.info(`getOrCreate: key=${key} route=${route ? `${route.provider}/${route.model}` : 'host-default'} sessionId=${sessionId}`);

    let agent: DshAgent;
    let handle: DshAgentHandle | undefined;
    let agentPreset: string | undefined;

    const live = this.agents.get(sessionId);
    if (live) {
      agent = live;
      this.logger.info(`reusing live agent: key=${key}`);
      // 2026-09-11 主人反馈修正: 「web 上改了模型, 重启后不应回退」。
      // live agent 通常带宿主/ web 设置的模型(会话持久化恢复) → **无 QQ override 时尊重它**,
      // 避免 QQ 默认路由(官方)把 web 设置覆盖回退。
      // 仅当 QQ 侧 /bot-model 明确设过 override 时, 才用 QQ 设置覆盖(QQ 优先, 双向持久)。
      if (this.modelResolver.hasOverride(key, sessionId)) {
        this.applyModelRoute(agent, route, 'live-override');
      }
    } else {
      // preset 只解析一次：resume/create 共用同一组合(会话覆盖 > config), 避免重复 resolve/mount 目录
      const composed = await this.composePreset(this.effectivePreset(key));
      agentPreset = composed.agentPreset;
      try {
        const resumeRoute = this.modelResolver.getResumeRoute(key, sessionId);
        const resumed = await this.agents.resume({
          resumeSessionId: sessionId,
          ...(resumeRoute ? { agentOptions: resumeRoute } : {}),
          ...(composed.setup ? { setup: composed.setup } : {}),
        });
        agent = resumed.agent;
        handle = resumed;
        this.logger.info(`resumed session: key=${key} preset=${agentPreset ?? 'none'} route=${resumeRoute ? `${resumeRoute.provider}/${resumeRoute.model}` : 'session-own'}`);
        // 更新配置指纹(会话已存在且配置一致 → 指纹刷新为当前值)
        try { this.modelResolver.setSessionCfg(key, { cwd: wantCwd }); } catch { /* ignore */ }
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
        // 记录配置指纹(create 用当前 cwd/preset; 下次配置变更据此弃旧开新)
        try { this.modelResolver.setSessionCfg(key, { cwd: wantCwd }); } catch { /* ignore */ }
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
   * 2026-09-11: 把 QQ 侧 override 路由应用到 agent.options。
   * 仅当 QQ 侧 /bot-model 明确设过 override 时调用(QQ 设置优先, 持久生效);
   * 无 override 时**不覆盖** —— 尊重宿主/ web 设置的模型(重启后不回退)。
   */
  private applyModelRoute(agent: DshAgent, route: ModelRoute | undefined, label: string): void {
    if (!route) return;
    const liveOpts = (agent as unknown as { options?: { provider?: string; model?: string } }).options;
    if (!liveOpts) return;
    if (liveOpts.provider !== route.provider || liveOpts.model !== route.model) {
      (agent as unknown as { options: { provider: string; model: string } }).options = {
        ...liveOpts,
        provider: route.provider,
        model: route.model,
      };
      this.logger.info(`getOrCreate: ${label} 模型覆盖 ${liveOpts.provider}/${liveOpts.model} -> ${route.provider}/${route.model}`);
    }
  }

  /**
   * 通道工具自愈 + 固化(2026-09-05 升级): 每次消息都全量幂等注册 channel-tools(静态 import,
   * 进程加载的就是最新 dist) → 重启后"恢复"会话的第一条消息也会自动把 reply_gate 等正式工具
   * 全部注册上,**工具永久固化, 重启不再需要 /tools-reload**(热刷只留给进程内"新增"工具的即时生效)。
   * 已注册工具重复注册会被 channel-tools 内部静默跳过(already registered), 无副作用无噪音。
   */
  async ensureChannelTools(record: SessionRecord): Promise<void> {
    if (!this.channelSender) return;
    const agentCtx = (((record.agent as { ctx?: Context } | undefined)?.ctx ?? record.agentCtx) as Context | undefined);
    if (!agentCtx) {
      diagSm('ensureChannelTools: 跳过(无 agentCtx, setup 未执行到)');
      return;
    }
    try {
      await mountChannelTools(agentCtx);
      (agentCtx as unknown as { [k: symbol]: unknown })[CTX_TOOLS_READY] = true;
      record.channelToolsReady = true;
      diagSm('ensureChannelTools: 全量幂等注册完成');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn?.(`im-qqbot: 工具自愈注册失败: ${msg}`);
      diagSm(`ensureChannelTools: 失败 ${msg}`);
    }
  }

  /**
   * 工具热刷新(2026-09-05, 主人定 A 方案): cache-bust 动态重载最新 dist 的 channel-tools
   * 并注册到给定 agentCtx。DSH 工具表每步现收集 → 新工具**下一轮立即对 LLM 可见**, 无需重启宿主。
   * 说明: 新增工具即时生效; 与已有工具同名的注册会被 channel-tools 内部 try/catch 跳过(保留旧实现),
   *       想更新已有工具逻辑仍需正式重启(或临时换新工具名)。
   */
  /**
   * qqChannel 上下文自愈(2026-09-05): 重启后"恢复"的会话不跑 setup → agent.ctx 上没有
   * qqChannel → 通道工具路由不到本实例(channelOf 失败 → 图库/定时落到别的实例或 C 盘幽灵库)。
   * 每次消息补一次 provide(幂等: 已是本实例就跳过)。用 record.agent.ctx(恒有)。
   */
  async ensureChannelContext(record: SessionRecord): Promise<void> {
    try {
      const agentCtx = (record.agent as { ctx?: Context } | undefined)?.ctx ?? record.agentCtx;
      if (!agentCtx || !this.channelSender) return;
      const anyCtx = agentCtx as unknown as {
        get?: (n: string) => unknown;
        provide?: (n: string, v: unknown) => unknown;
      };
      const existing = anyCtx.get?.('qqChannel') as { manager?: unknown } | undefined;
      if (existing && existing.manager === this) return; // 已是本实例
      anyCtx.provide?.('qqChannel', { manager: this, sender: this.channelSender });
      this.logger.info('im-qqbot: qqChannel 上下文自愈 provide(本实例)');
      diagSm('ensureChannelContext: provide qqChannel(本实例)');
    } catch (err) {
      diagSm(`ensureChannelContext: 失败 ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async hotReloadChannelTools(agentCtx: Context): Promise<void> {
    const url = new URL('../channel-tools.js', import.meta.url);
    url.searchParams.set('hot', String(Date.now())); // 绕 ESM 模块缓存
    const mod = (await import(url.href)) as { apply?: (c: Context) => unknown };
    const applyFn = (mod.apply ?? mountChannelTools) as (c: Context) => unknown;
    await applyFn(agentCtx);
    this.logger.info('im-qqbot: 通道工具热刷新完成(新工具已注册到 agentCtx)');
    diagSm('hotReloadChannelTools: 完成');
  }

  /** 对所有活会话的 agentCtx 执行一次工具热刷新。返回给人看的摘要文本。 */
  async reloadAllChannelTools(): Promise<string> {
    const seen = new Set<Context>();
    const targets: Context[] = [];
    for (const rec of this.sessions.values()) {
      const agentCtx = ((rec.agent as { ctx?: Context } | undefined)?.ctx ?? rec.agentCtx) as Context | undefined;
      if (agentCtx && !seen.has(agentCtx)) {
        seen.add(agentCtx);
        targets.push(agentCtx);
      }
    }
    if (targets.length === 0) {
      return '当前没有活动会话可热刷(先随便发条消息让会话跑起来, 再试 /tools-reload)';
    }
    let ok = 0; let fail = 0;
    for (const c of targets) {
      try {
        await this.hotReloadChannelTools(c);
        ok++;
      } catch (err) {
        fail++;
        this.logger.warn?.(`im-qqbot: 热刷新失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return `✅ 工具热刷新完成: ${ok} 个会话成功${fail > 0 ? `, ${fail} 个失败(见日志)` : ''}。新工具下一条消息即可用。`;
  }

  /** cwd 分流(通用, 不写死实例名): 只对本实例配置的 cwd 匹配的 agent 注入本实例群守则。
   *  每个实例在 patch 里配自己的 cwd + settingsNs, 即自动分流;
   *  其他实例/项目(web、别的 cwd)的 agent 一律不注入, 避免群守则污染非本 bot 会话。 */
  private nsForCwd(cwd: string): string {
    const selfCwd = String(this.config.cwd ?? '').trim().replace(/[\\/]+$/, '');
    const ns = String(this.config.settingsNs ?? '').trim() || 'im-qqbot';
    if (!selfCwd) return ns; // 未配 cwd → 对本实例所有 agent 注入(保守)
    const norm = String(cwd ?? '').replace(/[\\/]+$/, '');
    if (norm === selfCwd || norm.startsWith(selfCwd + '\\') || norm.startsWith(selfCwd + '/')) return ns;
    return '';
  }

  /** 群守则热更新: 现读 settings.yaml 对应 ns 的 groupPrompt; 读失败仅回退本实例 ns 的内存 config。 */
  private readLiveGroupPromptForNs(ns: string): string {
    try {
      const reader = (this.liveSettingsReader ??= new SettingsReader());
      const gp = reader.readGroupPrompt(ns, true);
      if (gp) return gp;
    } catch { /* 读失败回退内存 */ }
    const selfNs = String(this.config.settingsNs ?? '').trim() || 'im-qqbot';
    return ns === selfNs ? (this.config.groupPrompt?.trim() || '') : '';
  }

  /**
   * 群守则/固定规则 pre-step 直注(幂等): 每次消息入站调用, 全局只装一次注入器。
   *
   * 2026-09-11 考古定稿(参考 deepseek-harness/packages/context/agent-instructions):
   *  - dsh 0.1.5 的 persona 是 complete section → assemble 只保留 persona,
   *    运行时注册的 section 全被丢弃(system/message 只有人设, 实证);
   *  - context() 快照链路(assemble → RuntimeContextProjection.project)实际不记录;
   *  - 官方 agent-instructions 用 ctx.on('agent/pre-step') 把带来源 user/message
   *    折入 decision.messages(紧随 claimed batch 之后) → 直接进模型请求, 绕开 assemble。
   *
   * 本实现:
   *  - 宿主根 ctx 监听 agent/pre-step; cwd 分流(只对本实例 config.cwd 匹配的 agent 注入本实例群守则);
   *  - 每回合现读 settings.yaml(热更新); 固定通道规则 + 群守则 拼成一条 <system-reminder> user/message;
   *  - 去重靠 KV cache: 本次 messages 或会话 surface 已有同 ns+同内容 → 不重复注入;
   *    热更新内容变化 → 注入新版(历史保留旧版, 后续回合靠新版 KV cache)。
   */
  async ensureGroupRules(_record: SessionRecord): Promise<void> {
    const hostCtx = ((this.ctx as unknown as { root?: Context }).root ?? this.ctx) as unknown as {
      on?: (event: string, listener: (...args: unknown[]) => unknown) => void;
    };
    if (!hostCtx?.on || (this as unknown as Record<string, unknown>).__rulesMounted) return;
    (this as unknown as Record<string, unknown>).__rulesMounted = true;
    hostCtx.on('agent/pre-step', async (payload: unknown, next: unknown) => {
      const decision = await (next as () => Promise<unknown>)();
      try {
        const p = payload as {
          agent?: {
            session?: {
              header?: { cwd?: string };
              surface?: { nodes?: number[] };
              eventAt?: (seq: number) => unknown;
            };
          };
          messages?: unknown[];
        };
        const agent = p?.agent;
        const cwd = String(agent?.session?.header?.cwd ?? '');
        const ns = this.nsForCwd(cwd);
        if (!ns) return decision; // 非本 bot agent, 不注入
        const dec = decision as { kind?: string; messages?: unknown[] };
        if (dec?.kind !== 'enter' || !Array.isArray(dec.messages)) return decision;
        const rules = this.readLiveGroupPromptForNs(ns);
        const body = [FIXED_CHANNEL_CONTEXT.trim(), rules.trim()].filter(Boolean).join('\n\n');
        if (!body) return decision;
        const text = `<system-reminder>\n${body}\n</system-reminder>`;
        const desired = {
          role: 'user',
          id: randomUUID(),
          content: [{ type: 'text', text }],
          source: { kind: 'qqbot:group-rules', form: 'instructions', ns },
        };
        // 去重(靠 KV cache): 本次 messages 已含同 ns+同内容 → 不重复
        const inBatch = dec.messages.some((m: unknown) => {
          const mm = m as { source?: { kind?: string; ns?: string }; content?: { type?: string; text?: string }[] };
          return mm?.source?.kind === 'qqbot:group-rules' && mm.source.ns === ns && mm.content?.[0]?.text === text;
        });
        if (!inBatch && agent?.session?.surface?.nodes && agent.session.eventAt) {
          // 会话 surface 历史已有同 ns+同内容 → 靠 KV cache, 不重复注入
          for (const seq of agent.session.surface.nodes) {
            const ev = agent.session.eventAt(seq) as
              | { type?: string; data?: { source?: { kind?: string; ns?: string }; content?: { type?: string; text?: string }[] } }
              | undefined;
            if (ev?.type === 'user/message'
              && ev.data?.source?.kind === 'qqbot:group-rules'
              && ev.data.source.ns === ns
              && ev.data.content?.[0]?.text === text) {
              return decision;
            }
          }
        }
        if (inBatch) return decision;
        const claimed = Array.isArray(p.messages) ? p.messages : [];
        let lastClaimedIndex = -1;
        for (let i = dec.messages.length - 1; i >= 0; i--) {
          if (claimed.includes(dec.messages[i])) { lastClaimedIndex = i; break; }
        }
        const at = Math.max(0, lastClaimedIndex + 1);
        const entered = [...dec.messages.slice(0, at), desired, ...dec.messages.slice(at)];
        return { ...dec, messages: entered };
      } catch {
        return decision;
      }
    });
  }

  findBySessionId(sessionId: string): SessionRecord | undefined {
    for (const record of this.sessions.values()) {
      if (record.sessionId === sessionId) return record;
    }
    return undefined;
  }

  /** 查宿主全局 agent registry(进程内存活 agent, 含 web/hub 等非 QQ 会话): 跨会话唤醒兜底 */
  findHostAgent(sessionId: string): { agent: DshAgent } | undefined {
    try {
      const agent = this.agents.get(sessionId);
      return agent ? { agent } : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 宿主持久化恢复会话(重启后唤起): 进程内无活 agent 时, 用宿主 registry.resume 把
   * 持久化会话拉回内存(与 getOrCreate 的 resume 路径同源)。web/hub 会话也能这样唤起。
   * @returns agent 或 undefined(会话不存在/恢复失败)
   */
  async resumeHostAgent(sessionId: string): Promise<{ agent: DshAgent } | undefined> {
    try {
      const agent = this.agents.get(sessionId);
      if (agent) return { agent };
      const handle = await this.agents.resume({
        resumeSessionId: sessionId,
      }).catch(() => undefined);
      if (!handle) return undefined;
      this.logger.info(`resumeHostAgent: session=${sessionId.slice(0, 8)}… ok`);
      return { agent: handle.agent };
    } catch (err) {
      this.logger.warn?.(`resumeHostAgent: ${sessionId.slice(0, 8)}… ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  /** 列出本 bot 全部活跃会话(通用插件能力: 供 session_list/跨会话唤醒等按 id 寻址) */
  listSessions(): Array<Pick<SessionRecord, 'sessionId' | 'scope' | 'peerId' | 'senderId' | 'lastActivity' | 'agentPreset'>> {
    const out: Array<Pick<SessionRecord, 'sessionId' | 'scope' | 'peerId' | 'senderId' | 'lastActivity' | 'agentPreset'>> = [];
    for (const record of this.sessions.values()) {
      out.push({
        sessionId: record.sessionId,
        scope: record.scope,
        peerId: record.peerId,
        senderId: record.senderId,
        lastActivity: record.lastActivity,
        agentPreset: record.agentPreset,
      });
    }
    return out;
  }

  /** 按 scope+peerId 解析 sessionId(与 getOrCreate 完全一致: 存在则用记录值, 否则确定性派生) */
  sessionIdFor(scope: ChatScope, peerId: string): string {
    const key = this.sessionKey(scope, peerId);
    const rec = this.sessions.get(key);
    if (rec) return rec.sessionId;
    return SessionId(this.currentSessionId(key));
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

  /** 按会话键找活跃会话(group/c2c); 无则 undefined(会话被回收/未建立) */
  findByPeer(scope: ChatScope, peerId: string): SessionRecord | undefined {
    return this.sessions.get(this.sessionKey(scope, peerId));
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
