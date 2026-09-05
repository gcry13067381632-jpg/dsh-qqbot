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
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
import { setupMiddlewares } from './middleware-setup.js';
import { configureStickerStore } from '../features/sticker-store.js';
import { initStickerGate, bindStickerGates, flushStickerGate, getStickerGate, StickerGateDenied } from '../features/sticker-gate.js';
import { startScheduler } from '../features/scheduler.js';
import { configureScheduleStore, getScheduleStore } from '../features/schedule-store.js';
import { setChannelBridge } from '../channel-tools.js';
import { QqApprovalController, setApprovalDispatch, makeApprovalListener } from '../features/qq-approval.js';
import { handleGroupJoinRequestEvent } from '../features/group-join-request.js';

export async function bootstrapGateway(
  ctx: Context,
  agents: DshAgentRegistry,
  config: ImQQBotConfig,
  logger: Logger,
): Promise<void> {
  const manager = new SessionManager(ctx, agents, config, logger);
  // QQ 远程审批控制器(enableApprovals 时创建; 定义在 sender 就绪后, 此处先声明供入站回调引用)
  let approvalController: QqApprovalController | undefined;

  // ── 表情包图库单例预初始化(防目录分裂) ──
  // ⚠️ 单例时序坑：谁先 getStickerStore 谁定路径。必须在启动早期按 config.cwd
  //    初始化，否则 list_stickers(无参)会以 process.cwd 建错目录(线上踩坑:C盘幽灵库)。
  const stickerDataDir = config.sticker.dataDir || join(config.cwd || process.cwd(), '表情包');
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
  const scheduleDataDir = join(config.cwd || process.cwd(), '.qqbot');
  configureScheduleStore(scheduleDataDir, logger);

  // ── 初始化 QQ Bot SDK ──
  const userAgent = buildUserAgent();
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
  setupMiddlewares(bot, config, manager, logger);

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
  const sender: QQBotSender = {
    sendMarkdown: async (target, content) => {
      try {
        const resp = (await bot.sendMarkdown(target, content)) as { id?: string } | undefined;
        pushSent(target, resp?.id);
        return resp;
      } catch (err) {
        // ── 主动推送被拒降级链(M3 定时等无 msgId 场景; 被动回复原样抛错) ──
        // 平台限制: markdown 主动消息常需专门权限; c2c 主动需 48h 互动窗, 窗口外拒收。
        // 降级顺序: sendMarkdown → sendText(纯文本主动) → c2c sendWakeup(is_wakeup 召回, 30天窗)。
        if (!target.msgId) {
          const plain = String(content || '')
            .replace(/[#*`_~>]/g, '')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
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
  };

  // 把发送能力注入 SessionManager，供 QQ 会话 provide qqChannel 服务给通道工具
  manager.installChannelSender(sender);
  // 全局桥: 通道工具 execute 的兜底解析(不依赖 setup/provide, 防重启后 setup 未跑)
  setChannelBridge({ manager, sender });

  // ── 入群申请事件(P2.5): 实时 GROUP_JOIN_REQUEST → 提醒 + pending 待办 ──
  // SDK 未知事件走 rawEvent 透传; 需 watchJoinRequests(构造时已扩 intents)才收得到。
  // 同一 bot 仅一个群管理实例; 事件带 group_openid, 天然按群路由。
  bot.on('rawEvent', (rawCtx: { eventType?: string; data?: unknown }) => {
    if (rawCtx.eventType !== 'GROUP_JOIN_REQUEST') return;
    logger.info(`[group-join] rawEvent GROUP_JOIN_REQUEST 到达`);
    void handleGroupJoinRequestEvent(rawCtx.data, { sender, config, logger, manager }).catch((err: unknown) => {
      logger.error(`[group-join] 事件处理异常: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  // ── QQ 远程审批: ACP 模式接入(专家考古实证, 见 qq-approval.ts 头注) ──
  // ①dispatch: ownership(只处理本 bot 的 agent)+ enableApprovals 闸门;
  // ②监听: 注册在插件 apply ctx, 用 {prepend:true} 插到链首(抢在宿主 GUI 转发器 dsh-api-remotes 之前)。
  approvalController = new QqApprovalController(manager, sender, logger, () => config.approvalTimeoutMs);
  setApprovalDispatch(((request: unknown, next: () => Promise<string>) => {
    if (!config.enableApprovals) return next();
    const reqAgent = (request as { agent?: unknown }).agent;
    if (!reqAgent || !manager.findByAgent(reqAgent as never)) return next(); // 非本 bot agent → 放行给 GUI/ACP
    return approvalController!.request(request as never, next as never);
  }) as never);
  (ctx as unknown as {
    on(event: string, handler: (...args: unknown[]) => unknown, config?: { prepend?: boolean }): void;
  }).on('approval/request', makeApprovalListener() as never, { prepend: true });
  console.log('[qq-approval] ACP-mode listener registered (apply-ctx + prepend)');
  logger.info(`[im-qqbot] QQ 远程审批接线就绪(${config.enableApprovals ? '已启用' : '默认关闭, Web 设置可热开'})`);

  const outboundHandler = createOutboundHandler(manager, sender, config, logger, toolsRegistry);
  (ctx as unknown as { on(event: string, handler: (...args: unknown[]) => void): void })
    .on('session/event', outboundHandler as (...args: unknown[]) => void);

  bot.on('error', (err: unknown) => {
    logger.error(`bot error: ${err instanceof Error ? err.message : String(err)}`);
  });

  bot.on('ready', () => {
    console.log(`[im-qqbot] Bot ready! appId=${config.appId}`);
  });

  // ── 生命周期 ──
  let stopScheduler: (() => void) | undefined;
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

      return async () => {
        logger.info('Shutting down');
        approvalController?.dispose();
        stopScheduler?.();
        if (scheduleTicker) { clearInterval(scheduleTicker); scheduleTicker = undefined; }
        flushStickerGate();
        await manager.disposeAll();
        bot.stop();
      };
    }, 'im-qqbot.lifecycle');
}
