/**
 * dsh-im-qqbot — QQ Bot IM channel plugin for deepseek-harness
 *
 * Cordis 插件入口。将 QQ 消息平台作为 dsh 的前端协议驱动。
 * 网关组装（中间件编排 + 事件 + 出站 + 生命周期）见 src/gateway/。
 */
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, EditableConfigSchema, type EditableConfig, type ImQQBotConfig } from './config.js';
import { bootstrapGateway } from './gateway/index.js';
import type { DshAgentRegistry } from './session/index.js';
import { getProfileDir, resolveEnv } from './shared/index.js';
import { runQrSetup, persistCredentialsToProfile } from './setup.js';
import type { Logger } from './types.js';
import { setOutboundModeWriter } from './features/outbound-mode-switch.js';

// ⚠️ @deepseek-ai/dsh-settings 的"注册 Web 可视化设置"入口在 harness 各版本间有差异：
//   - rc.2 及更早：模块顶层具名导出 installSettingsSection(ctx, ns, schema, entry, hooks)
//   - alpha / 0.1.2 线：改为 ctx.settings 服务，方法 installSection(ctx, ns, schema, entry, hooks)
// 直接 `import { installSettingsSection } from '@deepseek-ai/dsh-settings'` 是"静态具名导入"，
// 一旦运行库没有该具名导出，模块一加载就抛 SyntaxError，会拖垮整棵插件树（dsh 都起不来）。
// 因此这里不静态导入，而在运行时动态探测两条路径，缺一条也能优雅降级（见 installLiveSettings）。

// ── Cordis 插件元数据 ──
export const name = 'im-qqbot';
export const inject = ['agents'];
export const Config = ConfigSchema;

export type { ImQQBotConfig } from './config.js';

