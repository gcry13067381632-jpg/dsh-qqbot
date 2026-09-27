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
const TASK_TTL_MS = 7 * 24 * 3600 * 1000; // 任务记录保留 7 天(清理用)
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2_000; // 指数退避基数
function tasksPath(dataRoot) {
    return join(dataRoot, '.qqbot', 'broadcast-tasks.json');
}
function emptyStore() {
    return { tasks: [] };
}
function loadStore(dataRoot) {
    try {
        const raw = readFileSync(tasksPath(dataRoot), 'utf8');
        const o = JSON.parse(raw);
        if (o && Array.isArray(o.tasks))
            return o;
        return emptyStore();
    }
    catch {
        return emptyStore();
    }
}
function saveStore(dataRoot, store) {
    try {
        const dir = join(dataRoot, '.qqbot');
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        const file = tasksPath(dataRoot);
        const tmp = file + '.tmp-' + Date.now();
        writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
        renameSync(tmp, file);
    }
    catch { /* 落盘失败不影响主链 */ }
}
/** 清理过期任务(保留 7 天; 每次 list 时顺手做) */
function prune(store, now = Date.now()) {
    if (store.tasks.length <= 50)
        return; // 任务少时无所谓
    const before = store.tasks.length;
    store.tasks = store.tasks.filter((t) => now - (t.done_at ?? t.created_at) < TASK_TTL_MS);
    if (store.tasks.length !== before)
        store.tasks.sort((a, b) => b.created_at - a.created_at);
}
export function createTask(dataRoot, input) {
    const store = loadStore(dataRoot);
    const task = {
        task_id: 'bc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
        type: input.type,
        payload: { content: input.content, ...(input.keyboard ? { keyboard: input.keyboard } : {}) },
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
export function confirmTask(dataRoot, taskId) {
    const store = loadStore(dataRoot);
    const t = store.tasks.find((x) => x.task_id === taskId);
    if (!t || t.state !== 'draft')
        return t;
    t.state = 'queued';
    t.confirmed_at = Date.now();
    saveStore(dataRoot, store);
    return t;
}
export function cancelTask(dataRoot, taskId, by = 'dock') {
    const store = loadStore(dataRoot);
    const t = store.tasks.find((x) => x.task_id === taskId);
    if (!t)
        return t;
    if (t.state === 'sending') {
        // 发送中: 标记取消, 由推进循环在下一个目标前停下
        t.state = 'cancelled';
        t.cancelled_by = by;
        t.done_at = Date.now();
    }
    else if (t.state === 'queued' || t.state === 'draft') {
        t.state = 'cancelled';
        t.cancelled_by = by;
        t.done_at = Date.now();
    }
    saveStore(dataRoot, store);
    return t;
}
export function listTasks(dataRoot) {
    const store = loadStore(dataRoot);
    prune(store);
    saveStore(dataRoot, store);
    return store.tasks;
}
export function getTask(dataRoot, taskId) {
    return loadStore(dataRoot).tasks.find((x) => x.task_id === taskId);
}
/** 任务级推进锁(2026-09-10 修): host 后台定时器与 dock 的 list 请求可能同时推进同一任务,
 *  两边都读到「results 里该目标为空」→ 同一个目标被发两次(主人实测"点一次发两条")。
 *  用 Set 做进程内互斥: 同一任务同一时刻只允许一个推进在跑, 另一个直接返回当前快照。 */
const advancingTasks = new Set();
/**
 * 推进一个 queued/sending 任务(串行逐目标 + 失败退避重试)—— 带并发保护的外层入口。
 * 注意: 本函数是"单步推进"——由调用方(settings-host 定时器或每次请求)驱动,
 * 每步处理 1 个未完成目标; 若同一任务多次调用会串行推进, 天然限频。
 * 返回任务当前状态。
 */
export async function advanceTask(dataRoot, taskId, client, opts) {
    if (advancingTasks.has(taskId)) {
        return loadStore(dataRoot).tasks.find((x) => x.task_id === taskId);
    }
    advancingTasks.add(taskId);
    try {
        return await advanceTaskInner(dataRoot, taskId, client, opts);
    }
    finally {
        advancingTasks.delete(taskId);
    }
}
/** 实际推进逻辑(仅由带锁的 advanceTask 调用) */
async function advanceTaskInner(dataRoot, taskId, client, opts) {
    const store = loadStore(dataRoot);
    const t = store.tasks.find((x) => x.task_id === taskId);
    if (!t)
        return t;
    if (t.state === 'cancelled' || t.state === 'done')
        return t;
    if (t.state === 'draft')
        return t; // 未确认不推进
    // 找第一个未完成且未超重试的目标
    let idx = -1;
    for (let i = 0; i < t.targets.length; i++) {
        const tg = t.targets[i];
        const r = t.results[tg.peerId];
        if (!r) {
            idx = i;
            break;
        }
        if (!r.ok && (t.retries[tg.peerId] || 0) < MAX_RETRIES) {
            idx = i;
            break;
        }
    }
    if (idx === -1) {
        // 全部目标处理完(或全部失败达上限) → 终态
        const allOk = t.targets.every((tg2) => t.results[tg2.peerId]?.ok);
        t.state = allOk ? 'done' : 'partial_failed';
        t.done_at = Date.now();
        saveStore(dataRoot, store);
        return t;
    }
    if (t.state === 'queued')
        t.state = 'sending';
    const tg = t.targets[idx];
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
        // card 类型(markdown+按钮)走卡片接口; 其余走文本接口(2026-09-10)
        const sr = t.type === 'card'
            ? (tg.scope === 'group'
                ? await client.sendGroupCard(tg.peerId, t.payload.content, t.payload.keyboard)
                : await client.sendC2cCard(tg.peerId, t.payload.content, t.payload.keyboard))
            : (tg.scope === 'group'
                ? await client.sendGroupText(tg.peerId, t.payload.content)
                : await client.sendC2cText(tg.peerId, t.payload.content));
        if (sr.ok) {
            t.results[tg.peerId] = { ok: true, message_id: sr.data?.id };
        }
        else {
            t.retries[tg.peerId] = (t.retries[tg.peerId] || 0) + 1;
            t.results[tg.peerId] = { ok: false, err: sr.err.human };
        }
    }
    catch (e) {
        t.retries[tg.peerId] = (t.retries[tg.peerId] || 0) + 1;
        t.results[tg.peerId] = { ok: false, err: String(e?.message ?? e) };
    }
    saveStore(dataRoot, store);
    return t;
}
/** 撤回某任务发给指定目标的某条消息(2 分钟窗口, 由调用方做权限判断) */
export async function recallTaskMessage(dataRoot, taskId, peerId, client) {
    const t = getTask(dataRoot, taskId);
    if (!t)
        return { ok: false, err: '任务不存在' };
    const r = t.results[peerId];
    if (!r?.ok || !r.message_id)
        return { ok: false, err: '该目标没有可撤回的已发消息(未成功/无 message_id)' };
    // 官方撤回窗口 2 分钟
    const age = Date.now() - (t.done_at ?? Date.now());
    if (age > 2 * 60 * 1000)
        return { ok: false, err: '超过 2 分钟撤回窗口' };
    // 撤回路径按场景分(群/私聊), 从任务的 targets 里取该目标的 scope
    const scope = (t.targets.find((x) => x.peerId === peerId)?.scope) ?? 'group';
    try {
        const sr = await client.recallMessage(peerId, r.message_id, scope);
        return sr.ok ? { ok: true, message_id: r.message_id } : { ok: false, err: sr.err.human, message_id: r.message_id };
    }
    catch (e) {
        return { ok: false, err: String(e?.message ?? e), message_id: r.message_id };
    }
}
//# sourceMappingURL=broadcast.js.map