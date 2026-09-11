/**
 * poll-join-requests.ts — 入群申请轮询(2026-09-09 主人定, 事件驱动的兜底)
 *
 * 背景: GROUP_JOIN_REQUEST 事件订阅依赖"机器人为群管理员"且可能漏推(离线/没订阅)。
 * 轮询 = 定时拉取各群审批列表, 保证待审批申请**总能被注意到**。
 *
 * 逻辑(主人拍板, 与"攒批"分开判断):
 *   - 每 intervalMin 分钟拉取群注册表(groups.json)所有群的 join_request_list;
 *   - 对比 pending(join-pending.json)里已见过的 join_request_id → 找出【新增】申请;
 *   - **新增 ≥1 个就唤醒**(minCount 默认 1, 可调) —— 一天只来 1 个人也立刻被注意, 不攒死;
 *   - 攒批靠轮询周期天然聚合: intervalMin 内来的申请下次轮询一起报, 大量时不一条条吵;
 *   - 唤醒 = 伪造【审批轮询】入站消息走 handleInbound(与 scheduler 同款姿势):
 *     AI 看到待审批列表, 按主人指令通过/拒绝 —— 不自动批, 听主人的。
 *
 * ⚠️ 本地手改功能: 同步纪律同 middleware-setup(改完保持 src 与部署 dist 一致)。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
import type { SessionManager } from '../session/index.js';
import { pushPendingJoinRequest, type PendingJoinRequest } from './group-join-request.js';
import { notifyGroupHub, wakeHubAgent, safeAppendUserMessage, wakeSessionAgent } from './group-hub.js';
import { groupRegistryPath } from '../api/group-admin.js';
import { verifyHuman } from '../api/group-admin.js';
import { dataRootOf } from '../gateway/data-root.js';

/** 获取申请所在群会话(不在则 getOrCreate 恢复; 失败返回 undefined) */
async function groupRecOf(manager: SessionManager, gid: string, senderId: string) {
  let rec = manager.findByPeer('group', gid);
  if (!rec) {
    try {
      const target = { scope: 'group' as const, targetId: gid };
      rec = await manager.getOrCreate('group', gid, senderId, target);
    } catch { return undefined; }
  }
  return rec;
}

/** 轮询 tick: 30s 精度足够(分钟级间隔) */
const TICK_MS = 30_000;

/** 轮询状态(落盘防重启重复报): 记录每个群最近一次见过的 join_request_id 集合 */
interface PollState {
  /** gid -> 已见过的 join_request_id 集合(仅存 id, 紧凑) */
  seen: Record<string, string[]>;
  /** 每个群最近一次唤醒时刻(ms), 防连续轮询重复吵 */
  lastWakeAt: Record<string, number>;
}

function statePath(config: ImQQBotConfig): string {
  return join(dataRootOf(config), '.qqbot', 'join-poll-state.json');
}

function loadState(config: ImQQBotConfig): PollState {
  try {
    const p = statePath(config);
    if (!existsSync(p)) return { seen: {}, lastWakeAt: {} };
    const raw = JSON.parse(readFileSync(p, 'utf8')) as PollState;
    return {
      seen: raw?.seen ?? {},
      lastWakeAt: raw?.lastWakeAt ?? {},
    };
  } catch {
    return { seen: {}, lastWakeAt: {} };
  }
}

function saveState(config: ImQQBotConfig, s: PollState): void {
  try {
    const p = statePath(config);
    mkdirSync(join(p, '..'), { recursive: true });
    // 只保留最近 30 个群, 每群最近 200 个 seen id(防文件膨胀)
    const gids = Object.keys(s.seen).slice(0, 30);
    const seen: Record<string, string[]> = {};
    for (const g of gids) {
      const arr = s.seen[g];
      if (arr) seen[g] = arr.slice(0, 200);
    }
    writeFileSync(p, JSON.stringify({ seen, lastWakeAt: s.lastWakeAt }, null, 1), 'utf8');
  } catch { /* 落盘失败不阻断 */ }
}

/**
 * 启动入群申请轮询。config 为 live 引用(设置热更新即时生效); 返回 stop()。
 * 依赖: manager.groupAdmin(GroupAdminClient) + manager(会话寻址/hub)。
 */
