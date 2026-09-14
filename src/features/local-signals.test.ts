/**
 * local-signals.test.ts — 语言判定与弱信号分类的兜底行为（2026-09-13）
 *
 * 只测**不依赖本地模型**的部分（纯函数与提前返回）：
 *   · detectScript: 中文/英文/混杂 的判语言规则
 *   · classifyEmo / classifyTendency: 空文本、语言判不出、模型不可用 时必须安全返回 undefined
 *     —— 这是"不确定就不动分"的底线，绝不能抛错影响聊天主链。
 */
import { describe, expect, it } from 'vitest';
import { detectScript, classifyEmo, classifyTendency } from './local-signals.js';

describe('detectScript — 按 CJK 占比判语言', () => {
  it('纯中文 → zh', () => {
    expect(detectScript('先看看他想要什么再决定怎么回')).toBe('zh');
  });

  it('纯英文 → en', () => {
    expect(detectScript('let me give them an out here')).toBe('en');
  });

  it('中文里夹英文术语 → 仍判 zh', () => {
    expect(detectScript('先 reply 他，别让他冷场太久，顺手接个梗')).toBe('zh');
  });

  it('中英对半开 → undefined（跳过不判）', () => {
    expect(detectScript('这条 message 得好好 reply 他')).toBeUndefined();
  });

  it('太短或纯符号 → undefined', () => {
    expect(detectScript('')).toBeUndefined();
    expect(detectScript('？！……')).toBeUndefined();
    expect(detectScript('ab')).toBeUndefined();
  });
});

describe('弱信号分类 — 判不出时必须安静返回 undefined', () => {
  it('空文本', async () => {
    expect(await classifyEmo('')).toBeUndefined();
    expect(await classifyTendency('   ')).toBeUndefined();
  });

  it('中英混杂不判（连模型都不用问）', async () => {
    expect(await classifyTendency('let me 看看 think 里到底有没有对人的倾向')).toBeUndefined();
  });
});
