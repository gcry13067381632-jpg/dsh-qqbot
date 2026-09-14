/**
 * agg-score.test.ts — 聚合窗口「加权平均」的口径（2026-09-14 主人定）
 *
 * 钉住四件事：
 *   ① 单条 = 自己（别把单条也平均歪了）；
 *   ② 高分那条仍然主导，但**不再独占**（旧口径"取最高"就是被这条淘汰的）；
 *   ③ 好感高的群友权重大（占比 +1 → ×2），冷淡的不会被抹成 0（下限 0.2）；
 *   ④ 被点名 ×2；主角 = 权重最大那条（归因跟着他，不跟着平均值）。
 */
import { describe, expect, it } from 'vitest';
import { AGG_ATT_MAX, AGG_ATT_MIN, AGG_MENTION_BOOST, weightedAggregate } from './agg-score.js';

const c = (score: number, ratio = 0, extra: Partial<{ offset: number; mention: boolean; name: string }> = {}) => ({
  text: 'x',
  score,
  ratio,
  offset: extra.offset ?? 0,
  mention: extra.mention,
  name: extra.name,
});

describe('weightedAggregate — 加权平均', () => {
  it('单条：综合分就是它自己的有效分', () => {
    const r = weightedAggregate([c(0.8, 0.5, { offset: 0.05 })])!;
    expect(r.score).toBeCloseTo(0.85, 6);
    expect(r.topIndex).toBe(0);
  });

  it('高分主导但不再独占：4 条 0.3 + 1 条 0.95 → 落在两者之间', () => {
    const r = weightedAggregate([c(0.3), c(0.3), c(0.3), c(0.3), c(0.95)])!;
    expect(r.score).toBeGreaterThan(0.3);
    expect(r.score).toBeLessThan(0.95);
    expect(r.topIndex).toBe(4);            // 主角仍是那条高分
  });

  it('好感度加权：同分值下，好感动高的人把综合分往他那边拉', () => {
    const cold = weightedAggregate([c(0.6, -0.8, { offset: -0.08 }), c(0.6, 0.9, { offset: 0.09 })])!;
    const neutral = weightedAggregate([c(0.6, 0), c(0.6, 0)])!;
    expect(cold.score).toBeGreaterThan(neutral.score);   // 偏向 +0.09 的那条
    expect(cold.score).toBeCloseTo(0.6 + 0.09 * (0.6 * 1.9) / (0.6 * 1.9 + 0.6 * 0.2) + -0.08 * (0.6 * 0.2) / (0.6 * 1.9 + 0.6 * 0.2), 6);
  });

  it('好感权重有上下限（0.2 ~ 2），冷淡的人不会被抹成 0', () => {
    expect(Math.max(AGG_ATT_MIN, Math.min(AGG_ATT_MAX, 1 + -1))).toBe(0.2);
    expect(Math.max(AGG_ATT_MIN, Math.min(AGG_ATT_MAX, 1 + 1))).toBe(2);
    const r = weightedAggregate([c(0.5, -5), c(0.5, 0)])!;   // ratio 超界也不炸
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it('被点名 ×2：点名那条的权重大幅领先', () => {
    const plain = weightedAggregate([c(0.5), c(0.5)])!;
    const withMention = weightedAggregate([c(0.5), c(0.5, 0, { mention: true })])!;
    expect(withMention.parts[1]!.w).toBeCloseTo(plain.parts[1]!.w * AGG_MENTION_BOOST, 6);
    expect(withMention.topIndex).toBe(1);
  });

  it('主角 = 权重最大那条（归因跟着它，不跟着平均值）', () => {
    // 第二条分低但好感极高 → 权重反超第一条
    const r = weightedAggregate([c(0.5, 0, { name: 'a' }), c(0.45, 1, { name: 'b' })])!;
    // a: 0.5×1=0.5 ｜ b: 0.45×2=0.9 → b 是主角
    expect(r.topIndex).toBe(1);
    expect(r.parts[1]!.n).toBe('b');
  });

  it('空池 / 全零 → undefined（调用方回退单条口径）', () => {
    expect(weightedAggregate([])).toBeUndefined();
    expect(weightedAggregate([c(0), c(0)])).toBeDefined();   // 0 分也会被 0.01 兜住
  });
});
