/**
 * 引用块附件回归（2026-10-01 主人实测：群里有人**引用一张表情包**回话，AI 完全不知道引用的是哪张图）。
 *
 * 背景两坑（见 inbound.ts 的 buildQuotePart 注释）：
 *   ① 判空只看文字 → 对方引用纯图（自己没打字）时整块引用消失；
 *   ② SDK 的 quote-ref 把附件降级成 `[image]` 占位文本、URL 丢掉 → 模型永远不知道是哪张图。
 *
 * ⚠️ 一律用**虚构** URL / 文件名 / 昵称（对外红线：真实内容禁入仓库）。
 */
import { describe, expect, it } from 'vitest';
import { buildQuotePart } from './inbound.js';

const NO_LIB = 'D:/no-such-sticker-dir'; // 图库查不到 → 走"URL 兜底"分支

describe('buildQuotePart — 被引用消息的附件', () => {
  it('纯图片引用（无文字）：引用块**不能消失**，要给出图片目标', () => {
    const q = {
      text: '',
      attachments: [{ contentType: 'image/png', url: 'https://multimedia.example.com/a.png', filename: 'a.png' }],
    };
    const out = buildQuotePart(q, NO_LIB);
    expect(out).toContain('[引]');
    expect(out).toContain('[当前]');
    expect(out).toContain('📷 被引用的图片: https://multimedia.example.com/a.png');
  });

  it('SDK 占位文本（`[image]`）+ 附件：不重复输出占位行', () => {
    const q = {
      text: '[image]',
      attachments: [{ contentType: 'image/jpeg', url: 'https://multimedia.example.com/b.jpg' }],
    };
    const out = buildQuotePart(q, NO_LIB);
    expect(out).not.toContain('[image]');
    expect(out).toContain('📷 被引用的图片: https://multimedia.example.com/b.jpg');
  });

  it('图文引用：引用原文与被引用图片都在', () => {
    const q = {
      text: '这样啊，好老呀',
      attachments: [{ contentType: 'image/png', url: 'https://multimedia.example.com/c.png', filename: 'c.png' }],
    };
    const out = buildQuotePart(q, NO_LIB);
    expect(out).toContain('这样啊，好老呀');
    expect(out).toContain('📷 被引用的图片:');
  });

  it('语音引用：给 ASR 转写', () => {
    const q = { text: '', attachments: [{ contentType: 'audio/silk', url: 'https://multimedia.example.com/d.silk', asrText: '晚上吃啥' }] };
    expect(buildQuotePart(q, NO_LIB)).toContain('🎵 被引用的语音转写: 晚上吃啥');
  });

  it('文件引用：给文件名 + 链接', () => {
    const q = { text: '', attachments: [{ contentType: 'application/zip', url: 'https://example.com/e.zip', filename: '报表.zip' }] };
    const out = buildQuotePart(q, NO_LIB);
    expect(out).toContain('📎 被引用的文件: 报表.zip');
    expect(out).toContain('https://example.com/e.zip');
  });

  it('既无文字也无附件：仍然什么都不输出（不给空引用块）', () => {
    expect(buildQuotePart({ text: '' }, NO_LIB)).toBe('');
    expect(buildQuotePart(undefined, NO_LIB)).toBe('');
  });
});
