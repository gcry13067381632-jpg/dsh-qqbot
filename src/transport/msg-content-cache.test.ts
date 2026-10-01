/**
 * 被引用消息内容台账回归（2026-10-01 主人实测：「引用纯图片看不到是哪张图」）。
 * QQ 引用纯图时 msg_elements 给不出 URL/路径 → 只能靠入站时自己记。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookupMsgContent, rememberMsgContent } from './msg-content-cache.js';

const ROOT = (): string => mkdtempSync(join(tmpdir(), 'qqbot-mc-'));

describe('msg-content-cache — 被引用消息内容台账', () => {
  it('记过的能回查（文本 + 图片本地路径）', () => {
    const root = ROOT();
    rememberMsgContent(root, 'group:G1', '1001j4p', { t: '两个杯子还玩上了', imgs: ['D:/pics/a.jpg'] });
    const hit = lookupMsgContent(root, 'group:G1', '1001j4p');
    expect(hit?.t).toBe('两个杯子还玩上了');
    expect(hit?.imgs).toEqual(['D:/pics/a.jpg']);
  });

  it('只记图片（纯图消息无文字）也能回查 —— 这正是主人遇到的场景', () => {
    const root = ROOT();
    rememberMsgContent(root, 'group:G1', 'img1', { imgs: ['D:/pics/2a8a3ac5b726.jpg'] });
    expect(lookupMsgContent(root, 'group:G1', 'img1')?.imgs).toEqual(['D:/pics/2a8a3ac5b726.jpg']);
  });

  it('没记过的返回 undefined；不同 peer 不串味', () => {
    const root = ROOT();
    expect(lookupMsgContent(root, 'group:G1', 'nope')).toBeUndefined();
    rememberMsgContent(root, 'group:G1', 'k1', { t: 'A' });
    expect(lookupMsgContent(root, 'group:G2', 'k1')).toBeUndefined();
    expect(lookupMsgContent(root, 'group:G1', 'k1')?.t).toBe('A');
  });

  it('空内容不记（省盘）', () => {
    const root = ROOT();
    rememberMsgContent(root, 'group:G1', 'k2', {});
    expect(lookupMsgContent(root, 'group:G1', 'k2')).toBeUndefined();
  });

  it('落盘后内容与读回一致', () => {
    const root = ROOT();
    rememberMsgContent(root, 'c2c:P1', 'k3', { t: 'B', imgs: ['D:/pics/b.png'] });
    expect(lookupMsgContent(root, 'c2c:P1', 'k3')).toEqual({ t: 'B', imgs: ['D:/pics/b.png'] });
  });
});
