/**
 * thinking-export.mjs — 把思考留档导成「人工标注清单」（2026-09-13）
 *
 * 用途（《好感度系统设计》§11 行动 2）: 人工读 50 条思考打标"是否含对人倾向",
 *   占比太低 → 拿思考算好感这条支路**直接砍掉**（最省的决策）。
 *
 * 输入: {dataRoot}/.qqbot/thinking-log.jsonl（由插件观察期写入）
 * 输出: {dataRoot}/.qqbot/thinking-review/打标_<日期>.md
 *   · 每条: 编号 / 时间 / 来源群 / 字数 / token + 思考原文（引用块）+ 勾选栏
 *   · **均匀采样**（不是只取最近）: 避免结论被某个时段/话题带偏
 *
 * 用法: node scripts/thinking-export.mjs --dataRoot <数据根> [--limit 50] [--recent] [--out <文件>]
 *   缺 --dataRoot 时默认 {cwd}/dshqqbot（与插件默认数据根一致）
 *   缺 --recent 时**均匀采样**（抽查用）；给 --recent 则取**最近 N 条**（复盘"刚发生了什么"时用）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function argOf(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dataRoot = resolve(argOf('--dataRoot', join(process.cwd(), 'dshqqbot')));
const limit = Number(argOf('--limit', '50')) || 50;
const src = join(dataRoot, '.qqbot', 'thinking-log.jsonl');

if (!existsSync(src)) {
  console.error(`找不到思考留档: ${src}`);
  console.error('（插件观察期会在每条 assistant 消息后追加；跑一会儿自然就有了）');
  process.exit(1);
}

const rows = readFileSync(src, 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => {
    try { return JSON.parse(l); } catch { return undefined; }
  })
  .filter((r) => r && typeof r.text === 'string' && r.text.trim() !== '');

if (rows.length === 0) {
  console.error('留档里没有可用条目。');
  process.exit(1);
}

/** 均匀采样: 条数多时从头到尾等距取, 不偏向最近 */
function sampleUniform(items, n) {
  if (items.length <= n) return items;
  const step = items.length / n;
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(items[Math.floor(i * step)]);
  return out;
}

const recent = process.argv.includes('--recent');
const picked = recent ? rows.slice(-limit) : sampleUniform(rows, limit);
const stamp = (ts) => {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const today = new Date();
const day = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

const outDir = join(dataRoot, '.qqbot', 'thinking-review');
const outPath = argOf('--out', join(outDir, `打标_${day}.md`));

const head = [
  `# 思考标注清单 · ${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
  '',
  `> 留档共 **${rows.length}** 条，本清单**${recent ? `取最近 ${picked.length} 条` : `均匀采样 ${picked.length} 条`}**（${recent ? '复盘刚发生的事' : '避免只抽最近、被某段话题带偏'}）。`,
  '> 目的：《好感度系统设计》§11 —— 看思考里**有没有"对人的倾向"**。占比太低，就用思考算好感这条支路直接砍掉。',
  '',
  '## 怎么打标（每条勾一个就好）',
  '',
  '看这段思考**有没有在"想这个人"**，而不是只在想任务：',
  '',
  '- **亲近**：想照顾对方情绪 / 想多聊两句 / 主动俏皮 / 琢磨怎么接才舒服',
  '- **疏离**：懒得理、只想给个答案、不想多说、想快点结束',
  '- **纯任务**：只有流程（看图→打标→回话），读起来换谁在都一样',
  '',
  '> 提示：情绪**不长在情绪词上**（不会写"我有点感动"），它藏在**选择**里 ——',
  '> 接不接梗、给不给台阶、愿不愿意多花力气、犹豫的节奏（"嗯，嗯"）。所以别只找形容词。',
  '',
  '---',
  '',
];

const body = picked.map((r, i) => {
  const lines = String(r.text).replace(/\r/g, '').split('\n');
  const quoted = lines.map((l) => `> ${l}`).join('\n');
  return [
    `## ${i + 1}`,
    '',
    `- 时间：${stamp(r.ts)}　来源：${r.scope ?? '?'} / ${String(r.peer ?? '').slice(0, 8)}　字数：${r.chars ?? '?'}　思考 token：${r.tokens ?? '?'}　回合：${r.turn ?? '?'}/${r.step ?? '?'}`,
    '',
    quoted,
    '',
    '**打标**：`[ ] 亲近`　`[ ] 疏离`　`[ ] 纯任务`　备注：',
    '',
    '---',
    '',
  ].join('\n');
}).join('\n');

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, head.join('\n') + body, 'utf8');

console.log(`已生成: ${outPath}`);
console.log(`留档 ${rows.length} 条 → 采样 ${picked.length} 条`);
