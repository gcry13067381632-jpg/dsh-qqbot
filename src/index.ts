/**
 * dsh-im-qqbot — QQ Bot IM channel plugin for deepseek-harness
 *
 * Cordis 插件入口。将 QQ 消息平台作为 dsh 的前端协议驱动。
 * 网关组装（中间件编排 + 事件 + 出站 + 生命周期）见 src/gateway/。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, EditableConfigSchema, type EditableConfig, type ImQQBotConfig } from './config.js';
import { bootstrapGateway } from './gateway/index.js';
import { takePendingMemoText } from './features/people-memo.js';
import type { DshAgentRegistry } from './session/index.js';
import { getProfileDir, resolveEnv } from './shared/index.js';
void getProfileDir;
import { runQrSetup, persistCredentialsToProfile } from './setup.js';

// 2026-09-24 关闭"启动自动扫码"后，这些符号保留给设置页路径使用；此处显式引用避免 TS 未使用报错。
void runQrSetup; void persistCredentialsToProfile;
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
// ⚠️ 2026-09-13(主人验到注入没生效才发现): 用 ctx.systemPrompt.context() 注册运行时上下文贡献**必须**在此声明依赖,
//    否则 ctx.systemPrompt 拿不到 → 注册会走“宿主未提供”兜底, 小传注入等于没接上。
export const inject = ['agents', 'systemPrompt'];
export const Config = ConfigSchema;

export type { ImQQBotConfig } from './config.js';

// ── 插件主体 ──
export async function apply(ctx: Context, config: ImQQBotConfig): Promise<void> {
  const agents = (ctx as unknown as Record<string, unknown>).agents as DshAgentRegistry;
  const logger: Logger = ((ctx as unknown as Record<string, unknown>).logger as Logger) ?? console;

  // __INSTALL_SELFCHECK__ 安装完整性自检（2026-09-28）
  //   entry.js（包入口）已拦住"缺 dist"；这里补查"import 成功但功能不全"
  //   （缺前端 / 缺配置桥 / 缺 patch —— 常见于"从 GitHub 直装但没跑构建"）。
  try {
    const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');   // → .../dist/
    const pkgRoot = here.replace(/[\\/]dist[\\/]?$/, '');
    const expect = ['client/qqbot-settings.js', 'settings-host.js', 'cordis.patch.yml'];
    const miss = expect.filter((r) => !existsSync(pkgRoot + '/' + r));
    if (miss.length > 0) {
      logger.warn('');
      logger.warn('  ⚠️  dsh-qqbot 安装不完整：缺少 ' + miss.join(', '));
      logger.warn('      插件主功能可用，但设置面板 / 配置桥可能不工作。');
      logger.warn('      建议改用 npm 发布版安装（自带全部文件，无需构建）：');
      logger.warn('        pnpm add @zaofan/dsh-qqbot');
      logger.warn('      （安装目录: ' + pkgRoot + '）');
      logger.warn('');
    }
  } catch { /* 自检失败不影响启动 */ }



  // 多账号实例身份: settingsNs 承担"实例 id"(账号页保存时写入, 默认 im-qqbot=主账号)。
  const ns = (config.settingsNs ?? '').trim() || 'im-qqbot';
  const isMain = ns === 'im-qqbot';
  void isMain;

  // ── 账号实例化: appId/appSecret/cwd/preset 都做 env 兜底(2026-09-08, 响应上游 issue #43) ──
  // 背景: cordis.patch.yml 的 im-qqbot config 里 cwd/preset 可能未被 dsh 框架完整传入 apply()
  // (上游 tencent-connect/dsh-qqbot issue #43), appId/appSecret 靠 QQBOT_APPID/SECRET 兜底才"看似正常"。
  // 这里给 cwd/preset 同样提供 env 兜底: 优先 patch 传入值 → 环境变量 → 留空(走进程 cwd/全局默认)。
  // ⚠️ 不做硬编码默认(上游用户在 dist 里写死 /mnt/... 不可移植), env 兜底通用且可覆盖。
  let appId = resolveEnv(config.appId, 'QQBOT_APPID');
  let appSecret = resolveEnv(config.appSecret, 'QQBOT_SECRET');
  const cwdOverride = resolveEnv(config.cwd ?? '', 'QQBOT_CWD') || undefined;
  const presetOverride = resolveEnv(config.preset ?? '', 'QQBOT_PRESET') || undefined;

  // ── 凭据检查（⚠️ 2026-09-28 重要改动：不再"缺凭据就整个 return"）──
  //   原来缺凭据直接 return，会连带跳过【设置面板 host 桥】的装载，后果是新用户装完插件打开 dsh：
  //     · /api/qqbot-settings/* 全部 404
  //     · 前端 entry 激活失败 → 页面报 "1 entry did not activate"
  //     · 根本走不到「扫码绑定」—— 连填凭据的界面都打不开。
  //   现在改为：**设置面板照常装载**（settings + host 桥），只把【网关启动】留到凭据检查之后。
  //   新用户路径：装插件 → 打开 dsh → 设置页「QQ 机器人」→ 填 AppID/Secret 或点「扫码绑定」
  //   → 凭据写入 → 热更新 → 本次 apply 有凭据 → 自动连上。
  //   仍然**不自动弹二维码**（保持 2026-09-24 的死循环修复：扫码只在用户主动点击时发生）。
  const hasCred = !!appId && !!appSecret;
  if (!hasCred) {
    // ⚠️ 2026-09-24 主人要求：**启动时不再自动弹二维码**。
    //    原因：自动扫码会 persistCredentialsToProfile() 写 profile patch → 触发 dsh 热更新
    //    → 插件重新 apply → 凭据仍缺失 → 再扫码，形成死循环（实测把宿主启动刷死）。
    //    现在一律只提示；需要扫码时去 Web「账号与预设」点「扫码绑定」（那条路径是交互式的，不会自转）。
    logger.warn(`实例 ${ns}: 尚未配置 appId/appSecret —— 机器人暂不连接 QQ，但设置面板已就绪。`);
    logger.warn('  · 请在 dsh 设置页「QQ 机器人」里填写 AppID/AppSecret，或点「扫码绑定」；');
    logger.warn('  · 凭据保存后会热生效，本实例自动连接（无需重启）。');
  }

  const resolvedConfig: ImQQBotConfig = {
    ...config,
    appId,
    appSecret,
    // cwd/preset: patch 值优先, env 兜底(QQBOT_CWD / QQBOT_PRESET), 都没有则留原值(进程 cwd/全局默认)
    ...(cwdOverride ? { cwd: cwdOverride } : {}),
    ...(presetOverride ? { preset: presetOverride } : {}),
  };

  // ── 插件自有设置存储（2026-09-24）──
  // 设置页保存**不再写 profile 的 cordis.patch.yml**：写 patch 会被宿主当热更新提交 →
  // 插件重新 apply → 凭据无效时再写 → 自反馈闭环（实测把 dsh 启动刷死、无限弹二维码）。
  // 现在写到 {DSH_HOME}/qqbot-settings/<ns>.json；插件在此读取并覆盖 patch 值，
  // 并监听桥发出的变更事件实现**热生效**（不写宿主配置 → 不触发任何热更新）。
  const ownSettingsFile = join(
    process.env.DSH_HOME || join(homedir(), '.dsh'),
    'qqbot-settings',
    String(ns).replace(/[^A-Za-z0-9_-]/g, '_') + '.json',
  );
  const readOwnSettings = (): Record<string, unknown> => {
    try {
      if (!existsSync(ownSettingsFile)) return {};
      const o = JSON.parse(readFileSync(ownSettingsFile, 'utf8'));
      return o && typeof o === 'object' ? o : {};
    } catch { return {}; }
  };
  /**
   * 深合并（一层递归）—— ⚠️ 不能再用浅合并 Object.assign！
   * 事故(2026-09-24)：自有存储里若出现空对象(如 sticker: {})，浅合并会把 patch 里的整个
   * sticker 配置覆盖成空 → config.sticker.collectEnabled 变 undefined → **图片自动下载停摆**
   * （症状：最后一张自动下载的图停在某时刻，之后入站图片只剩 QQ 长 URL）。
   * 深合并只在真有子键时才覆盖，空对象顶不掉默认值。
   */
  const mergeDeep = (base: unknown, over: unknown): unknown => {
    if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
    const b = (base && typeof base === 'object' && !Array.isArray(base)) ? (base as Record<string, unknown>) : {};
    const out: Record<string, unknown> = Object.assign({}, b);
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
      if (v === undefined) continue;
      const cur = out[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
        out[k] = mergeDeep(cur, v) as Record<string, unknown>;
      } else {
        out[k] = v;
      }
    }
    return out;
  };
  const ownSettings = readOwnSettings();
  if (Object.keys(ownSettings).length) {
    Object.assign(resolvedConfig as unknown as Record<string, unknown>, mergeDeep(resolvedConfig, ownSettings) as Record<string, unknown>);
    logger.info(`已加载插件自有设置(${Object.keys(ownSettings).length} 项): ${ownSettingsFile}`);
  }
  // ⚠️ 2026-09-28 修：监听里除了热更新配置，还要处理"从无凭据 → 有凭据"的自动启动网关。
  //   背景：bootstrapGateway 只在 apply() 里跑一次。用户首次安装时没有凭据，
  //   插件只是"装好设置面板"就结束了（见下方 hasCred 分支）→ 此后在设置页填好凭据，
  //   配置对象虽然更新了，但**网关从未启动** → 表现就是"填了密码却不会自动重连"（必须重启）。
  //   现在：一旦检测到凭据从无到有，就自动启动一次网关。
  let gatewayStarted = false;
  const tryStartGateway = async (): Promise<void> => {
    if (gatewayStarted) return;
    const cur = resolvedConfig as unknown as Record<string, unknown>;
    const id = String(cur.appId ?? '');
    const sec = String(cur.appSecret ?? '');
    if (!id || !sec) return;
    gatewayStarted = true;
    try {
      logger.info(`实例 ${ns}: 检测到凭据已就绪，开始启动网关…`);
      await bootstrapGateway(ctx, agents, resolvedConfig, logger);
      logger.info(`实例 ${ns}: 网关已启动（凭据热更新生效，无需重启）`);
    } catch (err) {
      gatewayStarted = false;   // 失败则允许下次重试
      logger.warn?.(`实例 ${ns}: 凭据热更新后启动网关失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  try {
    (ctx as unknown as { on: (ev: string, fn: (ns?: string) => void) => void }).on('qqbot/settings-changed', (changedNs?: string) => {
      if (changedNs && changedNs !== ns) return;
      const next = readOwnSettings();
      Object.assign(resolvedConfig as unknown as Record<string, unknown>, mergeDeep(resolvedConfig, next) as Record<string, unknown>);
      logger.info(`设置已热更新(${ns}): ${Object.keys(next).length} 项`);
      void tryStartGateway();   // ← 若刚从"无凭据"变成"有凭据"，自动把网关拉起来
    });
  } catch { /* 事件系统不可用 → 退化为重启生效 */ }

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
      // ⚠️⚠️ 2026-09-28 关键修复：**不要用 ctx.inject 等依赖**。
      //   原因：cordis 的 ctx.inject(deps, cb) 会把 cb 挂成一个【子 fiber】并让【当前插件】
      //   一起等待这些服务 —— 一旦宿主没有提供（或尚未注册）settings / webServer，
      //   插件自身就永久 pending，宿主判定 "1 required plugin did not activate"，
      //   连带【整个 Web UI 都不渲染】（只剩一句错误 + 一个 dock 球）。
      //   实测：全新 profile 装本插件必然复现；老环境因为服务早就绪所以看不出来。
      //   现在改为：服务已就绪就立即装桥；没就绪则监听服务注册事件，**绝不阻塞插件自身激活**。
      const mountBridge = (c: Context): void => {
        try {
          bridgeMod.apply!(c);
          logger.info(`[im-qqbot] settings host 桥已 apply(deps=${deps.join('+')})`);
        } catch (err) {
          logger.warn?.(`im-qqbot: settings host 桥 apply 异常: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      // ⚠️⚠️ 2026-09-28 最终方案（两次踩坑后的结论）：
      //   · 直接 mountBridge(ctx) 不行 —— 桥的 apply 内部要 `ctx.webServer`，
      //     而没经过 inject 的 ctx 访问它会抛 "cannot get property \"webServer\" without inject"。
      //   · 用 ctx.inject(deps, cb) 又不行 —— 它会让**插件自身 fiber 一起等依赖**，
      //     宿主在服务就绪前就判 "1 required plugin did not activate"，
      //     【整个 Web UI 都不渲染】（只剩一句错误 + 一个 dock 球）。
      //   → 解法：**apply 先正常返回（插件立即激活成功）**，
      //     再用 setTimeout 延后到宿主服务注册完成，此时才做 ctx.inject（不再影响已完成的激活）。
      const doInjectLater = (): void => {
        try {
          ctx.inject(deps, (serverCtx: Context) => mountBridge(serverCtx));
        } catch (err) {
        }
      };
      // 用较短的定时器即可：宿主通常同一轮就把服务注册完
      try { setTimeout(doInjectLater, 1500); } catch { doInjectLater(); }
      logger.info(`[im-qqbot] settings host 桥已排程(延后 inject, deps=${deps.join('+')})`);
    } else {
      logger.warn('[im-qqbot] settings-host.js 缺少 apply, 桥跳过');
    }
  } catch (err) {
    logger.warn?.(`im-qqbot: settings host 桥装载跳过: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 群友小传 → 注册为**运行时上下文贡献**(dsh systemPrompt.context, 与 @a9i5k4/dsh-auto-memory 同款姿势):
  //   user-role 快照挂在历史尾部, system prompt 本体保持字节级稳定 → 前缀缓存全程命中, 不被打穿。
  try {
    const sp = (ctx as unknown as { systemPrompt?: { context?: (c: { name: string; order: number; text: (a: unknown) => string }) => () => void } }).systemPrompt;
    if (sp && typeof sp.context === 'function') {
      sp.context({ name: 'qqbot-people-memo', order: 60, text: () => { const txt = takePendingMemoText(); if (txt) logger.info(`[小传] 运行时上下文提供 ${txt.length} 字`); return txt; } });
      logger.info('[im-qqbot] 群友小传已注册为运行时上下文贡献');
    } else {
      logger.warn('[im-qqbot] 宿主未提供 systemPrompt.context —— 小传注入退化为不注入');
    }
  } catch (err) {
    logger.warn(`[im-qqbot] 小传上下文注册失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 没有凭据 → 保留设置面板即可，不启动网关（不连 QQ、不注册入站）
  //   此时已注册 settings-changed 监听：用户填好凭据保存后会自动启动网关（无需重启）。
  if (!hasCred) {
    logger.info(`实例 ${ns}: 暂无凭据 —— 设置面板已就绪，填好凭据保存后会自动连接（无需重启）。`);
    return;
  }

  await tryStartGateway();
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

