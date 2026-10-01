/**
 * @别人 → @昵称 回归（2026-10-01 主人实测：「别人 @ 别人怎么没转换成昵称，依然是 id」）。
 *
 * 数据源 = 群成员台账 `{表情包目录}/group-members.jsonl`（在群里发过言/申请过入群的人）。
 * ⚠️ 用虚构 id/昵称（对外红线：真实内容禁入仓库）。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveMentionNames } from './chat-ledger.js';

function dirWith(members: Array<{ gid: string; mid: string; name?: string }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-ledger-'));
  writeFileSync(
    join(dir, 'group-members.jsonl'),
    members.map((m) => JSON.stringify({ ...m, ts: Date.now() })).join('\n') + '\n',
    'utf8',
  );
  return dir;
}

const OTHER = '07B470BDA5052489D2D0532C2CC2A2EB';

describe('resolveMentionNames', () => {
  it('台账里有 → 换成 @昵称（顺带省 token：35 字符 → 3 字符）', () => {
    const dir = dirWith([{ gid: 'G1', mid: OTHER, name: '路人乙' }]);
    expect(resolveMentionNames(`<@${OTHER}> 速速品`, dir, 'G1')).toBe('@路人乙 速速品');
  });

  it('台账里没有 → 退化成 @短id（前 6 位，与 dock 侧同口径）', () => {
    const dir = dirWith([{ gid: 'G1', mid: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', name: '别人' }]);
    expect(resolveMentionNames(`<@${OTHER}> 看看`, dir, 'G1')).toBe('@07B470 看看');
  });

  it('不同群不串味（同 id 在别的群查不到 → 短 id）', () => {
    const dir = dirWith([{ gid: 'G2', mid: OTHER, name: '路人乙' }]);
    expect(resolveMentionNames(`<@${OTHER}>`, dir, 'G1')).toBe('@07B470');
  });

  it('私聊 / 无 gid → 原样不动', () => {
    const dir = dirWith([{ gid: 'G1', mid: OTHER, name: '路人乙' }]);
    expect(resolveMentionNames(`<@${OTHER}> hi`, dir, undefined)).toBe(`<@${OTHER}> hi`);
  });

  it('没有 @ 标记的文本原样返回（零开销）', () => {
    const dir = dirWith([]);
    expect(resolveMentionNames('普通一句话', dir, 'G1')).toBe('普通一句话');
  });

  it('带 `!` 的写法（<@!id>）也认', () => {
    const dir = dirWith([{ gid: 'G1', mid: OTHER, name: '路人乙' }]);
    expect(resolveMentionNames(`<@!${OTHER}> 在吗`, dir, 'G1')).toBe('@路人乙 在吗');
  });
});