// ── 插件主体 ──
export async function apply(ctx: Context, config: ImQQBotConfig): Promise<void> {
  const agents = (ctx as unknown as Record<string, unknown>).agents as DshAgentRegistry;
  const logger: Logger = ((ctx as unknown as Record<string, unknown>).logger as Logger) ?? console;



  // 多账号实例身份: settingsNs 承担"实例 id"(账号页保存时写入, 默认 im-qqbot=主账号)。
  const ns = (config.settingsNs ?? '').trim() || 'im-qqbot';
  const isMain = ns === 'im-qqbot';

  // ── 账号实例化: appId/appSecret/cwd/preset 都做 env 兜底(2026-09-08, 响应上游 issue #43) ──
  // 背景: cordis.patch.yml 的 im-qqbot config 里 cwd/preset 可能未被 dsh 框架完整传入 apply()
  // (上游 tencent-connect/dsh-qqbot issue #43), appId/appSecret 靠 QQBOT_APPID/SECRET 兜底才"看似正常"。
  // 这里给 cwd/preset 同样提供 env 兜底: 优先 patch 传入值 → 环境变量 → 留空(走进程 cwd/全局默认)。
  // ⚠️ 不做硬编码默认(上游用户在 dist 里写死 /mnt/... 不可移植), env 兜底通用且可覆盖。
  let appId = resolveEnv(config.appId, 'QQBOT_APPID');
  let appSecret = resolveEnv(config.appSecret, 'QQBOT_SECRET');
  const cwdOverride = resolveEnv(config.cwd ?? '', 'QQBOT_CWD') || undefined;
  const presetOverride = resolveEnv(config.preset ?? '', 'QQBOT_PRESET') || undefined;

  // ── 凭据缺失 ──
  if (!appId || !appSecret) {
    // 非主实例: 绝不触发扫码/env 覆写(防把凭据写进主账号或污染全局 env)——
    // 去 Web「账号与预设」用"扫码绑定"或手动填好 appId/appSecret 后保存, 重启生效。
    if (!isMain) {
      logger.error(`实例 ${ns}: 未配置 appId/appSecret——请在 Web「账号与预设」为该账号完成扫码绑定或填写凭据后保存(重启生效), 本实例本次不启动。`);
      return;
    }
    logger.info('凭据未配置，尝试扫码绑定...');
    const credentials = await runQrSetup();

    if (!credentials) {
      logger.error('无法获取 QQ Bot 凭据，插件未启动');
      return;
    }

    // 写入环境变量（供热更新后的下次 apply 或本次直接启动读取）
    process.env.QQBOT_APPID = credentials.appId;
    process.env.QQBOT_SECRET = credentials.appSecret;
    appId = credentials.appId;
    appSecret = credentials.appSecret;

    // 持久化到 profile：成功则等待热更新重载，失败则用 env 凭据直接启动
    const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
    if (persisted) {
      // 写入 cordis.patch.yml 会触发 dsh 热更新，自动重新加载本插件。
      // 直接返回，避免与热更新产生竞态。
      logger.info('配置已保存，等待热更新重新加载...');
      return;
    }
    logger.warn('凭据未能持久化，本次进程将使用环境变量凭据启动（重启后需重新绑定）');
  }

  const resolvedConfig: ImQQBotConfig = {
    ...config,
    appId,
    appSecret,
    // cwd/preset: patch 值优先, env 兜底(QQBOT_CWD / QQBOT_PRESET), 都没有则留原值(进程 cwd/全局默认)
    ...(cwdOverride ? { cwd: cwdOverride } : {}),
    ...(presetOverride ? { preset: presetOverride } : {}),
  };

  // ── Web 可视化设置: 注册 im-qqbot settings 命名空间(可编辑子集, live 生效) ──
  // 用户层存 ~/.dsh/settings.yaml; 变更经 watch 原地覆盖 resolvedConfig 对应字段,
  // 下游消费点(middleware/inbound)每次读取 config → 热生效。settings 服务缺失则跳过(纯 yml 模式)。
  try {
    await installLiveSettings(ctx, resolvedConfig, logger, ns);
  } catch (err) {
    logger.warn?.(`im-qqbot: settings 注册跳过: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 设置面板 host 桥(单包自含, 原 dsh-qqbot-settings 独立包合并而来) ──
  // ⚠️ 2026-09-10 关键修复: 原用 ctx.plugin({name, inject, apply}) 装载 —— 在 dsh 环境下
  //    桥的 apply 从未被调用(实测 ~/.dsh/qqbot-bridge-diag.log 不生成, 所有
  //    /api/qqbot-settings/* 全 404, 前端设置页报 "not found" is not valid JSON)。
  //    原因: cordis Service 必须声明式注入(同 2026-09-04 那次 ctx.settings 直读拿不到的坑),
  //    改为 dsh 官方姿势 ctx.inject(deps, cb) —— 官方样板 dsh-bash-local / dsh-agent-default-model
  //    均写作 ctx.inject(["settings"], (settingsCtx) => {...})。
  //    agentPresets 不再作为等待依赖(桥内对该服务已有判空降级), 避免宿主未提供时永久不 apply。
  try {
    const bridgeUrl = new URL('../settings-host.js', import.meta.url).href;
    const bridgeMod = (await import(bridgeUrl)) as {
      name?: string; inject?: string[]; apply?: (ctx: Context) => unknown;
    };
    if (bridgeMod && typeof bridgeMod.apply === 'function') {
      const declared = Array.isArray(bridgeMod.inject) ? bridgeMod.inject : [];
      const required = declared.filter((s) => s !== 'agentPresets');
      const deps = required.length > 0 ? required : ['settings', 'webServer'];
      ctx.inject(deps, (serverCtx: Context) => {
        try {
          bridgeMod.apply!(serverCtx);
          logger.info(`[im-qqbot] settings host 桥已 apply(ctx.inject ${deps.join('+')})`);
        } catch (err) {
          logger.warn?.(`im-qqbot: settings host 桥 apply 异常: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      logger.info(`[im-qqbot] settings host 桥已装载(ctx.inject 姿势, deps=${deps.join('+')})`);
    } else {
      logger.warn('[im-qqbot] settings-host.js 缺少 apply, 桥跳过');
    }
  } catch (err) {
    logger.warn?.(`im-qqbot: settings host 桥装载跳过: ${err instanceof Error ? err.message : String(err)}`);
  }

  await bootstrapGateway(ctx, agents, resolvedConfig, logger);
}

