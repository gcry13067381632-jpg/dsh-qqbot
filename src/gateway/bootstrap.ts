/**
 * 网关组装 — 创建 bot、编排中间件、注册事件、出站、生命周期
 *
 * 将 QQ 消息平台作为 dsh 前端协议驱动：入站消息 → handleInbound → dsh agent，
 * dsh session/event → createOutboundHandler → QQ 出站。
 */
import type { Context } from '@deepseek-ai/cordis';
import { join } from 'node:path';
import { QQBot, type ReplyTarget } from '@tencent-connect/qqbot-nodejs';
import { FULL_INTENTS } from '@tencent-connect/qqbot-nodejs/protocol';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { SessionManager, type DshAgentRegistry } from '../session/index.js';
import { handleInbound, createOutboundHandler } from '../transport/index.js';
import type { ToolsRegistryLike } from '../transport/tool-presenter.js';
import type { QQBotSender } from '../transport/outbound-buffer.js';
import { buildUserAgent } from '../shared/index.js';
import type { ImQQBotConfig, BotplayEventConfig } from '../config.js';
import type { Logger } from '../types.js';
import { setupMiddlewares } from './middleware-setup.js';
import { dataRootOf, migrateLegacyData, stickerDirOf } from './data-root.js';
import { configureStickerStore } from '../features/sticker-store.js';
import { initStickerGate, bindStickerGates, flushStickerGate, getStickerGate, StickerGateDenied } from '../features/sticker-gate.js';
import { startScheduler } from '../features/scheduler.js';
import { startJoinRequestPolling } from '../features/poll-join-requests.js';
import { configureScheduleStore, getScheduleStore } from '../features/schedule-store.js';
import { setChannelBridge } from '../channel-tools.js';
import { QqApprovalController, setApprovalDispatch, makeApprovalListener, registerApprovalController } from '../features/qq-approval.js';
import { QqUserQuestionsController, registerQuestionController } from '../features/qq-user-questions.js';
import { handleGroupJoinRequestEvent } from '../features/group-join-request.js';
import { handleGroupMemberAddEvent, handleGroupAddRobotEvent } from '../features/group-hub.js';
import { registerSessionManager, setBotOnline } from '../features/session-registry.js';
import { BotplayController, registerBotplayController, setBotplayTriggerImpl, setBotplayCatalogImpl } from '../features/botplay.js';
import { readBotplayEvents } from '../features/botplay-store.js';
import { PresetSwitcherController, setPresetCardImpl } from '../features/preset-switcher.js';
import { buildCommandList } from '../commands/index.js';
import { SettingsReader } from '../model/settings-reader.js';

/** 从 interaction 事件推出"回复目标"(回执发到按钮所在群/私聊)。scope 由事件 chat_type/scene 推断 */
function replyTargetOfInteraction(
  event: unknown,
  _ctx: unknown,
  _manager: SessionManager,
): { scope: 'group' | 'c2c'; targetId: string; msgId?: string } {
  const e = event as {
    scene?: string; chat_type?: number; group_openid?: string; group_member_openid?: string; user_openid?: string;
  };
  if (e?.group_openid) return { scope: 'group', targetId: e.group_openid };
  if (e?.user_openid) return { scope: 'c2c', targetId: e.user_openid };
  // 兜底: 群聊 member_openid 只能推群, 但没有 group_openid 无法构造 → 空 target(上层会忽略)
  return { scope: (e?.chat_type === 1 || e?.scene === 'group') ? 'group' : 'c2c', targetId: e?.group_member_openid ?? '' };
}

