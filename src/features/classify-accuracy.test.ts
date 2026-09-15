/**
 * classify-accuracy.test.ts — 判定准确率回归（2026-09-14）
 *
 * 为什么要有它：判定库是"跑出来的"，不是"写出来的" —— 改几条例句、换个打分方式，
 *   准确率可能悄悄掉一半，而**代码测试全绿**（因为它们只钉结构，不钉质量）。
 *   这个文件把 m1/judge-eval.mjs 的口径搬进 CI：拿带标签的真实样本打分，低于线就红。
 *
 * 数据来源：`eval-data/*.jsonl`（真实日志 + 人工标签，见 m1/eval/ 与 m1/eval-export.mjs）
 *   · tendency 39 条（亲近/拒绝/任务）—— 含 2026-09-14 那次"扣错人"的工具参数样本
 *   · emo      30 条（暖/冷/中性）
 * 口径：**判不出来（把握不足）算弃权，不计入错**，但弃权率太高也说明库没用 → 一起卡。
 * 模型不可用（全弃权）时跳过 —— 不能在没模型的环境里假装通过。
 *
 * ⚠️ 改样本库 / 改 CLASSIFY_SCORE_MODE / 改门槛之后，**先跑这个再部署**。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyEmo, classifyTendency } from './local-signals.js';
import { confidentEmo, tendencyLabel, EMO_MIN_BEST, TENDENCY_MIN_BEST } from './four-source.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function load(kind: 'tendency' | 'emo'): Array<{ id: string; label: string; text: string }> {
  return readFileSync(join(HERE, 'eval-data', `${kind}.jsonl`), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

interface Tally { total: number; judged: number; correct: number }
async function run(kind: 'tendency' | 'emo', minBest: number): Promise<Tally> {
  const t: Tally = { total: 0, judged: 0, correct: 0 };
  for (const row of load(kind)) {
    t.total += 1;
    const r = kind === 'emo' ? await classifyEmo(row.text) : await classifyTendency(row.text);
    // 判定**直接用插件的函数**（含"剔英文 / 接梗关键词 / 按语言选门槛 / margin 门槛"），
    //   别再自己拼 best+margin —— 2026-09-14 收紧 margin 后，这里硬编码的 0.01 就与线上脱节了
    const got = kind === 'emo' ? confidentEmo(r) : tendencyLabel(r, row.text);
    if (!got) continue;   // 弃权
    t.judged += 1;
    if (got === row.label) t.correct += 1;
  }
  return t;
}

describe('判定准确率回归（改样本库/打分方式后必须复跑）', () => {
  it('倾向：已判定样本里 ≥ 90% 判对', async () => {
    const t = await run('tendency', TENDENCY_MIN_BEST);
    if (t.judged === 0) { console.warn('[跳过] 本地模型不可用，倾向判定全弃权'); return; }
    const acc = t.correct / t.judged;
    console.log(`倾向: 判定 ${t.judged}/${t.total} 条，对 ${t.correct} = ${(acc * 100).toFixed(1)}%`);
    expect(acc).toBeGreaterThanOrEqual(0.9);
    // 弃权率别超过 1/3（库太窄就没用了）
    expect(t.judged / t.total).toBeGreaterThanOrEqual(0.66);
  });

  it('情绪：已判定样本里 ≥ 85% 判对', async () => {
    const t = await run('emo', EMO_MIN_BEST);
    if (t.judged === 0) { console.warn('[跳过] 本地模型不可用，情绪判定全弃权'); return; }
    const acc = t.correct / t.judged;
    console.log(`情绪: 判定 ${t.judged}/${t.total} 条，对 ${t.correct} = ${(acc * 100).toFixed(1)}%`);
    expect(acc).toBeGreaterThanOrEqual(0.85);
    expect(t.judged / t.total).toBeGreaterThanOrEqual(0.66);
  });

  it('2026-09-14 的坑：热情卖萌长文不该被判「冷」；"需回应"的工具参数不该被判「拒绝」', async () => {
    // 这两条是当时真实造成误扣的原文，钉死以防回退。
    // 断言用**过门槛后**的结果：给不出标签（弃权）可以接受，**给出错的标签不行** ——
    // 这正是修 C 时定的规矩：宁可弃权，不可错判。
    const warm = confidentEmo(await classifyEmo(
      '哎呀，路人乙sama惦记人家啦！😆 人家刚才不是不插话，是在安静听各位sama聊游戏聊汉化聊军训，默默当一只专业的女仆鲸鱼——毕竟"观棋不语真君子"嘛！',
    ));
    expect(warm).not.toBe('冷');

    const toolish = await classifyTendency('路人乙点我名说"大肥鱼怎么不插话了"，需回应');
    if (toolish && toolish.best >= TENDENCY_MIN_BEST && toolish.margin >= 0.01) {
      expect(toolish.label).not.toBe('拒绝');
    }
  });
});
