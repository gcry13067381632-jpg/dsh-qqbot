/**
 * attitude.test.ts — 好感度（A 值）的事件分与阻尼/范围（2026-09-14）
 *
 * 定案口径（主人）：**扣不扣看内心，不看表面**。
 *   · 内心亲近 → 加；内心任务 → 0；内心拒绝 → 减
 *   · 表面（正文）只在"内心拒绝"时参与：暖且够长 = 让步（净正）；冷/过短 = 重罚（更负）
 *   · 内心亲近/任务时，表面再冷也**不扣**
 */
import { describe, expect, it } from 'vitest';
import { attitudeDamping, attitudeRange, computeDelta, attitudeTier, thresholdOffset, scoreOffsetByRatio, ATTITUDE_GATE_ENABLED } from './attitude.js';

describe('computeDelta — 扣不扣看内心', () => {
  it('内心亲近 → +0.05（表面冷暖不影响）', () => {
    expect(computeDelta({ thinkTen: '亲近', replyEmo: '暖', replyChars: 80 }).delta).toBeCloseTo(0.05, 3);
    expect(computeDelta({ thinkTen: '亲近', replyEmo: '冷', replyChars: 80 }).delta).toBeCloseTo(0.05, 3);
  });

  it('内心任务 → 0（表面冷也不扣）', () => {
    expect(computeDelta({ thinkTen: '任务', replyEmo: '冷', replyChars: 10 }).delta).toBe(0);
    expect(computeDelta({ thinkTen: '任务', replyEmo: '暖', replyChars: 200 }).delta).toBe(0);
  });

  it('同时给结构化代号（面板图标用；人可读的 parts 也保留）', () => {
    const r = computeDelta({ thinkTen: '亲近', replyEmo: '暖', replyChars: 80, userEmo: '暖' });
    expect(r.codes).toEqual(['near', 'amp:both-warm']);
    expect(r.parts.join(' / ')).toContain('内心亲近');
    expect(computeDelta({ thinkTen: '拒绝', replyEmo: '冷', replyChars: 5 }).codes).toEqual(['refuse', 'harsh']);
  });

  it('内心拒绝 → −0.05；若正文仍暖且够长 → 让步，净 +0.03', () => {
    expect(computeDelta({ thinkTen: '拒绝', replyEmo: '中性', replyChars: 120 }).delta).toBeCloseTo(-0.05, 3);
    const yieldCase = computeDelta({ thinkTen: '拒绝', replyEmo: '暖', replyChars: 120 });
    expect(yieldCase.delta).toBeCloseTo(0.03, 3);
    expect(yieldCase.parts.join(' ')).toContain('让步');
  });

  it('内心拒绝 + 正文冷/过短 → 重罚，净 −0.10', () => {
    expect(computeDelta({ thinkTen: '拒绝', replyEmo: '冷', replyChars: 60 }).delta).toBeCloseTo(-0.1, 3);
    expect(computeDelta({ thinkTen: '拒绝', replyEmo: '暖', replyChars: 5 }).delta).toBeCloseTo(-0.1, 3);
  });

  it('判不出内心（空）→ 0（不确定就不动分）', () => {
    expect(computeDelta({ thinkTen: undefined, replyEmo: '冷', replyChars: 100 }).delta).toBe(0);
  });
});

describe('范围与阻尼 — 熟识度越高，变化越慢、上下限越扩', () => {
  it('R(F)=1+2F：陌生人 ±1，熟人 F=0.8 → ±2.6', () => {
    expect(attitudeRange(0)).toBe(1);
    expect(attitudeRange(0.8)).toBeCloseTo(2.6, 3);
  });

  it('k(F)=1/(1+3F)：陌生人 1.0，老熟人只 0.25', () => {
    expect(attitudeDamping(0)).toBeCloseTo(1, 3);
    expect(attitudeDamping(0.5)).toBeCloseTo(0.4, 3);
  });
});

