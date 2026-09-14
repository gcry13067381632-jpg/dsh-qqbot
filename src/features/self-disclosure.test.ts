/**
 * self-disclosure.test.ts — 群友自述检测（2026-09-14 主人定：按关键词命中）
 *
 * 设计取舍：宁可**漏报**也不误报 —— 误报会让她多记一条没用的；漏报下次还会触发。
 * 所以这些用例既是功能说明，也是"边界不能越"的护栏。
 */
import { describe, expect, it } from 'vitest';
import { detectSelfDisclosure, hintCountToday, bumpHint } from './self-disclosure.js';

describe('detectSelfDisclosure — 该记的自述要抓住', () => {
  it('身份类', () => {
    expect(detectSelfDisclosure('我是福建人，不是胡建人')?.matched).toBe('我是/叫/来自');
    expect(detectSelfDisclosure('我叫做早饭，做自媒体的')?.matched).toBeTruthy();
  });

  it('经历/本事类', () => {
    expect(detectSelfDisclosure('我玩绅士游戏十年了，自媒体做了一年')?.matched).toBe('我玩/做/干');
  });

  it('喜好类', () => {
    expect(detectSelfDisclosure('我喜欢探索想法，也爱摸鱼偷懒')?.matched).toBe('我喜欢/爱/讨厌');
    expect(detectSelfDisclosure('那个游戏我玩过，剧情挺虐的')?.matched).toBe('我玩/做/干');
  });

  it('拥有/能力类', () => {
    expect(detectSelfDisclosure('我哔哩哔哩有十万粉丝呢')?.matched).toBe('我有/会/能');
  });

  it('时间线类', () => {
    expect(detectSelfDisclosure('我最近在玩时间勇者')?.matched).toBe('我最近/上次/以前/平时');
  });
});

describe('detectSelfDisclosure — 这些不该触发提醒', () => {
  it('提问 / 征求意见', () => {
    expect(detectSelfDisclosure('我该不该把这个 bug 修了？')).toBeUndefined();
    expect(detectSelfDisclosure('我要不要换个模型试试')).toBeUndefined();
    expect(detectSelfDisclosure('我能不能再问你一个问题')).toBeUndefined();
  });

  it('指代当下的临场内容', () => {
    expect(detectSelfDisclosure('我刚发的那张图你看到了吗')).toBeUndefined();
    expect(detectSelfDisclosure('我这个截图里的分数是不是不对')).toBeUndefined();
  });

  it('观点 / 转述（不是关于自己的事实）', () => {
    expect(detectSelfDisclosure('我觉得这个设计挺妙的')).toBeUndefined();
    expect(detectSelfDisclosure('我听说那个游戏要出续作了')).toBeUndefined();
  });

  it('太短 / 太长 / 空', () => {
    expect(detectSelfDisclosure('我是')).toBeUndefined();
    expect(detectSelfDisclosure('')).toBeUndefined();
    expect(detectSelfDisclosure('我'.repeat(500))).toBeUndefined();
  });
});

describe('提醒节流 — 每人每天最多 2 次', () => {
  it('第 3 次不再提醒', () => {
    const key = 'person:test-throttle';
    expect(hintCountToday(key)).toBe(0);
    expect(bumpHint(key)).toBe(true);
    expect(bumpHint(key)).toBe(true);
    expect(bumpHint(key)).toBe(false); // 额度用完
    expect(hintCountToday(key)).toBe(2);
  });
});
