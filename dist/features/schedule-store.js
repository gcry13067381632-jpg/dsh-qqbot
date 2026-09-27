/**
 * schedule-store.ts — QQ 会话自我定时任务(一次性/每日)存储与调度
 *
 * AI(QQ 会话内)可给自己安排定时提醒/任务: 到点后把 prompt 注入原会话(followup),
 * 她会像收到新消息一样处理并回复到 QQ(带群聊上下文)。
 * 数据落盘 {dataDir}/timers.json, 重启不丢; bootstrap 启动一个 30s ticker 驱动。
 * 类型: once(一次性: seconds 相对秒 或 atTime 今天某时) / daily(每天 HH:MM)。
 *
 * ⚠️ 本地手改功能(fork 新增)。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
const FILE_NAME = 'timers.json';
/** 最小相对秒(与 ticker 粒度对齐) */
const MIN_SECONDS = 30;
/** 单会话(scope:peer)最多启用的任务数 */
const MAX_PER_PEER = 20;
/** 全局任务总数上限 */
const MAX_GLOBAL = 200;
/** 解析 HH:MM → 当天该时刻 ms; 已过则明天 */
function dueAtFromHHMM(hhmm, base = Date.now()) {
    const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
    if (!m)
        return NaN;
    const h = Math.min(23, Number(m[1]));
    const min = Math.min(59, Number(m[2]));
    const d = new Date(base);
    d.setHours(h, min, 0, 0);
    if (d.getTime() <= base)
        d.setDate(d.getDate() + 1); // 已过 → 明天
    return d.getTime();
}
export class ScheduleStore {
    jobs = [];
    saveTimer = null;
    dirty = false;
    dataDir;
    logger;
    constructor(dataDir, logger) {
        this.dataDir = dataDir;
        this.logger = logger;
        mkdirSync(dataDir, { recursive: true });
        this.load();
    }
    file() {
        return join(this.dataDir, FILE_NAME);
    }
    load() {
        try {
            const p = this.file();
            if (existsSync(p)) {
                const raw = JSON.parse(readFileSync(p, 'utf8'));
                this.jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
            }
        }
        catch {
            this.jobs = [];
        }
    }
    save() {
        this.dirty = true;
        if (this.saveTimer)
            return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            if (!this.dirty)
                return;
            this.dirty = false;
            try {
                const p = this.file();
                const tmp = `${p}.tmp`;
                writeFileSync(tmp, JSON.stringify({ version: 1, jobs: this.jobs }, null, 2), 'utf8');
                renameSync(tmp, p);
            }
            catch (err) {
                this.logger?.warn?.(`[schedule] save failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }, 300);
    }
    flush() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (!this.dirty)
            return;
        this.dirty = false;
        try {
            writeFileSync(this.file(), JSON.stringify({ version: 1, jobs: this.jobs }, null, 2), 'utf8');
        }
        catch { /* ignore */ }
    }
    /** 新建任务; 返回 {ok, id?, error?}。kind 缺省: atTime 且无 seconds→daily, 否则 once */
    add(input) {
        const kind = input.kind ?? (input.atTime && !input.seconds ? 'daily' : 'once');
        const now = Date.now();
        const seconds = Number(input.seconds);
        const hasSec = Number.isFinite(seconds) && seconds > 0;
        const hasAt = /^(\d{1,2}):(\d{2})$/.test((input.atTime ?? '').trim());
        const key = `${input.scope}:${input.peerId}`;
        if (kind === 'once' && hasSec && seconds < MIN_SECONDS)
            return { ok: false, error: `seconds 不能小于 ${MIN_SECONDS} 秒` };
        if (!hasSec && !hasAt)
            return { ok: false, error: 'seconds 与 atTime 至少要给一个' };
        if (kind === 'daily' && !hasAt)
            return { ok: false, error: '每日任务需提供 atTime(几点几分 HH:MM)' };
        if (hasAt && !/^(\d{1,2}):(\d{2})$/.test((input.atTime ?? '').trim()))
            return { ok: false, error: 'atTime 格式应为 HH:MM(如 08:30)' };
        if (kind !== 'once' && kind !== 'daily')
            return { ok: false, error: 'kind 只能为 once 或 daily' };
        // 配额
        const perPeer = this.jobs.filter(j => `${j.scope}:${j.peerId}` === key && j.enabled).length;
        if (perPeer >= MAX_PER_PEER)
            return { ok: false, error: `该会话定时任务已达上限(${MAX_PER_PEER}条)` };
        if (this.jobs.filter(j => j.enabled).length >= MAX_GLOBAL)
            return { ok: false, error: `定时任务总数已达上限(${MAX_GLOBAL}条)` };
        // 去重: 同一会话同一条 daily(同 atTime)不重复建
        if (kind === 'daily') {
            const dup = this.jobs.find(j => j.kind === 'daily' && `${j.scope}:${j.peerId}` === key && j.atTime === input.atTime.trim() && j.enabled);
            if (dup)
                return { ok: false, error: `已存在相同每日任务(每天 ${dup.atTime}), 请删除后再建` };
        }
        const job = {
            id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            kind,
            scope: input.scope,
            peerId: input.peerId,
            prompt: (input.prompt ?? '').slice(0, 800),
            createdAt: now,
            enabled: true,
            ...(hasAt ? { atTime: input.atTime.trim() } : {}),
            ...(kind === 'once' ? { dueAt: hasSec && hasAt ? Math.min(now + seconds * 1000, dueAtFromHHMM(input.atTime.trim(), now)) : hasSec ? now + seconds * 1000 : dueAtFromHHMM(input.atTime.trim(), now) } : {}),
        };
        if (!job.prompt)
            return { ok: false, error: 'prompt 不能为空' };
        this.jobs.push(job);
        this.save();
        return { ok: true, id: job.id };
    }
    get(id) {
        return this.jobs.find(j => j.id === id);
    }
    /** 下次触发时间戳(用于展示; once=dueAt, daily=今天该点(已过则明天); 禁用/null) */
    nextFireAt(job, now = Date.now()) {
        if (!job.enabled)
            return null;
        if (job.kind === 'once')
            return job.dueAt ?? null;
        const mm = /^(\d{1,2}):(\d{2})$/.exec(job.atTime ?? '');
        if (!mm)
            return null;
        const d = new Date(now);
        d.setHours(Math.min(23, Number(mm[1])), Math.min(59, Number(mm[2])), 0, 0);
        const today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        if (job.lastRunDate === today || d.getTime() <= now)
            d.setDate(d.getDate() + 1);
        return d.getTime();
    }
    list() {
        return this.jobs.slice().sort((a, b) => (a.createdAt - b.createdAt));
    }
    remove(id) {
        const i = this.jobs.findIndex(j => j.id === id);
        if (i < 0)
            return false;
        this.jobs.splice(i, 1);
        this.save();
        return true;
    }
    /** 当前应触发的任务(由 ticker 调用) */
    due(now = Date.now()) {
        const today = new Date(now);
        const ymd = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
        const curMin = today.getHours() * 60 + today.getMinutes();
        return this.jobs.filter(j => {
            if (!j.enabled)
                return false;
            if (j.kind === 'once')
                return j.dueAt !== undefined && j.dueAt <= now;
            // daily: 到 HH:MM 且今天还没跑过
            const mm = /^(\d{1,2}):(\d{2})$/.exec(j.atTime ?? '');
            if (!mm)
                return false;
            const target = Math.min(23, Number(mm[1])) * 60 + Math.min(59, Number(mm[2]));
            return curMin >= target && j.lastRunDate !== ymd;
        });
    }
    /** 触发后记账: once 删除; daily 记今天 */
    markDone(id) {
        const j = this.jobs.find(x => x.id === id);
        if (!j)
            return;
        if (j.kind === 'once') {
            const i = this.jobs.indexOf(j);
            if (i >= 0)
                this.jobs.splice(i, 1);
        }
        else {
            const d = new Date();
            j.lastRunDate = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        }
        this.save();
    }
    setEnabled(id, enabled) {
        const j = this.jobs.find(x => x.id === id);
        if (!j)
            return false;
        j.enabled = enabled;
        this.save();
        return true;
    }
}
// ── 多例注册表(多账号支持, 2026-09-03): 每账号实例一个 dataDir({cwd}/.qqbot) → 各自定时任务。
// ⚠️ 2026-09-11 B类修复: 单例时序坑同 sticker-store —— primary 按实例(ns)各记一份。
const _stores = new Map();
const _primaryByNs = new Map();
let _primaryDir;
/** 配置定时任务实例(启动早期每账号按自己 dataDir 预初始化; 同目录幂等)。ns=实例标识。 */
export function configureScheduleStore(dataDir, logger, ns) {
    const key = resolve(dataDir);
    let s = _stores.get(key);
    if (!s) {
        s = new ScheduleStore(dataDir, logger);
        _stores.set(key, s);
    }
    if (!_primaryDir)
        _primaryDir = key;
    if (ns)
        _primaryByNs.set(ns, key);
    return s;
}
/** 获取实例。带 dataDir → 按目录取(不在则容错新建); 带 ns → 按该实例 primary; 无参 → 全局 primary。 */
export function getScheduleStore(dataDir, logger, ns) {
    if (dataDir) {
        const key = resolve(dataDir);
        let s = _stores.get(key);
        if (!s) {
            s = new ScheduleStore(dataDir, logger);
            _stores.set(key, s);
        }
        return s;
    }
    if (ns) {
        const p = _primaryByNs.get(ns);
        if (p) {
            const s = _stores.get(p);
            if (s)
                return s;
        }
    }
    if (_primaryDir) {
        const s = _stores.get(_primaryDir);
        if (s)
            return s;
    }
    if (_stores.size === 1)
        return _stores.values().next().value;
    const dir = join(process.cwd(), '.qqbot');
    const s = new ScheduleStore(dir, logger);
    _stores.set(resolve(dir), s);
    if (!_primaryDir)
        _primaryDir = resolve(dir);
    if (ns)
        _primaryByNs.set(ns, resolve(dir));
    return s;
}
//# sourceMappingURL=schedule-store.js.map