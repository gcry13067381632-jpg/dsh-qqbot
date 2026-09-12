/**
 * group-join-request.ts — 入群申请事件(GROUP_JOIN_REQUEST)监听与提醒 (P2.5, 2026-09-05)
 *
 * 官方事件事实(参考文档/qqbot-api-v2-docs/autogen__event__group_join_request.html):
 *   - 事件名 GROUP_JOIN_REQUEST, Intent = GROUP_MEMBER_EVENT (1<<24), 仅机器人=群管理员收到;
 *   - 事件体: group_openid / join_request_id / member_openid / username / apply_at /
 *     apply_source(self_apply|invited) / invited_by / risk_tips / verify_info / auto_approved(下行, 自动审批通过时带);
 *   - 说明: 拉取/审批 REST 走 group-admin.ts(GroupAdminClient), 这里只接"实时事件 → 提醒 + 待办落盘"。
 *
 * SDK 接线(勘察 2026-09-05): @tencent-connect/qqbot-nodejs 未枚举该事件, 但三层透传全通:
 *   QQBot options.intents(自定义, 默认 FULL_INTENTS 不含 1<<24)
 *     → gateway dispatchEvent 未知事件返 {action:'raw'} → onRawEvent → bot.on('rawEvent')。
 *   故订阅 = 构造 QQBot 时 intents 或上 1<<24 + 监听 rawEvent, SDK 零改动。
 *   若官方未授权该 intent, Identify 可能被拒(close 4914/4915)→ 用 config.groupAdmin.watchJoinRequests 开关, 默认关。
 *
 * 提醒通道: QQ member_openid ≠ c2c user_openid(无法由 owners 群身份推导私聊目标),
 *   故"提醒主人"落地 = ①在该群内发一条 bot 消息(群主/管理员即主人可见) + ②pending 待办落盘,
 *   UI ⑥区/P3 与群管理工具都能再读 pending; 全部动作走审计日志。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { QQBotSender } from '../transport/outbound-buffer.js';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
import type { SessionManager } from '../session/index.js';
import { notifyGroupHub, safeAppendUserMessage, joinDataDir, wakeSessionAgent, isHubPeerOf } from './group-hub.js';
import { dataRootOf } from '../gateway/data-root.js';
import { appendGroupMember } from './chat-ledger.js';
import { verifyHuman } from '../api/group-admin.js';

/** 官方 GROUP_JOIN_REQUEST 事件体(与本项目用到的字段) */
export interface GroupJoinRequestEvent {
  group_openid?: string;
  join_request_id?: string;
  member_openid?: string;
  username?: string;
  apply_at?: string;
  apply_source?: 'self_apply' | 'invited';
  invited_by?: string;
  risk_tips?: string;
  union_openid?: string;
  bot?: boolean;
  verify_info?: { method?: string; verify_message?: string; review_qa_list?: Array<{ question: string; answer: string }> };
  auto_approved?: { strategy_id?: string };
  [key: string]: unknown;
}

/** pending 待办条目(落盘, UI/工具可读) */
export interface PendingJoinRequest {
  group_openid: string;
  join_request_id: string;
  member_openid: string;
  username?: string;
  apply_at?: string;
  apply_source?: string;
  invited_by?: string;
  risk_tips?: string;
  verify_message?: string;
  /** 事件到达时间(本机 ISO) */
  seen_at: string;
  /** 是否已发过群内提醒 */
  notified: boolean;
}

/** pending 存储形状: 按群聚合, 每个群最多保留最近 50 条 */
interface PendingStore {
  [gid: string]: PendingJoinRequest[];
}

/** 内存去重(join_request_id)与群内提醒限频: 每群 5 分钟至多 1 条, 防风暴 */
const recentIds = new Map<string, number>();
const lastGroupNotify = new Map<string, number>();
const DEDUP_TTL_MS = 24 * 3600_000;
const GROUP_NOTIFY_MIN_GAP_MS = 300_000;
const MAX_PENDING_PER_GROUP = 50;

/** pending 文件路径({cwd}/.qqbot/join-pending.json, 与 groups.json 同目录) */
function pendingPath(cwd: string | undefined): string {
  return join(cwd || process.cwd(), '.qqbot', 'join-pending.json');
}

function loadPending(path: string): PendingStore {
  try {
    if (!existsSync(path)) return {};
    const raw = JSON.parse(readFileSync(path, 'utf8')) as PendingStore;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function savePending(path: string, store: PendingStore): void {
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(store, null, 1), 'utf8');
  } catch (err) {
    // 落盘失败不阻断主流程, 调用方已留审计
    void err;
  }
}

/** 追加一条 pending(按 join_request_id 去重, 最新在前) */
export function pushPendingJoinRequest(
  cwd: string | undefined,
  ev: PendingJoinRequest,
): void {
  const path = pendingPath(cwd);
  const store = loadPending(path);
  const gid = ev.group_openid;
  const list = store[gid] ?? [];
  const idx = list.findIndex((x) => x.join_request_id === ev.join_request_id);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(ev);
  store[gid] = list.slice(0, MAX_PENDING_PER_GROUP);
  savePending(path, store);
}

