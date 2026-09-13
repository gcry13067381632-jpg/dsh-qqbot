/**
 * intimacy-ledger.ts — 亲密度**日报台账**（2026-09-13 主人定, 用来出《本周亲密度小报》）
 *
 * 为什么再记一份: `affinity.json` 是**累计**计数(一辈子总和), 出不了"本周"这种窗口;
 *   这里按**天**分桶, 每桶记每人当天的可观测量 → 出小报时按最近 N 天求和即可。
 *
 * 只记**肉眼可核的事实**(不记内容、不记语义, 群里随时能核对):
 *   · msgs     当天说了多少条
 *   · mentions 当天点名她多少次
 *   · replies  当天"接她的话"多少次(本地小模型判定相关度 ≥ 0.6)
 *   · imgs     当天发的图/表情包多少张(投喂度)
 *
 * 存储: `{dataRoot}/.qqbot/intimacy-daily.json`
 *   `{ "days": { "2026-09-13": { "group:<gid>|<senderId>": { name, msgs, mentions, replies, imgs } } } }`
 * 保留: 最近 {@link KEEP_DAYS} 天(默认 14), 更早的自动丢 —— 文件永远是几十 KB 级别。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 保留天数(14 天: 够出"本周"和"上周对比") */
export const KEEP_DAYS = 14;

export interface DayCell {
  name?: string;
  msgs: number;
  mentions: number;
  replies: number;
  imgs: number;
}

interface LedgerFile {
  days: Record<string, Record<string, DayCell>>;
}

const cache = new Map<string, LedgerFile>();

function pathOf(dataRoot: string): string {
  return join(dataRoot, '.qqbot', 'intimacy-daily.json');
}

function todayKey(now = Date.now()): string {
  const d = new Date(now);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function load(dataRoot: string): LedgerFile {
  const hit = cache.get(dataRoot);
  if (hit) return hit;
  let data: LedgerFile = { days: {} };
  try {
    const raw = JSON.parse(readFileSync(pathOf(dataRoot), 'utf8')) as LedgerFile;
    if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') data = { days: raw.days };
  } catch { /* 首次/损坏 → 空台账 */ }
  cache.set(dataRoot, data);
  return data;
}

function prune(data: LedgerFile): void {
  const keys = Object.keys(data.days).sort();
  if (keys.length <= KEEP_DAYS) return;
  for (const k of keys.slice(0, keys.length - KEEP_DAYS)) delete data.days[k];
}

function save(dataRoot: string, data: LedgerFile): void {
  try {
    const p = pathOf(dataRoot);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(data), 'utf8');
  } catch { /* 记不上不影响主链 */ }
}

/** 记一条(每条群消息调一次): key = `group:<gid>|<senderId>` */
export function touchDaily(
  dataRoot: string,
  gid: string,
  senderId: string,
  opts: { name?: string; mention?: boolean; reply?: boolean; img?: boolean } = {},
): void {
  if (!dataRoot || !gid || !senderId) return;
  try {
    const data = load(dataRoot);
    const day = todayKey();
    const bucket = (data.days[day] ??= {});
    const key = `group:${gid}|${senderId}`;
    const cell = (bucket[key] ??= { msgs: 0, mentions: 0, replies: 0, imgs: 0 });
    cell.msgs += 1;
    if (opts.mention) cell.mentions += 1;
    if (opts.reply) cell.replies += 1;
    if (opts.img) cell.imgs += 1;
    if (opts.name) cell.name = String(opts.name).slice(0, 40);
    prune(data);
    save(dataRoot, data);
  } catch { /* ignore */ }
}

export interface WeeklyRow {
  key: string;
  name?: string;
  msgs: number;
  mentions: number;
  replies: number;
  imgs: number;
  /** 有互动的天数(体现"常来"还是"来一次爆刷") */
  activeDays: number;
}

/** 汇总最近 days 天(默认 7)的每人数据, 按 msgs 降序 */
export function weeklyRows(dataRoot: string, days = 7, now = Date.now()): WeeklyRow[] {
  const data = load(dataRoot);
  const dayKeys: string[] = [];
  for (let i = 0; i < days; i += 1) dayKeys.push(todayKey(now - i * 86400_000));
  const agg = new Map<string, WeeklyRow & { daySet: Set<string> }>();
  for (const dk of dayKeys) {
    const bucket = data.days[dk];
    if (!bucket) continue;
    for (const [key, cell] of Object.entries(bucket)) {
      const cur = agg.get(key) ?? { key, name: cell.name, msgs: 0, mentions: 0, replies: 0, imgs: 0, activeDays: 0, daySet: new Set<string>() };
      cur.msgs += cell.msgs;
      cur.mentions += cell.mentions;
      cur.replies += cell.replies;
      cur.imgs += cell.imgs;
      cur.name = cell.name || cur.name;
      cur.daySet.add(dk);
      agg.set(key, cur);
    }
  }
  return [...agg.values()]
    .map((x) => ({ ...x, activeDays: x.daySet.size }))
    .sort((a, b) => b.msgs - a.msgs);
}

/** 台账文件路径(脚本/面板用) */
export function ledgerPathOf(dataRoot: string): string {
  return pathOf(dataRoot);
}
