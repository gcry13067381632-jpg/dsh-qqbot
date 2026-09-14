/**
 * verify-tendency.mjs — 拿**真实思考样本**抽查倾向判定（2026-09-13）
 *
 * 用途：改过 `tendency-samples.ts`（例句库）之后，别只看单元测试 ——
 *   直接拿留档里的真实思考跑一遍，看判定是否与"主人口径"一致。
 *
 * 主人口径（2026-09-13）：
 *   · **任务** = 流程 + 职责判断（含"要不要接话 / 要不要静默"）
 *   · **疏离** = 对人的冷淡 / 嫌烦 / 敷衍（不是"说话简洁"）
 *   · **亲近** = 想为某个人做点什么（俏皮接话、给台阶、怕对方没看到…）
 *
 * 用法: node scripts/verify-tendency.mjs --dataRoot <数据根> [--limit 12]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { classifyTendency, detectScript } from '../dist/features/local-signals.js';

function argOf(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dataRoot = resolve(argOf('--dataRoot', join(process.cwd(), 'dshqqbot')));
const limit = Number(argOf('--limit', '12')) || 12;
const src = join(dataRoot, '.qqbot', 'thinking-log.jsonl');

if (!existsSync(src)) {
  console.error(`找不到思考留档: ${src}`);
  process.exit(1);
}

const rows = readFileSync(src, 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => { try { return JSON.parse(l); } catch { return undefined; } })
  .filter((r) => r && typeof r.text === 'string' && r.text.trim() !== '');

const picked = rows.slice(-limit);
const tally = new Map();

for (const r of picked) {
  const text = String(r.text);
  const lang = detectScript(text);
  const res = await classifyTendency(text);
  const label = res ? `${res.label}(${res.best}/${res.margin})` : `跳过[${lang ?? '中英混杂/太短'}]`;
  tally.set(res ? res.label : '跳过', (tally.get(res ? res.label : '跳过') ?? 0) + 1);
  const head = text.replace(/\s+/g, ' ').slice(0, 64);
  console.log(`turn=${r.turn}/${r.step} ${String(r.chars).padStart(5)}字  ${label.padEnd(24)} ${head}`);
}

console.log('');
console.log('统计: ' + [...tally.entries()].map(([k, v]) => `${k}=${v}`).join('  '));