/** 读某群 pending(UI/工具用; gid 空 = 全部) */
export function readPendingJoinRequests(
  cwd: string | undefined,
  gid?: string,
): PendingJoinRequest[] {
  const store = loadPending(pendingPath(cwd));
  if (gid) return store[gid] ?? [];
  return Object.values(store).flat();
}

/**
 * 处理一条 GROUP_JOIN_REQUEST 事件(rawEvent 数据):
 *   ① auto_approved 下行(自动审批已通过)→ 仅记审计, 不打扰;
 *   ② 否则去重 → pending 落盘 → **注入该群 agent 的 inbox(next-step 队列, wakeup=false)**:
 *      - 等效"模拟用户消息 + 不触发模型回合"(dsh 底层: agent.inject = send(msg,'next-step',wakeup:false),
 *        区别于 followup 的唤醒; 消息持久化在会话, 等主人下一条真人消息开回合时同批进 AI 上下文)
 *      - 宿主 agent 无 inject 能力/无活跃会话 → 兜底发一条 QQ 群静态提醒卡片(不静默丢)
 * @returns true = 事件被消费(记录/注入), false = 忽略(重复或无效)
 */
export async function handleGroupJoinRequestEvent(
  data: unknown,
  opts: {
    sender: QQBotSender;
    config: ImQQBotConfig;
    logger: Logger;
    manager: SessionManager;
  },
): Promise<boolean> {
  const { sender, config, logger, manager } = opts;
  const ev = (data ?? {}) as GroupJoinRequestEvent;
  const gid = ev.group_openid;
  const jid = ev.join_request_id;
  const mid = ev.member_openid;
  if (!gid || !jid || !mid) {
    logger.warn(`[group-join] 事件缺关键字段, 忽略: ${JSON.stringify(ev).slice(0, 300)}`);
    return false;
  }

  // 内存去重(重启后事件极少重推, 内存足够)
  const now = Date.now();
  for (const [id, ts] of recentIds) {
    if (now - ts > DEDUP_TTL_MS) recentIds.delete(id);
  }
  if (recentIds.has(jid)) {
    logger.debug(`[group-join] 重复事件跳过: ${jid}`);
    return false;
  }
  recentIds.set(jid, now);

  // 持久化去重(2026-09-11 主人实测重复通知): 宿主重启后 recentIds 清空,
  // QQ 可能重推 GROUP_JOIN_REQUEST → 同一条申请被处理两次、双条通知;
  // pending 里同 join_request_id 已 notified(上次通知成功) → 视为重复跳过。
  try {
    const existed = readPendingJoinRequests(dataRootOf(config), gid).find((x) => x.join_request_id === jid);
    if (existed?.notified) {
      logger.info(`[group-join] 已通知过的重复事件跳过(重启重推): ${jid.slice(0, 16)}…`);
      return false;
    }
  } catch { /* 读失败不阻断(走正常流程) */ }

  // 自动审批下行: 只记审计, 不提醒(结果已确定, 无需管理员操作)
  if (ev.auto_approved && ev.auto_approved.strategy_id) {
    logger.info(`[group-join] 自动审批通过(下行): gid=${gid} user=${ev.username}(${mid}) strategy=${ev.auto_approved.strategy_id}`);
    return true;
  }

  const verify = verifyHuman(ev.verify_info);
  const item: PendingJoinRequest = {
    group_openid: gid,
    join_request_id: jid,
    member_openid: mid,
    username: ev.username,
    apply_at: ev.apply_at,
    apply_source: ev.apply_source,
    invited_by: ev.invited_by,
    risk_tips: ev.risk_tips,
    verify_message: verify,
    seen_at: new Date().toISOString(),
    notified: false,
  };
  pushPendingJoinRequest(dataRootOf(config), item);
  logger.info(`[group-join] 新入群申请: gid=${gid} user=${ev.username ?? '?'}(${mid.slice(0, 10)}…) src=${ev.apply_source ?? '?'}${ev.risk_tips ? ` risk=${ev.risk_tips}` : ''}`);

  // 入群申请者也是"见过的成员": 记入本地成员台账(名字留空, 进群后群内发言会补上; 2026-09-10 M3)
  try {
    appendGroupMember(joinDataDir(config), { ts: Date.now(), gid, mid, name: ev.username || undefined });
  } catch { /* 台账失败不阻断 */ }

  // 通知策略(主人定稿 2026-09-05 21:10 + M2 2026-09-09 扩展):
  // 要"模拟用户消息 + 模拟点停止" = 把申请 append 为目标会话的 session log 一条
  // user/message 事件(turn() 中让消息显示在 web 的那一步), 但【不 wake 不开回合】→
  // web 会话流能看到这条消息(像用户真发过), AI 却不会主动思考/回复(不撞 QQ 限流)。
  // 主人下条真人消息开新回合时, 这条 user/message 作为 log 历史被 deriveMessages 组装进
  // 上下文 → AI 自然看到申请并能接应"通过/拒绝"。
  // 🔒 硬约束(M2 主人指正): LLM 回合进行中严禁 session.append(拆散 tool_calls 坏记录),
  //    统一走 safeAppendUserMessage = whenIdle 等回合空闲再 append; 超时/无能力 → 兜底 QQ 卡。
  const srcPart = ev.apply_source === 'invited'
    ? `被邀请${ev.invited_by ? `(邀请人 ${ev.invited_by.slice(0, 10)}…)` : ''}`
    : '主动申请';
  const verifyPart = verify ? ` 验证「${verify}」` : '';
  const riskPart = ev.risk_tips ? ` ⚠️${ev.risk_tips}` : '';
  const summary = `[入群申请] ${ev.username ?? '(未知昵称)'}(${srcPart})${verifyPart}${riskPart}`;

  // ① 群组管理器(hub): 配置了 hubSessionId → 群事件汇总注入该会话; 成功则群内不再打扰
  const hubR = await notifyGroupHub(manager, config, logger, {
    kind: 'join_request',
    gid,
    memberOpenid: mid,
    name: ev.username,
    extra: verify ? `验证「${verify}」` : (ev.apply_source === 'invited' ? '被邀请' : undefined),
  });
  if (hubR === 'ok') {
    item.notified = true;
    pushPendingJoinRequest(dataRootOf(config), item);
    logger.info(`[group-join] 已转发群组管理器(hub) gid=${gid}`);
    // ⚠️ 2026-09-11 主人实测: hub 注入成功≠申请群不用通知。
    //    主人开「通知普通群/唤醒普通群AI」(pollJoinRequests 的开关, 与轮询总开关独立)时,
    //    期望申请所在群(非 hub 群)的 web 会话也收到: notifyGroup=注记, wakeGroup=唤醒。
    //    申请群就是 hub 群时跳过(hub 注记已覆盖, 避免同一会话重复)。
    const isHub = await isHubPeerOf(manager, config, 'group', gid);
    if (!isHub) {
      const pollOpts = config.groupAdmin?.pollJoinRequests;
      if (pollOpts?.notifyGroup || pollOpts?.wakeGroup) {
        let record = manager.findByPeer('group', gid);
        if (!record) {
          try {
            const target = { scope: 'group' as const, targetId: gid };
            record = await manager.getOrCreate('group', gid, mid, target);
            logger.info(`[group-join] 申请群会话不在, 已 getOrCreate 恢复 gid=${gid}`);
          } catch (err) {
            logger.warn(`[group-join] 申请群 getOrCreate 失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (record) {
          if (pollOpts.notifyGroup) {
            const r = await safeAppendUserMessage(record.agent, summary, logger);
            logger.info(`[group-join] 通知普通群(notifyGroup, 不唤醒): ${r} gid=${gid.slice(0, 8)}…`);
          }
          if (pollOpts.wakeGroup) {
            const w = await wakeSessionAgent(manager, record.sessionId, logger, `${summary}\n\n可回复我处理(如: 查看入群申请 / 通过 某人 / 拒绝 某人)`);
            logger.info(`[group-join] 唤醒普通群 AI(wakeGroup): ${w} gid=${gid.slice(0, 8)}…`);
          }
        }
      }
    } else {
      logger.info(`[group-join] 申请群即 hub 群, 不再额外通知(注记已在 hub) gid=${gid.slice(0, 8)}…`);
    }
    return true;
  }

  // ② 无 hub / 转发未成功 → 原群内提醒(回合安全 append; busy/fail 兜底 QQ 静态卡)
  if (config.groupAdmin?.notifyInGroup !== false) {
    const last = lastGroupNotify.get(gid) ?? 0;
    if (now - last >= GROUP_NOTIFY_MIN_GAP_MS) {
      lastGroupNotify.set(gid, now);
      // 有活跃会话直接用; 没有(空闲被回收)→ getOrCreate 恢复/重建会话(不触发回合, 只保证 log 存在)
      let record = manager.findByPeer('group', gid);
      if (!record) {
        try {
          const target = { scope: 'group' as const, targetId: gid };
          record = await manager.getOrCreate('group', gid, mid, target);
          logger.info(`[group-join] 会话不在, 已 getOrCreate 恢复 gid=${gid}`);
        } catch (err) {
          logger.warn(`[group-join] getOrCreate 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const safeR = await safeAppendUserMessage(record?.agent, summary, logger);
      if (safeR === 'ok') {
        item.notified = true;
        pushPendingJoinRequest(dataRootOf(config), item);
        logger.info(`[group-join] 已 append user/message 到会话 log(不唤醒, 模拟用户消息+停止) gid=${gid}`);
        return true;
      }
      logger.warn(`[group-join] 群内 append ${safeR}, 兜底发 QQ 卡片 gid=${gid}`);
      // 兜底: 无会话/append 不可用/回合忙 → 发一条静态群消息提醒(不静默丢)
      try {
        const target = { scope: 'group' as const, targetId: gid };
        await sender.sendMarkdown(target, `${summary}\n\n主人可回复让我查看/审批(如: 查看入群申请)。`);
        item.notified = true;
        pushPendingJoinRequest(dataRootOf(config), item);
      } catch (err) {
        logger.warn(`[group-join] 群内提醒发送失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return true;
}
