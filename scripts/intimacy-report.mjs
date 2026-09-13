/**
 * intimacy-report.mjs — 生成《本周亲密度小报》(纯文字, 直接可贴群里)
 *
 * 数据源: `{dataRoot}/.qqbot/intimacy-daily.json`
 *   （由插件 `src/features/intimacy-ledger.ts` 每条群消息累计写入; 按天分桶, 保留 14 天）
 *
 * 用法:
 *   node scripts/intimacy-report.mjs                                   # 默认 7 天, dataRoot 取 ~/.dsh 常见位置需显式给
 *   node scripts/intimacy-report.mjs --dataRoot D:\xxx\dshqqbot --days 7
 *   node scripts/intimacy-report.mjs --dataRoot ... --json              # 只输出 JSON(给程序用)
 *
 * 小报只印**肉眼可核的事实**(说了几条 / 点名她几次 / 接她话几次 / 投喂几张图),
 * 不印分数、不印排名猜测 —— 群友看到就能说"这条不对", 那才有校准价值。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}

const dataRoot = arg('dataRoot', join(homedir(), '.dsh', 'qqbot-data'));
const days = Math.max(1, Math.min(14, Number(arg('days', '7')) || 7));
const wantJson = process.argv.includes('--json');

const file = join(dataRoot, '.qqbot', 'intimacy-daily.json');
let data = { days: {} };
let ledgerMissing = false;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  ledgerMissing = true; // 日报台账还没开始记(刚上线的功能) → 退回"累计版"(affinity.json)
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const inWindow = [];
for (let i = 0; i < days; i += 1) inWindow.push(dayKey(Date.now() - i * 86400000));

const agg = new Map();
for (const dk of inWindow) {
  const bucket = (data.days || {})[dk];
  if (!bucket) continue;
  for (const [key, cell] of Object.entries(bucket)) {
    const cur = agg.get(key) || { key, name: cell.name, msgs: 0, mentions: 0, replies: 0, imgs: 0, daySet: new Set() };
    cur.msgs += cell.msgs || 0;
    cur.mentions += cell.mentions || 0;
    cur.replies += cell.replies || 0;
    cur.imgs += cell.imgs || 0;
    cur.name = cell.name || cur.name;
    cur.daySet.add(dk);
    agg.set(key, cur);
  }
}
const rows = [...agg.values()].map((x) => ({ ...x, activeDays: x.daySet.size })).sort((a, b) => b.msgs - a.msgs);

if (wantJson) {
  console.log(JSON.stringify({ days, window: inWindow, rows }, null, 2));
  process.exit(0);
}

const nameOf = (r) => (r.name || r.key.split('|').pop() || '未知').slice(0, 20);

// 日报台账还没开始记 → 退回"累计版"(affinity.json: 每人一辈子的合计), 先让主人看到长什么样
if (rows.length === 0) {
  let aff = null;
  try { aff = JSON.parse(readFileSync(join(dataRoot, '.qqbot', 'affinity.json'), 'utf8')); } catch { aff = null; }
  const list = Object.entries((aff && aff.map) || {}).map(([key, e]) => ({ key, ...e }));
  if (list.length === 0) {
    console.log('《亲密度小报》\n');
    console.log('还没有数据 —— 群里聊几句、有人点名她、有人接她的话，过一会儿再看就有啦。');
    console.log(`（日报台账: ${file}${ledgerMissing ? ' —— 还没生成, 重启宿主后开始记' : ''}）`);
    process.exit(0);
  }
  list.sort((a, b) => (b.msgs || 0) - (a.msgs || 0));
  console.log('《亲密度小报》  累计版（日报台账刚上线，先看合计）');
  console.log('');
  list.slice(0, 8).forEach((r, i) => {
    console.log(`${i + 1}. ${String(r.name || r.key).slice(0, 20)} —— 说了 ${r.msgs || 0} 条、点名人家 ${r.mentions || 0} 次、接人家的话 ${r.replies || 0} 次`);
  });
  console.log('');
  console.log(`总共 ${list.length} 位跟人家说过话。（全是能对得上聊天记录的事实，哪条不对请直接说。）`);
  process.exit(0);
}

const top = rows.slice(0, 8);
const lines = [];
lines.push(`《本周亲密度小报》  最近 ${days} 天`);
lines.push('');
lines.push('谁最常跟人家说话：');
top.forEach((r, i) => {
  lines.push(`${i + 1}. ${nameOf(r)} —— 说了 ${r.msgs} 条（来了 ${r.activeDays} 天）、点名人家 ${r.mentions} 次`);
});
const chatty = [...rows].sort((a, b) => b.replies - a.replies).slice(0, 5).filter((r) => r.replies > 0);
if (chatty.length > 0) {
  lines.push('');
  lines.push('谁最常接人家的话：');
  chatty.forEach((r, i) => lines.push(`${i + 1}. ${nameOf(r)} —— 接了 ${r.replies} 次`));
}
const feeders = [...rows].sort((a, b) => b.imgs - a.imgs).slice(0, 5).filter((r) => r.imgs > 0);
if (feeders.length > 0) {
  lines.push('');
  lines.push('谁最爱投喂人家图：');
  feeders.forEach((r, i) => lines.push(`${i + 1}. ${nameOf(r)} —— 发了 ${r.imgs} 张`));
}
lines.push('');
lines.push(`本周共有 ${rows.length} 位跟人家说过话。`);
lines.push('（以上全是能对得上聊天记录的事实，哪条不对请直接说，人家改。）');

console.log(lines.join('\n'));