describe('档位与门槛偏移 — 门槛 = 基础门槛 + 好感度偏移（2026-09-14 主人定）', () => {
  it('档位按"占范围的比例"分（f=0.5 → R=2）', () => {
    expect(attitudeTier(1.3, 0.5)).toBe('很亲近'); // 0.65
    expect(attitudeTier(0.7, 0.5)).toBe('亲近');   // 0.35
    expect(attitudeTier(0, 0.5)).toBe('中立');
    expect(attitudeTier(-0.6, 0.5)).toBe('冷淡');  // -0.30
    expect(attitudeTier(-1.4, 0.5)).toBe('疏远');  // -0.70
  });

  it('分数偏移：越亲近加分、冷淡/疏远减分（中立为 0）', () => {
    expect(thresholdOffset('很亲近')).toBe(0.1);
    expect(thresholdOffset('亲近')).toBe(0.05);
    expect(thresholdOffset('中立')).toBe(0);
    expect(thresholdOffset('冷淡')).toBe(-0.05);
    expect(thresholdOffset('疏远')).toBe(-0.1);
  });

  it('连续偏移：占比正 → 加分，占比负 → 减分（2026-09-14 修符号）', () => {
    expect(scoreOffsetByRatio(0.6)).toBeCloseTo(0.06, 3);
    expect(scoreOffsetByRatio(-0.6)).toBeCloseTo(-0.06, 3); // 冷淡是**减分**，不是加分
    expect(scoreOffsetByRatio(0.02)).toBe(0);               // 死区
    expect(scoreOffsetByRatio(-2)).toBe(-0.1);              // 封顶
  });

  it('幅度有限：0.5 的基础门槛，最松 0.4 / 最紧 0.6（不翻盘）', () => {
    expect(0.5 - thresholdOffset('很亲近')).toBeCloseTo(0.4, 3);
    expect(0.5 - thresholdOffset('疏远')).toBeCloseTo(0.6, 3);
  });

  it('总开关存在（可一键回滚到"门槛只按会话设"）', () => {
    expect(typeof ATTITUDE_GATE_ENABLED).toBe('boolean');
  });
});

describe('对比放大 — 不领情 / 想讨好（主人 2026-09-14 定）', () => {
  it('对方夸(暖) 而她还掉好感 → 不领情，扣得更多（×1.5）', () => {
    const plain = computeDelta({ thinkTen: '拒绝', replyEmo: '中性', replyChars: 120 }).delta; // −0.05
    const praised = computeDelta({ thinkTen: '拒绝', replyEmo: '中性', replyChars: 120, userEmo: '暖' }).delta;
    expect(plain).toBeCloseTo(-0.05, 3);
    expect(praised).toBeCloseTo(-0.075, 3);
  });

  it('对方冷(骂) 而她还涨好感 → 想讨好，加得更大（×1.5）', () => {
    const plain = computeDelta({ thinkTen: '亲近', replyEmo: '暖', replyChars: 80 }).delta; // +0.05
    const scolded = computeDelta({ thinkTen: '亲近', replyEmo: '暖', replyChars: 80, userEmo: '冷' }).delta;
    expect(plain).toBeCloseTo(0.05, 3);
    expect(scolded).toBeCloseTo(0.075, 3);
  });

  it('同向（暖×加 / 冷×减）→ 小幅放大 ×1.2', () => {
    const base = computeDelta({ thinkTen: '亲近', replyEmo: '暖', replyChars: 80 }).delta;
    const bothWarm = computeDelta({ thinkTen: '亲近', replyEmo: '暖', replyChars: 80, userEmo: '暖' }).delta;
    expect(bothWarm).toBeCloseTo(base * 1.2, 3);
  });

  it('没有群友语气（旧数据/私聊）→ 不影响', () => {
    expect(computeDelta({ thinkTen: '亲近', replyEmo: '暖', replyChars: 80 }).delta).toBeCloseTo(0.05, 3);
    // 内心"任务"是 0 分，放大也不该凭空长出来
    expect(computeDelta({ thinkTen: '任务', replyEmo: '冷', replyChars: 10, userEmo: '暖' }).delta).toBe(0);
  });
});
