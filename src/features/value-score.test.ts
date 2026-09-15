/**
 * value-score 的打分文本归一化回归（2026-09-15 主人实测后加）。
 *
 * 背景：样例里带 `@bot …`、入站文本带 `<@openid> …` →
 *   两者最大的共同特征变成"这条 @ 了她"，语义被前缀淹没。
 *   实测「<@xx> 不知道」拿到 1.00 分（近邻全是 @bot 开头的正样例）。
 *
 * 这里锁死两件事：① @ 标记必须被剥干净；② 带不带前缀的同一句话归一化后**完全相等**
 *   （否则"前缀=高分"这个伪特征又会从样例侧漏回来）。
 */
import { describe, expect, it } from 'vitest';
import { stripMentionForScore, NON_MENTION_PENALTY } from './value-score.js';

describe('stripMentionForScore — 打分前剥掉 @ 标记', () => {
  it('openid 形式与 @bot 形式都剥掉，只留正文', () => {
    expect(stripMentionForScore('<@49C7A1D43E0018DF6F5E9DAB9C823E28> 不知道')).toBe('不知道');
    expect(stripMentionForScore('@bot 这个bug你修一下')).toBe('这个bug你修一下');
    expect(stripMentionForScore('<@!1234567890> 摸摸大肥鱼')).toBe('摸摸大肥鱼');
  });

  it('同一句话带不带前缀 → 归一化后必须相等（核心：前缀不该是特征）', () => {
    expect(stripMentionForScore('@bot 大不大')).toBe(stripMentionForScore('大不大'));
    expect(stripMentionForScore('<@ABC123DEF456> 来点小游戏')).toBe(stripMentionForScore('@bot 来点小游戏'));
  });

  it('不误伤正文里的普通 @ 与邮箱', () => {
    expect(stripMentionForScore('@某某 你看这个')).toBe('@某某 你看这个');   // 短昵称(非 openid 形态)不动
    expect(stripMentionForScore('a@b.com')).toBe('a@b.com');
    expect(stripMentionForScore('@botanic 是什么')).toBe('@botanic 是什么');  // `@bot\b` 不该咬到 @botanic
  });

  it('@ 在中间/结尾/无空格 —— 一样要剥干净（主人 2026-09-15 追问"如果@在中间呢"）', () => {
    expect(stripMentionForScore('如果 @bot 在中间呢')).toBe('如果 在中间呢');
    expect(stripMentionForScore('所以@bot又如何')).toBe('所以 又如何');
    expect(stripMentionForScore('你觉得呢 @bot')).toBe('你觉得呢');
    expect(stripMentionForScore('@bot又如何')).toBe('又如何');
    expect(stripMentionForScore('大佬 <@ABC123DEF456> 这个怎么弄')).toBe('大佬 这个怎么弄');
  });

  it('纯 @ 标记归一化后为空（调用方会退回原文兜底）', () => {
    expect(stripMentionForScore('<@49C7A1D43E0018DF6F5E9DAB9C823E28>')).toBe('');
    expect(stripMentionForScore('@bot')).toBe('');
  });
});

describe('NON_MENTION_PENALTY — 没被点名就扣分', () => {
  it('是个温和的正数（0 < p < 0.1）：够动门槛附近，又不至于把闲聊全掐死', () => {
    expect(NON_MENTION_PENALTY).toBeGreaterThan(0);
    expect(NON_MENTION_PENALTY).toBeLessThan(0.1);
  });
});
