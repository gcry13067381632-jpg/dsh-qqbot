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

  console.log('[im-qqbot] apply() called');

  // 多账号实例身份: settingsNs 承担"实例 id"(账号页保存时写入, 默认 im-qqbot=主账号)。
  const ns = (config.settingsNs ?? '').trim() || 'im-qqbot';
  const isMain = ns === 'im-qqbot';

  let appId = resolveEnv(config.appId, 'QQBOT_APPID');
  let appSecret = resolveEnv(config.appSecret, 'QQBOT_SECRET');

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

  const resolvedConfig: ImQQBotConfig = { ...config, appId, appSecret };

  // ── Web 可视化设置: 注册 im-qqbot settings 命名空间(可编辑子集, live 生效) ──
  // 用户层存 ~/.dsh/settings.yaml; 变更经 watch 原地覆盖 resolvedConfig 对应字段,
  // 下游消费点(middleware/inbound)每次读取 config → 热生效。settings 服务缺失则跳过(纯 yml 模式)。
  try {
    await installLiveSettings(ctx, resolvedConfig, logger, ns);
  } catch (err) {
    logger.warn?.(`im-qqbot: settings 注册跳过: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 设置面板 host 桥(单包自含, 原 dsh-qqbot-settings 独立包合并而来) ──
  // 桥是标准 cordis 插件(需要 settings/webServer/agentPresets 服务, 仅 web profile 有);
  // 这里用 ctx.plugin 动态装载, 服务缺失时 fail-soft(纯 yml/非 web 环境跳过, 不拖垮插件树)。
  try {
    const bridgeUrl = new URL('../settings-host.js', import.meta.url).href;
    const bridgeMod = (await import(bridgeUrl)) as {
      name?: string; inject?: string[]; apply?: (ctx: Context) => unknown;
    };
    if (bridgeMod && typeof bridgeMod.apply === 'function') {
      ctx.plugin({ name: bridgeMod.name ?? 'qqbot-settings', inject: bridgeMod.inject, apply: bridgeMod.apply });
      logger.info('[im-qqbot] settings host 桥已装载(单包)');
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
    behavior: live.behavior,
    sticker: {
      gates: live.sticker.gates,
      autoTagEnabled: live.sticker.autoTagEnabled,
      visionCli: live.sticker.visionCli,
    },
    injectRules: live.injectRules,
    groupPrompt: live.groupPrompt,
    schedule: live.schedule,
    groupAdmin: live.groupAdmin,
    enableApprovals: live.enableApprovals,
    approvalTimeoutMs: live.approvalTimeoutMs,
    outboundMode: live.outboundMode,
  };
  let source: () => EditableConfig = () => entry;
  const sync = (): void => {
    try {
      const next = source();
      if (!next) return;
      if (next.behavior) live.behavior = next.behavior;
      if (next.sticker) live.sticker = { ...live.sticker, ...next.sticker };
      if (Array.isArray(next.injectRules)) live.injectRules = next.injectRules;
      if (typeof next.groupPrompt === 'string') live.groupPrompt = next.groupPrompt;
      if (next.schedule) live.schedule = next.schedule;
      if (next.groupAdmin) live.groupAdmin = next.groupAdmin;
      if (typeof next.enableApprovals === 'boolean') live.enableApprovals = next.enableApprovals;
      if (typeof next.approvalTimeoutMs === 'number') live.approvalTimeoutMs = next.approvalTimeoutMs;
      if (next.outboundMode === 'active' || next.outboundMode === 'passive') live.outboundMode = next.outboundMode;
      logger.info('[im-qqbot] 设置已同步(live): behavior/sticker/injectRules/groupPrompt/schedule/groupAdmin/approvals');
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
}

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
