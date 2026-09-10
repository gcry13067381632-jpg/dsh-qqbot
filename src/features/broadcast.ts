/**
 * broadcast.ts — 群发任务队列(M3, 2026-09-10 新增, 设计见 参考文档/群组管理_设计稿_20260909.md §3.3)
 *
 * 群发不是即时操作, 是持久化任务状态机:
 *   draft → queued → sending → partial_failed → done / cancelled
 *   - 逐目标推进(串行), 单个失败进重试桶(指数退避, 上限 3), 可中止;
 *   - 已发消息记录 message_id, 2 分钟内可撤回(官方撤回窗口);
 *   - 文件: {dataDir}/.qqbot/broadcast-tasks.json(与 join-pending 同目录)。
 *
 * ⚠️ 本地手改功能: 同步纪律同 group-admin(改完保持 src 与部署 dist 一致)。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { GroupAdminClient } from '../api/group-admin.js';

/** 任务状态 */
export type BroadcastState = 'draft' | 'queued' | 'sending' | 'partial_failed' | 'done' | 'cancelled';
/** 目标类型 */
export type BroadcastTarget = { scope: 'group' | 'c2c'; peerId: string; name?: string };

export interface BroadcastTask {
  task_id: string;
  type: 'text' | 'markdown';
  payload: { content: string };
  targets: BroadcastTarget[];
  state: BroadcastState;
  /** 逐目标结果: peerId → { ok, message_id?, err? } */
  results: Record<string, { ok: boolean; message_id?: string; err?: string }>;
  retries: Record<string, number>;
  created_at: number;
  created_by: 'dock' | 'agent';
  confirmed_at?: number;
  done_at?: number;
  cancelled_by?: string;
}

export interface BroadcastStore {
  tasks: BroadcastTask[];
}

const TASK_TTL_MS = 7 * 24 * 3600 * 1000; // 任务记录保留 7 天(清理用)
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2_000; // 指数退避基数

function tasksPath(dataRoot: string): string {
  return join(dataRoot, '.qqbot', 'broadcast-tasks.json');
}

function emptyStore(): BroadcastStore {
  return { tasks: [] };
}

function loadStore(dataRoot: string): BroadcastStore {
  try {
    const raw = readFileSync(tasksPath(dataRoot), 'utf8');
    const o = JSON.parse(raw) as BroadcastStore;
    if (o && Array.isArray(o.tasks)) return o;
    return emptyStore();
  } catch {
    return emptyStore();
  }
}

function saveStore(dataRoot: string, store: BroadcastStore): void {
  try {
    const dir = join(dataRoot, '.qqbot');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = tasksPath(dataRoot);
    const tmp = file + '.tmp-' + Date.now();
    writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    renameSync(tmp, file);
  } catch { /* 落盘失败不影响主链 */ }
}

/** 清理过期任务(保留 7 天; 每次 list 时顺手做) */
function prune(store: BroadcastStore, now = Date.now()): void {
  if (store.tasks.length <= 50) return; // 任务少时无所谓
  const before = store.tasks.length;
  store.tasks = store.tasks.filter((t) => now - (t.done_at ?? t.created_at) < TASK_TTL_MS);
  if (store.tasks.length !== before) store.tasks.sort((a, b) => b.created_at - a.created_at);
}

export function createTask(dataRoot: string, input: { type: 'text' | 'markdown'; content: string; targets: BroadcastTarget[]; created_by: 'dock' | 'agent' }): BroadcastTask {
  const store = loadStore(dataRoot);
  const task: BroadcastTask = {
    task_id: 'bc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    type: input.type,
    payload: { content: input.content },
    targets: input.targets,
    state: 'draft',
    results: {},
    retries: {},
    created_at: Date.now(),
    created_by: input.created_by,
  };
  store.tasks.unshift(task);
  saveStore(dataRoot, store);
  return task;
}

export function confirmTask(dataRoot: string, taskId: string): BroadcastTask | undefined {
  const store = loadStore(dataRoot);
  const t = store.tasks.find((x) => x.task_id === taskId);
  if (!t || t.state !== 'draft') return t;
  t.state = 'queued';
  t.confirmed_at = Date.now();
  saveStore(dataRoot, store);
  return t;
}

export function cancelTask(dataRoot: string, taskId: string, by = 'dock'): BroadcastTask | undefined {
  const store = loadStore(dataRoot);
  const t = store.tasks.find((x) => x.task_id === taskId);
  if (!t) return t;
  if (t.state === 'sending') {
    // 发送中: 标记取消, 由推进循环在下一个目标前停下
    t.state = 'cancelled';
    t.cancelled_by = by;
    t.done_at = Date.now();
  } else if (t.state === 'queued' || t.state === 'draft') {
    t.state = 'cancelled';
    t.cancelled_by = by;
    t.done_at = Date.now();
  }
  saveStore(dataRoot, store);
  return t;
}

