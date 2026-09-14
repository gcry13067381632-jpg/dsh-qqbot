/**
 * people-memo.test.ts — 小传写入的两处 2026-09-14 改动
 *   ① 节流放宽：一天一条 → **一天最多 3 条**（判断改内存计数，不再看文件 mtime）
 *   ② 支持**栏目前缀**归栏：「喜好：最近在玩 XX」→ 落到「喜好与雷区」那一栏；
 *      该栏已有一行则用"；"并进去（保持"每栏一行"的摘要形态）；不带前缀仍进「## 记事」
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendMemoLine, countWroteToday, readMemo } from './people-memo.js';

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'people-memo-'));
}

describe('小传：栏目前缀归栏', () => {
  it('带前缀 → 落进对应栏（新建小传也归栏）', () => {
    const root = freshRoot();
    const r = appendMemoLine(root, 'test-sec1', '喜好：最近在玩《时间勇者》', { name: '亚瑟' });
    expect(r.ok).toBe(true);
    const text = readMemo(root, 'test-sec1') ?? '';
    expect(text).toContain('- 喜好与雷区：最近在玩《时间勇者》');
    expect(text).toContain('# 亚瑟');
  });

  it('同栏再记 → 用"；"并进同一行（不新起一行）', () => {
    const root = freshRoot();
    appendMemoLine(root, 'test-sec2', '喜好：喜欢剧情向', { name: '亚瑟', force: true });
    appendMemoLine(root, 'test-sec2', '喜好：不吃虐', { force: true });
    const text = readMemo(root, 'test-sec2') ?? '';
    const hits = text.split('\n').filter((l) => l.startsWith('- 喜好与雷区：'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('喜欢剧情向；不吃虐');
  });

  it('不带前缀 → 进「## 记事」区（带日期）', () => {
    const root = freshRoot();
    appendMemoLine(root, 'test-sec3', '今天在群里发了张三花猫的图', { name: 'WATCHer' });
    const text = readMemo(root, 'test-sec3') ?? '';
    expect(text).toMatch(/## 记事\n- \d{4}-\d{2}-\d{2} 今天在群里发了张三花猫的图/);
  });

  it('栏名不认识 → 当普通记事处理（不误归栏）', () => {
    const root = freshRoot();
    appendMemoLine(root, 'test-sec4', '乱七八糟：这说明不了什么');
    const text = readMemo(root, 'test-sec4') ?? '';
    expect(text).toContain('乱七八糟：这说明不了什么');
    expect(text).not.toContain('- 乱七八糟：');
  });
});

describe('小传：一天最多 3 条（原为 1 条）', () => {
  it('第 4 条会被拒，且计数正确', () => {
    const root = freshRoot();
    const key = 'test-limit';
    for (let i = 1; i <= 3; i += 1) {
      expect(appendMemoLine(root, key, `第 ${i} 条事实`, { force: true }).ok).toBe(true);
    }
    const fourth = appendMemoLine(root, key, '第 4 条事实');
    expect(fourth.ok).toBe(false);
    expect(fourth.msg).toContain('一天最多 3 条');
    expect(countWroteToday(key)).toBe(3);
    expect(existsSync(join(root, '.qqbot', 'people', 'test-limit.md'))).toBe(true);
  });

  it('force 可越过节流（人工补记用）', () => {
    const root = freshRoot();
    const key = 'test-force';
    for (let i = 1; i <= 3; i += 1) appendMemoLine(root, key, `x${i}`);
    expect(appendMemoLine(root, key, '第 4 条(force)', { force: true }).ok).toBe(true);
    expect(readFileSync(join(root, '.qqbot', 'people', `${key}.md`), 'utf8')).toContain('第 4 条(force)');
  });
});