export async function bootstrapGateway(
  ctx: Context,
  agents: DshAgentRegistry,
  config: ImQQBotConfig,
  logger: Logger,
): Promise<void> {
  const manager = new SessionManager(ctx, agents, config, logger);
  // ── dataRoot 启动迁移: 若配置了 dataRoot(如 cwd/dshqqbot), 先把 cwd 下的旧数据目录
  //    搬进去(幂等, 不覆盖); 必须在任何数据目录初始化/写入之前执行。──
  migrateLegacyData(config, logger);
  // QQ 远程审批控制器(enableApprovals 时创建; 定义在 sender 就绪后, 此处先声明供入站回调引用)
  let approvalController: QqApprovalController | undefined;
  let questionController: QqUserQuestionsController | undefined;
  // botplay 互动事件控制器(事件配置 live 现读 config.botplayEvents; 定义在 sender 就绪后)
  let botplayController: BotplayController | undefined;

  // ── 表情包图库单例预初始化(防目录分裂) ──
  // ⚠️ 单例时序坑：谁先 getStickerStore 谁定路径。必须在启动早期按数据根
  //    初始化，否则 list_stickers(无参)会以 process.cwd 建错目录(线上踩坑:C盘幽灵库)。
  const stickerDataDir = stickerDirOf(config);
  const stickerStore = configureStickerStore(stickerDataDir, logger);
  // 启动维护: 清理损坏/空文件 + 物理清除超30天回收站条目
  try {
    const broken = stickerStore.cleanupBroken();
    const purged = stickerStore.purgeTrashed();
    if (broken > 0 || purged > 0) logger.info(`[sticker] 启动维护: 清损坏${broken} 清回收站${purged}`);
  } catch { /* ignore */ }
  logger.info(`[sticker] 图库目录: ${stickerDataDir}`);

  // ── 表情包发送闸门单例预初始化(P1): 与图库同 dataDir, 绑定 live config getter ──
  // 配置现读(getter 每次判定取 config.sticker.gates), Web 设置热更新即时生效。
  initStickerGate(stickerDataDir, logger);
  bindStickerGates(() => config.sticker.gates);
  const stickerGate = getStickerGate(stickerDataDir, logger);

  // ── 会话自设定时任务单例预初始化(schedule_timer 工具用) ──
  // 落盘 {cwd}/.qqbot/timers.json; 与图库同策略: 启动早期按 config.cwd 定路径防分裂。
  const scheduleDataDir = join(dataRootOf(config), '.qqbot');
  configureScheduleStore(scheduleDataDir, logger);

  // ── 初始化 QQ Bot SDK ──
  const userAgent = buildUserAgent();
  // 启动期合并 settings.yaml 的 groupAdmin(Web 可视化设置那份):
  // QQBot 构造时 intents 一次性读取 config.groupAdmin; 而 settings 服务注入是异步的,
  // 晚于 gateway 构造 → 仅靠 settings 同步拿不到值, 曾导致 watchJoinRequests 改完不生效
  // (2026-09-09 复盘: 只能改 cordis.patch.yml 绕坑)。这里启动时直接读文件, 让
  // Web 设置(存 settings.yaml)重启即生效, 无需手改 yml —— 通用且时序安全。
  try {
    const reader = new SettingsReader();
    const ga = reader.readGroupAdmin((config as { settingsNs?: string }).settingsNs?.trim() || 'im-qqbot');
    if (ga) {
      config.groupAdmin = { ...(config.groupAdmin ?? {}), ...ga } as typeof config.groupAdmin;
      logger.info(`[im-qqbot] 启动合并 settings.yaml groupAdmin: ${JSON.stringify(config.groupAdmin)}`);
    }
  } catch (err) {
    logger.warn?.(`[im-qqbot] settings.yaml groupAdmin 合并跳过: ${err instanceof Error ? err.message : String(err)}`);
  }
  // 入群申请事件(GROUP_JOIN_REQUEST)订阅: intent GROUP_MEMBER_EVENT = 1<<24, SDK 默认 FULL_INTENTS 不含它。
  // ⚠️ 只在"群管理开启 + watchJoinRequests"时扩展 intents(Identify 携带未授权 intent 可能被拒连 4914/4915);
  //    该值在 gateway 连接建立时确定 → 修改 config 后需重启才生效(非 live)。
  const watchJoinRequests = !!config.groupAdmin?.enabled && !!config.groupAdmin?.watchJoinRequests;
  const bot = new QQBot({
    appId: config.appId,
    appSecret: config.appSecret,
    transport: 'websocket',
    baseUrl: process.env.QQBOT_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
    tokenBaseUrl: process.env.QQBOT_TOKEN_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
    userAgent,
    ...(watchJoinRequests ? { intents: FULL_INTENTS | (1 << 24) } : {}),
    // 调试隔离时可用 QQBOT_DEBUG_CONSOLE=1 让 QQBot 日志直出 stdout，便于定位
    logger: process.env.QQBOT_DEBUG_CONSOLE ? (console as typeof logger) : logger,
  } as ConstructorParameters<typeof QQBot>[0]);
  logger.info(`QQBot SDK initialized (UA: ${userAgent})${watchJoinRequests ? ' [watchJoinRequests: GROUP_MEMBER_EVENT 已订阅]' : ''}`);

  // ── 中间件链 ──
  await setupMiddlewares(bot, config, manager, logger);

  // ── 入站：经过中间件链后的消息交给 dsh agent ──
  bot.on('message', async (mCtx: MiddlewareContext) => {
    const msg = mCtx.message;
    // QQ 远程审批: /approve|/deny CODE 最先拦截(消费后不再进 agent/普通聊天)
    if (approvalController) {
      const scope: 'c2c' | 'group' = msg.kind === 'group' ? 'group' : 'c2c';
      const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;
      try {
        const consumed = await approvalController.handleInbound(msg as never, {
          scope, targetId: peerId, msgId: msg.messageId,
        });
        if (consumed) return;
      } catch (err) {
        logger.warn(`approval inbound error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (config.debug) {
      logger.debug(`← message (post-middleware): ${JSON.stringify(msg, null, 2).slice(0, 500)}`);
    }
    await handleInbound(msg, manager, config, logger, mCtx.state);
  });

  // ── 出站：dsh session/event → QQ 消息 ──
  // 获取 tools 服务（工具结果结构化展示，参考 dsh-TUI presentResult），可选
  let toolsRegistry: ToolsRegistryLike | undefined;
  try {
    toolsRegistry = ctx.get('tools') as ToolsRegistryLike | undefined;
  } catch {
    toolsRegistry = undefined;
  }

  // 发送适配器：将 QQBot 实例适配为 QQBotSender（openStream 参数形态不同）
  // 记录 bot 发给每个 peer 的最近消息历史，供 agent [RECALL(:N)] 按序号撤回自身消息。
  const HISTORY_LIMIT = 10;
  const sentByPeer = new Map<string, { target: ReplyTarget; id: string }[]>();
  const keyOf = (t: { scope: string; targetId: string }) => `${t.scope}:${t.targetId}`;
  const pushSent = (target: ReplyTarget, id: string | undefined): void => {
    if (!id) return;
    const k = keyOf(target);
    let arr = sentByPeer.get(k);
    if (!arr) { arr = []; sentByPeer.set(k, arr); }
    arr.unshift({ target, id }); // 最新在前
    if (arr.length > HISTORY_LIMIT) arr.length = HISTORY_LIMIT;
  };
  const doRecall = async (target: ReplyTarget, index: number): Promise<boolean> => {
    const arr = sentByPeer.get(keyOf(target));
    if (!arr) return false;
    const item = arr[index - 1];
    if (!item) return false;
    try {
      await bot.recallMessage(item.target, item.id);
      arr.splice(index - 1, 1);
      if (!arr.length) sentByPeer.delete(keyOf(target));
      return true;
    } catch (err) {
      logger.error(`recall(${index}) failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };
  // 出站富媒体降级判定: 内容无 markdown 语法(且无 @提及/qqbot 标签)→ 走纯文本通道(msg_type:0),
  // 避开 QQ 对 markdown 富媒体的严格频控(实测连发 5 条 markdown 后静默被拦)。
  const hasMarkdownSyntax = (text: string): boolean => {
    const t = String(text || '');
    return (
      /<@[A-Za-z0-9]+>|<qqbot-at-user|<qqbot-at-everyone|<emoji:|<#/.test(t) ||
      t.includes('```') || t.includes('`') ||
      /(^|\n)\s*(#{1,6}\s|>\s?|[-*+]\s|\d+\.\s)/.test(t) ||
      /\*\*[^*]+\*\*/.test(t) ||
      /\[([^\]\n]+)\]\(https?:[^)\n]+\)/.test(t) ||
      /~~[^~\n]+~~/.test(t)
    );
  };

  const sender: QQBotSender = {
    sendMarkdown: async (target, content) => {
      try {
        const rawText = String(content || '');
        // 纯文本降级: 无 markdown 语法/@标签 → 直接纯文本通道, 省富媒体额度与频控
        if (!hasMarkdownSyntax(rawText)) {
          const respT = (await bot.sendText(target, rawText)) as { id?: string } | undefined;
          pushSent(target, respT?.id);
          return respT;
        }
        const resp = (await bot.sendMarkdown(target, content)) as { id?: string } | undefined;
        pushSent(target, resp?.id);
        return resp;
      } catch (err) {
        // ── 主动推送被拒降级链(M3 定时等无 msgId 场景; 被动回复原样抛错) ──
        // 平台限制: markdown 主动消息常需专门权限; c2c 主动需 48h 互动窗, 窗口外拒收。
        // 降级顺序: sendMarkdown → sendText(纯文本主动) → c2c sendWakeup(is_wakeup 召回, 30天窗)。
        if (!target.msgId) {
          // ⚠️ 清洗仅针对 markdown 语法字符; QQ at 标签必须原样保留——
          // 实测(2026-09-06): 高亮 @ 用 `<@openid>`(无斜杠)或 `<qqbot-at-user id="openid" />`;
          // 剥掉 '>' 会把标签弄残 → QQ 不渲染。这里先把两类 at 标签暂存, 清洗完再恢复。
          const plain = String(content || '')
            .replace(/<qqbot-at-user\s+id="([A-Za-z0-9]+)"\s*\/>/g, '\u0001ATQ:$1\u0001')
            .replace(/<@([A-Za-z0-9]+)>/g, '\u0001ATA:$1\u0001')
            .replace(/[#*`_~>]/g, '')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/\u0001ATQ:([A-Za-z0-9]+)\u0001/g, '<qqbot-at-user id="$1" />')
            .replace(/\u0001ATA:([A-Za-z0-9]+)\u0001/g, '<@$1>')
            .trim();
          if (plain) {
            try {
              const r2 = (await bot.sendText(target, plain)) as { id?: string } | undefined;
              pushSent(target, r2?.id);
              logger.warn(`主动推送 markdown 被拒, 已降级纯文本发送: ${err instanceof Error ? err.message : String(err)}`);
              return r2;
            } catch (err2) {
              if (target.scope === 'c2c') {
                try {
                  const r3 = (await bot.sendWakeup(target, plain)) as { id?: string } | undefined;
                  pushSent(target, r3?.id);
                  logger.warn(`主动纯文本被拒, 已降级 is_wakeup 召回通道: ${err2 instanceof Error ? err2.message : String(err2)}`);
                  return r3;
                } catch (err3) {
                  logger.error(`主动推送三通道全拒: md=${err instanceof Error ? err.message : String(err)} / text=${err2 instanceof Error ? err2.message : String(err2)} / wakeup=${err3 instanceof Error ? err3.message : String(err3)}`);
                  throw err3;
                }
              }
              logger.error(`主动推送两通道被拒: md=${err instanceof Error ? err.message : String(err)} / text=${err2 instanceof Error ? err2.message : String(err2)}`);
              throw err2;
            }
          }
        }
        throw err;
      }
    },
    sendMarkdownWithKeyboard: async (target, content, keyboard) => {
      // 卡片按钮(审批/提问): bot.send 显式 msg_type=2 + keyboard。
      // 失败直接抛(不静默降级)——由调用方决定文本兜底, 避免"卡片+文本码"双发。
      const resp = (await bot.send(
        { target, msgType: 2, markdown: { content }, keyboard: keyboard as never },
      )) as { id?: string } | undefined;
      pushSent(target, resp?.id);
      return resp;
    },
    openStream: (target) => bot.openStream({
      target: {
        scope: target.scope,
        targetId: target.targetId,
        msgId: target.msgId as string,
      },
    }),
    sendMedia: async (target, kind, source) => {
      // ── P1 表情包闸门(唯一咽喉, [MEDIA]标记 与 send_media 工具都汇于此) ──
      // 只对"库内图片的主动发送"生效; URL/非库路径/语音视频文件放行。
      let gateHit = false;
      if (kind === 'image' && source.localPath) {
        const groupId = target.scope === 'group' ? target.targetId : undefined;
        const verdict = stickerGate.checkMedia({ groupId, kind, localPath: source.localPath });
        if (!verdict.allowed) {
          throw new StickerGateDenied(verdict.reason ?? '被闸门拦截');
        }
        gateHit = verdict.isSticker && !!groupId;
      }
      const srcOpt = source.url
        ? { url: source.url }
        : source.localPath
          ? { localPath: source.localPath }
          : {};
      let out: { message?: { id?: string } } | undefined;
      if (kind === 'image') out = await bot.sendImage(target, srcOpt);
      else if (kind === 'video') out = await bot.sendVideo(target, srcOpt);
      else if (kind === 'voice') out = await bot.sendVoice(target, srcOpt);
      else out = await bot.sendFile(target, srcOpt);
      const id = out?.message?.id;
      pushSent(target, id);
      // 发送成功后才记录(失败不占预算/去重); 库内图且群内才算表情包发送
      if (gateHit && id !== undefined && source.localPath) {
        try {
          stickerGate.noteSent(target.scope === 'group' ? target.targetId : undefined, source.localPath);
        } catch { /* 记录失败不影响发送 */ }
      }
      return { id };
    },
    recallLast: (target) => doRecall(target, 1),
    recallByIndex: (target, index) => doRecall(target, index),
    // c2c 主动召回(官方 is_wakeup:true; 群聊调用会抛, 由调用方保证只用于 c2c)
    sendC2cWakeup: (target, content) => bot.sendWakeup(target, content),
  };

  // 把发送能力注入 SessionManager，供 QQ 会话 provide qqChannel 服务给通道工具
  manager.installChannelSender(sender);
  // 全局桥: 通道工具 execute 的兜底解析(不依赖 setup/provide, 防重启后 setup 未跑)
  setChannelBridge({ manager, sender });

  // ── 群事件(M2 群组管理器 + P2.5): rawEvent 分发 ──
  //  · GROUP_JOIN_REQUEST / GROUP_MEMBER_ADD: intent GROUP_MEMBER_EVENT(1<<24), 需 watchJoinRequests 已扩 intents;
  //  · GROUP_ADD_ROBOT: intent GROUP_AND_C2C_EVENT(1<<25, SDK FULL_INTENTS 基础订阅即收)。
  // 同一 bot 仅一个群管理实例; 事件带 group_openid, 天然按群路由。
  bot.on('rawEvent', (rawCtx: { eventType?: string; data?: unknown }) => {
    const et = rawCtx.eventType;
    if (et === 'GROUP_JOIN_REQUEST') {
      logger.info(`[group-join] rawEvent GROUP_JOIN_REQUEST 到达`);
      void handleGroupJoinRequestEvent(rawCtx.data, { sender, config, logger, manager }).catch((err: unknown) => {
        logger.error(`[group-join] 事件处理异常: ${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }
    if (et === 'GROUP_MEMBER_ADD') {
      logger.info(`[group-hub] rawEvent GROUP_MEMBER_ADD 到达`);
      void handleGroupMemberAddEvent(rawCtx.data, { config, logger, manager }).catch((err: unknown) => {
        logger.error(`[group-hub] member_add 处理异常: ${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }
    if (et === 'GROUP_ADD_ROBOT') {
      logger.info(`[group-hub] rawEvent GROUP_ADD_ROBOT 到达`);
      void handleGroupAddRobotEvent(rawCtx.data, { config, logger, manager }).catch((err: unknown) => {
        logger.error(`[group-hub] add_robot 处理异常: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  });

  // ── QQ 远程审批: ACP 模式接入(专家考古实证, 见 qq-approval.ts 头注) ──
  // ①dispatch: ownership(只处理本 bot 的 agent)+ enableApprovals 闸门;
  // ②监听: 注册在插件 apply ctx, 用 {prepend:true} 插到链首(抢在宿主 GUI 转发器 dsh-api-remotes 之前)。
  approvalController = new QqApprovalController(manager, sender, logger, () => config.approvalTimeoutMs);
  // 注册进 ns 注册表(Web 审批浮层经 settings-host 同源路由读写); ns 取 settingsNs 与 index.ts 一致
  const myNs = (config as { settingsNs?: string }).settingsNs?.trim() || 'im-qqbot';
  registerApprovalController(myNs, approvalController);
  registerSessionManager(myNs, manager);
  setApprovalDispatch(((request: unknown, next: () => Promise<string>) => {
    const diagA = (line: string) => { try { (globalThis as Record<string, unknown>).qqApprovalDiag = ((globalThis as Record<string, unknown>).qqApprovalDiag || []); ((globalThis as Record<string, unknown>).qqApprovalDiag as string[]).push('[' + new Date().toISOString() + '] ' + line); } catch { /* 忽略 */ } };
    diagA('dispatch enter enable=' + config.enableApprovals);
    if (!config.enableApprovals) { diagA('dispatch next: disabled'); return next(); }
    const reqAgent = (request as { agent?: unknown }).agent;
    const rec = reqAgent ? manager.findByAgent(reqAgent as never) : undefined;
    diagA('dispatch find=' + (rec ? 'hit(' + rec.scope + ')' : 'miss'));
    if (!reqAgent || !rec) return next(); // 非本 bot agent → 放行给 GUI/ACP
    diagA('dispatch -> request()');
    return approvalController!.request(request as never, next as never);
  }) as never);
  // 挂到宿主根 ctx(与 Web GUI 审批转发器同层)并 prepend 插链首 —— 保证本 bot 的审批先被 QQ 通道接管
  const approvalCtx = (((ctx as unknown as { root?: { ctx?: unknown } | unknown }).root) || ctx) as unknown as {
    on(event: string, handler: (...args: unknown[]) => unknown, config?: { prepend?: boolean }): void;
  };
  approvalCtx.on('approval/request', makeApprovalListener() as never, { prepend: true });
  console.log('[qq-approval] ACP-mode listener registered (root-ctx + prepend)');
  logger.info(`[im-qqbot] QQ 远程审批接线就绪(${config.enableApprovals ? '已启用' : '默认关闭, Web 设置可热开'})`);

  // ── QQ 远程提问(按钮卡片版): ask_user_question → QQ 卡片按钮 ──
  // 宿主 user-questions/request 是 Agent 作用域 waterfall(同 approval), Web UI 答案器
  // 在宿主引导期注册 → 本监听同样 {prepend:true} 抢链首。enableQuestions 默认开(与审批独立开关)。
  const enableUserQuestions = config.enableUserQuestions !== false;
  questionController = new QqUserQuestionsController(manager, sender, logger, () => config.approvalTimeoutMs || 120000);
  registerQuestionController(myNs, questionController);
  (ctx as unknown as {
    on(event: string, handler: (...args: unknown[]) => unknown, config?: { prepend?: boolean }): void;
  }).on('user-questions/request', (async (request: unknown, next: () => Promise<unknown>) => {
    if (!enableUserQuestions) return next();
    const reqAgent = (request as { agent?: unknown }).agent;
    if (!reqAgent || !manager.findByAgent(reqAgent as never)) return next(); // 非本 bot agent → GUI 兜底
    try {
      return await questionController!.request(request as never, next as never);
    } catch (err) {
      logger.warn(`[qq-questions] request 异常: ${err instanceof Error ? err.message : String(err)}`);
      return next();
    }
  }) as never, { prepend: true });
  logger.info(`[im-qqbot] QQ 远程提问接线就绪(${enableUserQuestions ? '启用' : '关闭'})`);

  // ── botplay 互动事件装配器(2026-09-08, Phase1 MVP) ──
  // 事件配置真相源 = {dataRoot}/botplay-events.json (2026-09-10 M4.3 起, 控制器现读支持热更)。
  // ⚠️ 修复: 启动时把文件内容回填 config.botplayEvents —— 命令层/其他消费者仍读该字段,
  //    而 settings 层自迁移后已被清空(空数组), 若不回填会导致 /botplay 查不到任何事件。
  try {
    const seeded = readBotplayEvents(dataRootOf(config), () => (Array.isArray(config.botplayEvents) ? config.botplayEvents : []));
    if (Array.isArray(seeded) && seeded.length > 0) {
      (config as { botplayEvents?: BotplayEventConfig[] }).botplayEvents = seeded;
      logger.info(`[im-qqbot] botplay 事件已从文件装载: ${seeded.length} 个`);
    }
  } catch (err) {
    logger.warn?.(`[im-qqbot] botplay 事件文件装载失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  // /botplay 命令 → triggerBotplay 模块级注册表 → 这里实现(带 sender/manager)发卡。
  botplayController = new BotplayController(
    manager,
    sender,
    logger,
    // 事件配置从 {dataRoot}/.qqbot/botplay-events.json 现读(2026-09-10 M4.3 独立存储,
    // 自动迁移 settings 旧数据; 文件缺失回退 settings 现值)
    () => readBotplayEvents(dataRootOf(config), () => (Array.isArray(config.botplayEvents) ? config.botplayEvents : [])),
    () => (Array.isArray(config.groupAdmin?.owners) ? config.groupAdmin.owners : []),
    () => stickerDataDir,
  );
  registerBotplayController(myNs, botplayController);
  setBotplayTriggerImpl((target, eventId, triggererId) => botplayController!.trigger(target, eventId, triggererId));
  setBotplayCatalogImpl((target, page) => botplayController!.sendCatalog(target, page));
  // 预设切换卡片(2026-09-10): /preset 无参发按钮卡, 点击热切人格(仿 botplay 翻页)
  const presetSwitcher = new PresetSwitcherController(manager, sender, logger);
  setPresetCardImpl((target, scope, peerId, page) => presetSwitcher.sendCard(target, scope, peerId, page ?? 0));
  // 指令型按钮(Phase2): 点击后执行斜杠命令(不经 AI)。复用 buildCommandList 的 handler,
  // 模拟一个最小命令 ctx(command 名称/空参 + 消息壳), 返回 handler 结果文本。
  botplayController.setCommandExecutor(async (cmdName, target) => {
    const cmdList = buildCommandList({ manager, config });
    const cmd = cmdList.find((c) => (Array.isArray(c.name) ? c.name : [c.name]).map(String).includes(cmdName));
    if (!cmd) return `未知指令「${cmdName}」(指令型按钮可用的: ${cmdList.filter((c) => !(c as { hidden?: boolean }).hidden).map((c) => (Array.isArray(c.name) ? c.name[0] : c.name)).join(', ')})`;
    const fakeCtx = {
      message: { kind: target.scope === 'group' ? 'group' : 'c2c', senderId: '', groupOpenid: target.scope === 'group' ? target.targetId : undefined },
      replyTarget: target,
      command: { name: cmdName, args: [], raw: '' },
      // 部分命令(如 /bot-help)直接经 cmdCtx.bot.sendMarkdown 分段发消息 → 桥到真实 sender
      bot: { sendMarkdown: async (t: unknown, c: string) => sender.sendMarkdown((t as Parameters<typeof sender.sendMarkdown>[0]) || target, c) },
    } as never;
    const result = await cmd.handler(fakeCtx as never);
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      const r = result as { kind?: string; content?: string };
      if (r.kind === 'text' && r.content) return r.content;
    }
    return '';
  });
  logger.info('[im-qqbot] botplay 互动事件接线就绪(/botplay 触发发卡, dock🎮装配, 保存即热更; 指令型按钮已接命令层)');

  // ── 按钮回调(INTERACTION_CREATE, type=11): 审批/提问卡片共用分发 ──
  // SDK 事件: bot.on('interaction', (ctx, event) => …); 需 PUT /interactions/{id} 回应防 loading。
  if (typeof (bot as unknown as { on: (e: string, h: unknown) => void }).on === 'function') {
    (bot as unknown as { on: (e: string, h: (...a: unknown[]) => void) => void }).on('interaction', (async (ctx: unknown, event: unknown) => {
      const ev = event as { id?: string; data?: { type?: number; resolved?: { button_data?: string } } };
      // 诊断落盘(排查按钮回调是否到达; ~/.dsh/botplay-diag.log)
      try {
        const { appendFileSync } = await import('node:fs');
        const diagFile = String(process.env.USERPROFILE || process.env.HOME || '') + '/.dsh/botplay-diag.log';
        const line = `[${new Date().toISOString()}] interaction id=${ev?.id ?? '?'} type=${ev?.data?.type ?? '?'} btn=${ev?.data?.resolved?.button_data ?? '(none)'} group_member=${(event as { group_member_openid?: string }).group_member_openid ?? ''} user=${(event as { user_openid?: string }).user_openid ?? ''}`;
        appendFileSync(diagFile, line + '\n');
      } catch { /* 诊断失败忽略 */ }
      if (ev?.data?.type !== 11) return; // 只处理消息按钮回调
      const target = replyTargetOfInteraction(ev, ctx, manager);
      let consumed = false;
      try {
        if (presetSwitcher) {
          const scope = target.scope === 'group' ? 'group' : 'c2c';
          consumed = await presetSwitcher.handleInteraction(ev, target, scope, target.targetId);
        }
        if (!consumed && approvalController) consumed = await approvalController.handleInteraction(ev, target);
        if (!consumed && questionController) consumed = await questionController.handleInteraction(ev, target);
        if (!consumed && botplayController) consumed = await botplayController.handleInteraction(ev, target);
      } catch (err) {
        logger.warn(`[qq-interaction] 处理异常: ${err instanceof Error ? err.message : String(err)}`);
      }
      // 回应 loading(无论是否消费都要 ack; 防客户端一直转圈)
      try {
        await (bot as unknown as { acknowledgeInteraction(id: string): Promise<void> }).acknowledgeInteraction(ev.id ?? '');
      } catch { /* ack 失败不致命 */ }
    }) as never);
    logger.info('[im-qqbot] interaction(按钮回调)分发就绪');
  }

  const outboundHandler = createOutboundHandler(manager, sender, config, logger, toolsRegistry);
  (ctx as unknown as { on(event: string, handler: (...args: unknown[]) => void): void })
    .on('session/event', outboundHandler as (...args: unknown[]) => void);

  bot.on('error', (err: unknown) => {
    logger.error(`bot error: ${err instanceof Error ? err.message : String(err)}`);
    setBotOnline(myNs, false);
  });

  bot.on('resumed', () => {
    setBotOnline(myNs, true);
  });

  bot.on('ready', () => {
    setBotOnline(myNs, true);
    console.log(`[im-qqbot] Bot ready! appId=${config.appId}`);
  });

  // ── 生命周期 ──
  let stopScheduler: (() => void) | undefined;
  let stopJoinPoll: (() => void) | undefined;
  // 会话自设定时任务(schedule-store 系, schedule_timer 工具创建)
  let scheduleTicker: ReturnType<typeof setInterval> | undefined;
  const scheduleInFlight = new Set<string>();
  const scheduleMissed = new Map<string, number>();
  (ctx as unknown as { effect(fn: () => (() => Promise<void>) | void, name?: string): void })
    .effect(() => {
      logger.info(`Starting bot (appId=${config.appId})`);
      bot.start().catch((err: unknown) => {
        logger.error(`Bot start failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      // M3 定时唤醒调度器(与 bot 同生命周期; 任务到点 followup → 回复经出站链路主动推送)
      stopScheduler = startScheduler(manager, config, logger);

      // 入群申请轮询(2026-09-09 主人定, 事件驱动兜底): 定时拉各群审批列表,
      // 有新增就唤醒 LLM 提醒主人; live config 控制(Web 设置热更, 无需重启)。
      stopJoinPoll = startJoinRequestPolling(manager, config, logger);

      // 会话自设定时任务 ticker(30s): due → injectToPeer 注入原会话 → 成功 markDone;
      // 失败(会话不在)连续≥3次自动停用; once 到期滞留 >24h 清理防堆积。
      const tickSchedule = (): void => {
        try {
          const store = getScheduleStore(scheduleDataDir);
          const now = Date.now();
          for (const job of store.list()) {
            if (job.kind === 'once' && job.dueAt !== undefined && now - job.dueAt > 24 * 3600_000) {
              store.remove(job.id);
              scheduleInFlight.delete(job.id);
              scheduleMissed.delete(job.id);
              logger.warn(`[schedule] 一次性任务过期清理 id=${job.id}`);
            }
          }
          for (const job of store.due(now)) {
            if (scheduleInFlight.has(job.id)) continue;
            scheduleInFlight.add(job.id);
            void (async () => {
              try {
                const ok = await manager.injectToPeer(job.scope, job.peerId, `[定时任务] ${job.prompt}`);
                if (ok) {
                  scheduleMissed.delete(job.id);
                  store.markDone(job.id);
                  logger.info(`[schedule] 触发 ok job=${job.id} kind=${job.kind} → ${job.scope}:${job.peerId}`);
                } else {
                  const n = (scheduleMissed.get(job.id) ?? 0) + 1;
                  if (n >= 3) {
                    scheduleMissed.delete(job.id);
                    store.setEnabled(job.id, false);
                    logger.warn(`[schedule] job=${job.id} 连续${n}次会话不在/注入失败, 已自动停用(可在设置重新启用)`);
                  } else {
                    scheduleMissed.set(job.id, n);
                    logger.warn(`[schedule] job=${job.id} 会话不在/注入失败 第${n}次, 下轮重试`);
                  }
                }
              } catch (err) {
                logger.warn?.(`[schedule] 触发异常 job=${job.id}: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                scheduleInFlight.delete(job.id);
              }
            })();
          }
        } catch (err) {
          logger.warn?.(`[schedule] tick 异常: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      // 会话自设定时 ticker: 5s 粒度(原 30s → 一次性任务延迟上限 30s 太大, 主人实测 11:35 任务 11:36 才发;
  // 任务量小 store 内存读, 5s 开销可忽略) → 延迟压到 ≤5s。
  scheduleTicker = setInterval(tickSchedule, 5_000);
      scheduleTicker.unref?.();
      logger.info(`[schedule] ticker 启动 (30s, dataDir=${scheduleDataDir})`);

      // botplay 过期卡定期清理(Phase2): 60s 扫一次, 防内存积压(卡默认最长 600s 存活)
      const botplaySweeper = setInterval(() => {
        try { botplayController?.sweepExpired(); } catch { /* ignore */ }
      }, 60_000);
      botplaySweeper.unref?.();

      return async () => {
        logger.info('Shutting down');
        registerApprovalController(myNs, undefined);
        registerQuestionController(myNs, undefined);
        registerBotplayController(myNs, undefined);
        setBotplayTriggerImpl(undefined);
        setBotplayCatalogImpl(undefined);
        registerSessionManager(myNs, undefined);
        approvalController?.dispose();
        questionController?.dispose();
        botplayController?.clear();
        stopScheduler?.();
        stopJoinPoll?.();
        if (scheduleTicker) { clearInterval(scheduleTicker); scheduleTicker = undefined; }
        clearInterval(botplaySweeper);
        flushStickerGate();
        await manager.disposeAll();
        bot.stop();
      };
    }, 'im-qqbot.lifecycle');
}