export function listTasks(dataRoot: string): BroadcastTask[] {
  const store = loadStore(dataRoot);
  prune(store);
  saveStore(dataRoot, store);
  return store.tasks;
}

export function getTask(dataRoot: string, taskId: string): BroadcastTask | undefined {
  return loadStore(dataRoot).tasks.find((x) => x.task_id === taskId);
}

/**
 * 推进一个 queued/sending 任务(串行逐目标 + 失败退避重试)。
 * 注意: 本函数是"单步推进"——由调用方(settings-host 定时器或每次请求)驱动,
 * 每步处理 1 个未完成目标; 若同一任务多次调用会串行推进, 天然限频。
 * 返回任务当前状态。
 */
export async function advanceTask(
  dataRoot: string,
  taskId: string,
  client: GroupAdminClient,
  opts?: { isCancelled?: () => boolean },
): Promise<BroadcastTask | undefined> {
  const store = loadStore(dataRoot);
  const t = store.tasks.find((x) => x.task_id === taskId);
  if (!t) return t;
  if (t.state === 'cancelled' || t.state === 'done') return t;
  if (t.state === 'draft') return t; // 未确认不推进

  // 找第一个未完成且未超重试的目标
  let idx = -1;
  for (let i = 0; i < t.targets.length; i++) {
    const tg = t.targets[i]!;
    const r = t.results[tg.peerId];
    if (!r) { idx = i; break; }
    if (!r.ok && (t.retries[tg.peerId] || 0) < MAX_RETRIES) { idx = i; break; }
  }
  if (idx === -1) {
    // 全部目标处理完(或全部失败达上限) → 终态
    const allOk = t.targets.every((tg2) => t.results[tg2.peerId]?.ok);
    t.state = allOk ? 'done' : 'partial_failed';
    t.done_at = Date.now();
    saveStore(dataRoot, store);
    return t;
  }
  if (t.state === 'queued') t.state = 'sending';

  const tg = t.targets[idx]!;
  // 退避: 第 n 次重试前等 RETRY_BASE_MS * 2^(n-1)(首次失败的重试也适用)
  const rn = t.retries[tg.peerId] || 0;
  if (rn > 0) {
    const wait = RETRY_BASE_MS * Math.pow(2, rn - 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 30_000)));
  }
  if (opts?.isCancelled?.()) {
    t.state = 'cancelled';
    t.cancelled_by = 'operator';
    t.done_at = Date.now();
    saveStore(dataRoot, store);
    return t;
  }

  try {
    const sr = tg.scope === 'group'
      ? await client.sendGroupText(tg.peerId, t.payload.content)
      : await client.sendC2cText(tg.peerId, t.payload.content);
    if (sr.ok) {
      t.results[tg.peerId] = { ok: true, message_id: (sr.data as { id?: string })?.id };
    } else {
      t.retries[tg.peerId] = (t.retries[tg.peerId] || 0) + 1;
      t.results[tg.peerId] = { ok: false, err: sr.err.human };
    }
  } catch (e) {
    t.retries[tg.peerId] = (t.retries[tg.peerId] || 0) + 1;
    t.results[tg.peerId] = { ok: false, err: String((e as Error)?.message ?? e) };
  }
  saveStore(dataRoot, store);
  return t;
}

/** 撤回某任务发给指定目标的某条消息(2 分钟窗口, 由调用方做权限判断) */
export async function recallTaskMessage(
  dataRoot: string,
  taskId: string,
  peerId: string,
  client: GroupAdminClient,
): Promise<{ ok: boolean; err?: string; message_id?: string }> {
  const t = getTask(dataRoot, taskId);
  if (!t) return { ok: false, err: '任务不存在' };
  const r = t.results[peerId];
  if (!r?.ok || !r.message_id) return { ok: false, err: '该目标没有可撤回的已发消息(未成功/无 message_id)' };
  // 官方撤回窗口 2 分钟
  const age = Date.now() - (t.done_at ?? Date.now());
  if (age > 2 * 60 * 1000) return { ok: false, err: '超过 2 分钟撤回窗口' };
  try {
    const sr = await client.recallMessage(r.message_id);
    return sr.ok ? { ok: true, message_id: r.message_id } : { ok: false, err: sr.err.human, message_id: r.message_id };
  } catch (e) {
    return { ok: false, err: String((e as Error)?.message ?? e), message_id: r.message_id };
  }
}