/** 把 settings 用户层合并进 live 运行时配置(原地字段替换; schema 解析值含默认, 可整体覆盖) */
async function installLiveSettings(ctx: Context, live: ImQQBotConfig, logger: Logger, nsOverride?: string): Promise<void> {
  const ns = nsOverride || (live.settingsNs ?? '').trim() || 'im-qqbot';
  const entry: EditableConfig = {
    dataRoot: live.dataRoot,
    behavior: live.behavior,
    sticker: {
      gates: live.sticker.gates,
      autoTagEnabled: live.sticker.autoTagEnabled,
      visionCli: live.sticker.visionCli,
    },
    injectRules: live.injectRules,
    imageHint: live.imageHint,
    // ⚠️ 2026-09-13 补(主人实测: "面板把评分模式改成 block 了, 但记录里 gate 还是 log"):
    //   本地小模型这块**原来没进 live 同步** → 面板/设置页保存后要重启宿主才生效。
    //   功效: 价值评分模式(off/log/block)、门槛、单会话 overrides 现在改完即时生效。
    localModel: live.localModel,
    groupPrompt: live.groupPrompt,
    schedule: live.schedule,
    groupAdmin: live.groupAdmin,
    enableApprovals: live.enableApprovals,
    approvalTimeoutMs: live.approvalTimeoutMs,
    outboundMode: live.outboundMode,
    botplayEvents: Array.isArray(live.botplayEvents) ? live.botplayEvents : [],
  };
  let source: () => EditableConfig = () => entry;
  const sync = (): void => {
    try {
      const next = source();
      if (!next) return;
      if (next.behavior) live.behavior = next.behavior;
      if (next.sticker) live.sticker = { ...live.sticker, ...next.sticker };
      if (typeof next.dataRoot === 'string') live.dataRoot = next.dataRoot; // 数据根(重启后 bootstrap 迁移/落盘用它)
      if (Array.isArray(next.injectRules)) live.injectRules = next.injectRules;
      if (typeof next.imageHint === 'boolean') live.imageHint = next.imageHint;
      // 本地小模型: 整块替换(面板发的是完整对象; overrides 也在里面) —— 改了就地生效, 不用重启
      if (next.localModel && typeof next.localModel === 'object') live.localModel = next.localModel;
      if (typeof next.groupPrompt === 'string') live.groupPrompt = next.groupPrompt;
      if (next.schedule) live.schedule = next.schedule;
      if (next.groupAdmin) live.groupAdmin = next.groupAdmin;
      if (typeof next.enableApprovals === 'boolean') live.enableApprovals = next.enableApprovals;
      if (typeof next.approvalTimeoutMs === 'number') live.approvalTimeoutMs = next.approvalTimeoutMs;
      // 出站模式: adaptive=适配主动(默认; active 旧值归一 adaptive); detail=详细主动(adaptive + 工具调用/结果推送); passive=全被动; silent=不出站; nothink=不思考(仅设置页)
      if (next.outboundMode === 'adaptive' || next.outboundMode === 'detail' || next.outboundMode === 'passive' || next.outboundMode === 'silent' || next.outboundMode === 'nothink') live.outboundMode = next.outboundMode;
      else if (next.outboundMode === 'active') live.outboundMode = 'adaptive';
      // botplay 事件: 真相源已迁到 {dataRoot}/botplay-events.json(2026-09-10 M4.3);
      // ⚠️ 仅当 settings 提供了**非空**数组时才覆盖 live, 否则空数组会把文件装载的事件清掉
      //    (实测症状: dock 保存后 /botplay 报"还没有装配任何互动事件")。
      if (Array.isArray(next.botplayEvents) && next.botplayEvents.length > 0) live.botplayEvents = next.botplayEvents;
      logger.info('[im-qqbot] 设置已同步(live): dataRoot/behavior/sticker/injectRules/localModel/groupPrompt/schedule/groupAdmin/approvals/botplayEvents');
    } catch (err) {
      logger.warn?.(`im-qqbot: 设置同步失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const hooks = {
    setSource: (s: () => EditableConfig): void => { source = s; sync(); },
    onChange: (): void => sync(),
  };
  const installed = await registerSettingsSection(ctx, ns, EditableConfigSchema, entry, hooks, logger);
  if (installed) {
    logger.info(`[im-qqbot:${ns}] settings 命名空间已注册 (${ns})`);
  }

  // 出站模式切换 writer(2026-09-07; 2026-09-11 多实例修复): 命令/工具调 switchOutboundMode → 这里执行
  // ①live.outboundMode 原地改(与 bootstrap/router 同引用, 立即热生效);
  // ②尽力经 settings 服务 update 持久化 —— dock/设置面板与 live 同一数据源, 三方一致(重启不丢)。
  // ⚠️ 按 ns 注册: 多实例(多个实例)各自 apply 时不能共用一个 writer,
  //    否则切换会落到最后注册的那个实例(config 改错对象, dock 显示与实测不符)。修复于 2026-09-11。
  setOutboundModeWriter(ns, async (mode) => {
    live.outboundMode = mode;
    const svc = getSettingsService();
    if (svc && typeof (svc as { update?: unknown }).update === 'function') {
      try {
        await (svc as { update: (ns: string, patch: unknown, rev?: unknown) => Promise<unknown> }).update(ns, { outboundMode: mode });
      } catch (err) {
        logger.warn?.(`im-qqbot: 出站模式已热更新(live), 但 settings 持久化失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { ok: true, msg: '已切换: ' + mode, mode };
  });
}

/** settings 服务引用(registerSettingsSection 注入时保存; 无 settings 服务时为 undefined) */
let _settingsSvc: unknown;
function captureSettingsService(svc: unknown): void { _settingsSvc = svc; }
export function getSettingsService(): unknown { return _settingsSvc; }

/**
 * 版本自适应注册。两条路径语义等价：
 *   1) 新版(alpha / dsh-settings 0.1.2 线): ctx.inject(['settings'], sc => sc.settings.installSection(ctx, ns, schema, entry, hooks))
 *      —— 官方样板(dsh-bash-local 等): 服务经 cordis 声明式注入, 直读 ctx.settings / ctx.get 拿不到!
 *   2) 旧版(rc.2): @deepseek-ai/dsh-settings 的 installSettingsSection(ctx, ns, schema, entry, hooks)
 * 优先新版(harness 自带服务)；旧版包在时兜底；都不可用则返回 false(纯 yml 模式, 不中断插件)。
 */
async function registerSettingsSection(
  ctx: Context,
  ns: string,
  schema: unknown,
  entry: unknown,
  hooks: unknown,
  logger: Logger,
): Promise<boolean> {
  // 1) 新版: ctx.inject(['settings'], …) 声明式注入(官方用法)
  const injectable = ctx as unknown as { inject?: (names: string[], cb: (sc: unknown) => void) => void };
  if (typeof injectable.inject === 'function') {
    try {
      injectable.inject(['settings'], (settingsCtx) => {
        try {
          const svc = (settingsCtx as { settings?: { installSection?: (...args: unknown[]) => unknown } }).settings;
          if (svc && typeof svc.installSection === 'function') {
            captureSettingsService(svc);
            svc.installSection(ctx, ns, schema, entry, hooks);
            logger.info(`[im-qqbot:${ns}] settings 命名空间已注册 (${ns})`);
            return;
          }
        } catch (err) {
          logger.warn?.(`im-qqbot: settings 注入注册失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        void legacyRegister(ctx, ns, schema, entry, hooks, logger);
      });
      // inject 回调若为同步执行且已尝试, 视为已处理; 无法探测是否成功, 交由回调日志确认。
      return true;
    } catch { /* inject 不可用则走下方 legacy */ }
  }
  return legacyRegister(ctx, ns, schema, entry, hooks, logger);
}

/** 旧版 @deepseek-ai/dsh-settings 具名导出(运行时动态探测, 避免静态导入拖垮启动) */
async function legacyRegister(ctx: Context, ns: string, schema: unknown, entry: unknown, hooks: unknown, logger: Logger): Promise<boolean> {
  try {
    const mod = (await import('@deepseek-ai/dsh-settings')) as {
      installSettingsSection?: (...args: unknown[]) => unknown;
      settingsNamespace?: (value: string) => unknown;
    };
    if (typeof mod.installSettingsSection === 'function') {
      const brandedNs = typeof mod.settingsNamespace === 'function' ? mod.settingsNamespace(ns) : ns;
      mod.installSettingsSection(ctx, brandedNs, schema, entry, hooks);
      logger.info(`[im-qqbot:${ns}] settings 命名空间已注册(legacy) (${String(brandedNs)})`);
      return true;
    }
  } catch (err) {
    logger.warn?.(`im-qqbot: 旧版 dsh-settings 探测失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  logger.warn?.('im-qqbot: 当前 harness 未暴露可用的 settings 注册 API，跳过可视化设置(仍可用纯 yml/补丁配置)。');
  return false;
}