export function startJoinRequestPolling(
  manager: SessionManager,
  config: ImQQBotConfig,
  logger: Logger,
): () => void {
  const state = loadState(config);

  function persist(): void {
    saveState(config, state);
  }

  /** 读群注册表 → 待轮询的群 gid 列表 */
  function registryGids(): string[] {
    try {
      const raw = readFileSync(groupRegistryPath(config.cwd), 'utf8');
      const obj = JSON.parse(raw) as Record<string, { name?: string }>;
      return obj ? Object.keys(obj) : [];
    } catch {
      return [];
    }
  }

  /** 从 join-pending.json 读已见过 id(与事件链路共享同一份, 互不重复报) */
  function pendingSeenIds(gid: string): Set<string> {
    const ids = new Set<string>();
    try {
      const p = join(dataRootOf(config), '.qqbot', 'join-pending.json');
      if (existsSync(p)) {
        const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, PendingJoinRequest[]>;
        for (const it of raw[gid] ?? []) if (it?.join_request_id) ids.add(it.join_request_id);
      }
    } catch { /* 读失败不阻断 */ }
    return ids;
  }

  /** 一次轮询: 拉各群审批列表, 发现新增 → 汇总唤醒 */
  async function pollOnce(): Promise<void> {
    const ga = config.groupAdmin;
    if (!ga?.enabled || !ga.pollJoinRequests?.enabled) return;
    const poll = ga.pollJoinRequests; // 非空: 上方已判 enabled
    const client = manager.groupAdmin;
    if (!client) {
      logger.warn?.('[join-poll] 群管理 client 未就绪, 跳过本轮');
      return;
    }
    const gids = registryGids();
    if (gids.length === 0) return;

    const now = Date.now();
    const newlyFound: Array<{ gid: string; items: PendingJoinRequest[] }> = [];

    for (const gid of gids) {
      try {
        const r = await client.listJoinRequests(gid);
        if (!r.ok) {
          // 常见: 机器人不是该群管理员(11703/403)或群已注销(11255) → 静默跳过, 不刷日志
          continue;
        }
        const list = r.data?.list ?? [];
        if (list.length === 0) continue;

        // 已见过的 = pending 里共享的 + 本群 state 里见过的
        const known = new Set<string>([...pendingSeenIds(gid), ...(state.seen[gid] ?? [])]);
        const fresh = list.filter((it) => it?.join_request_id && !known.has(it.join_request_id));

        // 更新 state.seen(见过即记, 无论是否唤醒)
        if (fresh.length > 0) {
          state.seen[gid] = [...(state.seen[gid] ?? []), ...fresh.map((f) => f.join_request_id!)].slice(0, 200);
          persist();
        }

        if (fresh.length === 0) continue;

        // 攒批防打扰: 同一群两次唤醒之间至少隔 intervalMin 分钟(新申请攒着下轮再报)
        const minGap = (poll.intervalMin ?? 5) * 60_000;
        const lastWake = state.lastWakeAt[gid] ?? 0;
        if (now - lastWake < minGap) {
          logger.info(`[join-poll] ${gid.slice(0, 8)}… 新增${fresh.length}条, 冷却中(距上次唤醒 ${Math.round((now - lastWake) / 1000)}s)暂缓`);
          continue;
        }

        // 组装待办条目(与事件链路同形, 落盘共享)
        const items: PendingJoinRequest[] = fresh.map((it) => ({
          group_openid: gid,
          join_request_id: it.join_request_id!,
          member_openid: it.member_openid!,
          username: it.username,
          apply_at: it.apply_at,
          apply_source: it.apply_source,
          invited_by: it.invited_by,
          risk_tips: it.risk_tips,
          verify_message: verifyHuman(it.verify_info),
          seen_at: new Date().toISOString(),
          notified: false,
        }));
        // 先落盘(即使本轮不唤醒, 下轮也认作"已见过", 不重复)
        for (const it of items) pushPendingJoinRequest(config.cwd, it);
        newlyFound.push({ gid, items });
      } catch (err) {
        logger.warn?.(`[join-poll] ${gid.slice(0, 8)}… 拉取失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (newlyFound.length === 0) return;

    // ── 汇总要唤醒的群: 满足 minCount 的才唤醒(默认 1 = 任何新增都唤醒) ──
    const minCount = poll.minCount ?? 1;
    const wakeTargets = newlyFound.filter((n) => n.items.length >= minCount);
    if (wakeTargets.length === 0) {
      logger.info(`[join-poll] 新增不足 minCount=${minCount}, 仅落盘不唤醒`);
      return;
    }

    const total = wakeTargets.reduce((acc, n) => acc + n.items.length, 0);
    const lines = [`【审批轮询】发现 ${total} 个新的入群申请:`];
    for (const { gid, items } of wakeTargets) {
      for (const it of items) {
        const src = it.apply_source === 'invited' ? '被邀请' : '主动申请';
        lines.push(`· ${it.username ?? '(未知昵称)'}(${src})${it.verify_message ? ` 验证「${it.verify_message}」` : ''}${it.risk_tips ? ` ⚠️${it.risk_tips}` : ''}`);
      }
      lines.push(`(群 …${gid.slice(-6)}; 回复我处理, 如: 通过 ${items[0]?.username ?? '该申请人'})`);
      state.lastWakeAt[gid] = now;
    }
    persist();
    const summary = lines.join('\n');

    // ── 注入策略(主人 2026-09-11 定稿): 四个独立开关, 各管一摊 ──
    //   wakeLlm      → 唤醒【群管会话】AI(hub agent 起来处理审批)
    //   hubNotify    → 注入群管会话(web 可见, 不唤醒; 与 wakeLlm 互斥——唤醒优先)
    //   notifyGroup  → 通知普通群(申请所在群会话 append 一条, web 可见, 不唤醒 AI)
    //   wakeGroup    → 唤醒【普通群】AI(申请所在群会话的 AI 起来处理; 2026-09-11 主人要求拆分)
    const first = wakeTargets[0];
    if (first) {
      if (poll.wakeLlm !== false) {
        // 唤醒群组管理器会话的 AI(带完整明细): 主人 web 这边 AI 起来查列表/处理
        // summary 首行已含「【审批轮询】发现 N 个…」标题, 这里不再重复拼
        const wakeText = `${summary}\n\n可回复我处理(如: 查看入群申请 / 通过 某人 / 拒绝 某人)`;
        const w = await wakeHubAgent(manager, config, logger, wakeText);
        logger.info(`[join-poll] 唤醒 hub agent: ${w}`);
      } else {
        // 不唤醒 → hub 注入带完整明细(web 可见不 wake, 信息不丢)
        if (poll.hubNotify !== false) {
          const hubR = await notifyGroupHub(manager, config, logger, {
            kind: 'join_request',
            gid: first.gid,
            memberOpenid: first.items[0]?.member_openid,
            name: first.items[0]?.username,
            extra: summary,
          });
          logger.info(`[join-poll] hub 注入(带明细): ${hubR}`);
        } else {
          logger.info(`[join-poll] wakeLlm=false 且 hubNotify=false, 仅落盘`);
        }
      }
      // 通知普通群(独立开关, 默认 false): 申请所在群会话 append 一条(web 可见, **不唤醒 AI**)
      // 2026-09-11 主人要求拆分: 原实现走 handleInbound 会唤醒普通群 AI 并可能发 QQ 消息;
      // 现在「通知普通群」只做 web 可见, 唤醒由独立开关 wakeGroup 控制。
      if (poll.notifyGroup !== false) {
        const rec = await groupRecOf(manager, first.gid, first.items[0]?.member_openid ?? 'master');
        if (rec) {
          const r = await safeAppendUserMessage(rec.agent, summary, logger);
          logger.info(`[join-poll] 普通群已通知(notifyGroup, 不唤醒): ${r}`);
        } else {
          logger.warn?.(`[join-poll] 普通群会话不可用(notifyGroup 跳过): ${first.gid.slice(0, 8)}…`);
        }
      }
      // 唤醒普通群 AI(独立开关, 默认 false): followup 申请所在群会话的 AI
      // 2026-09-11 主人确认: 【入群申请】=消息注记(不唤醒), 【审批轮询】=系统提醒(唤醒), 两者不同用途, 不互斥不去重。
      if (poll.wakeGroup !== false) {
        const rec = await groupRecOf(manager, first.gid, first.items[0]?.member_openid ?? 'master');
        if (rec) {
          const w = await wakeSessionAgent(manager, rec.sessionId, logger, `${summary}\n\n可回复我处理(如: 查看入群申请 / 通过 某人 / 拒绝 某人)`);
          logger.info(`[join-poll] 唤醒普通群 AI: ${w}`);
        } else {
          logger.warn?.(`[join-poll] 普通群会话不可用(wakeGroup 跳过): ${first.gid.slice(0, 8)}…`);
        }
      }
    }
  }

  const timer = setInterval(() => { void pollOnce(); }, TICK_MS);
  timer.unref?.();
  void pollOnce();
  const poll = config.groupAdmin?.pollJoinRequests;
  logger.info(`[join-poll] started (enabled=${poll?.enabled} interval=${poll?.intervalMin}min minCount=${poll?.minCount} wakeLlm=${poll?.wakeLlm} hubNotify=${poll?.hubNotify} notifyGroup=${poll?.notifyGroup} wakeGroup=${poll?.wakeGroup})`);

  return () => {
    clearInterval(timer);
    persist();
    logger.info('[join-poll] stopped');
  };
}
