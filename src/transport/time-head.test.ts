/**
 * 群时间头省 token 回归（2026-10-01 主人要求「同一分钟的消息或聚合消息不重复显示时间」）。
 *
 * 原来每轮入站都无条件在 agentBody 最前面加 `[YYYY-MM-DD 周X HH:MM]`，
 * 同一分钟里连发几轮 / 聚合一波就堆出几行一模一样的时间头（每行 ~25 字符）。
 */
import { describe, expect, it } from 'vitest';
import { groupTimeHead } from './inbound.js';

describe('groupTimeHead — 同会话同分钟只注入一次', () => {
  it('首次：注入完整时间头', () => {
    const c = new Map<string, string>();
    expect(groupTimeHead(c, 'group', 'G1', new Date(2026, 9, 1, 20, 47, 30))).toBe('[2026-10-01 周四 20:47]');
  });

  it('同会话同分钟：第二次返回 null（省掉重复的 ~25 字符）', () => {
    const c = new Map<string, string>();
    expect(groupTimeHead(c, 'group', 'G1', new Date(2026, 9, 1, 20, 47, 1))).not.toBeNull();
    expect(groupTimeHead(c, 'group', 'G1', new Date(2026, 9, 1, 20, 47, 59))).toBeNull();
  });

  it('跨分钟：重新注入', () => {
    const c = new Map<string, string>();
    groupTimeHead(c, 'group', 'G1', new Date(2026, 9, 1, 20, 47, 59));
    expect(groupTimeHead(c, 'group', 'G1', new Date(2026, 9, 1, 20, 48, 0))).toBe('[2026-10-01 周四 20:48]');
  });

  it('跨小时 / 跨天：重新注入', () => {
    const c = new Map<string, string>();
    groupTimeHead(c, 'group', 'G1', new Date(2026, 9, 1, 20, 59, 59));
    expect(groupTimeHead(c, 'group', 'G1', new Date(2026, 9, 1, 21, 0, 0))).toBe('[2026-10-01 周四 21:00]');
    expect(groupTimeHead(c, 'group', 'G1', new Date(2026, 9, 2, 21, 0, 30))).toBe('[2026-10-02 周五 21:00]');
  });

  it('不同会话互不影响（各按自己的分钟算）', () => {
    const c = new Map<string, string>();
    groupTimeHead(c, 'group', 'G1', new Date(2026, 9, 1, 20, 47, 0));
    expect(groupTimeHead(c, 'group', 'G2', new Date(2026, 9, 1, 20, 47, 30))).toBe('[2026-10-01 周四 20:47]');
  });
});
