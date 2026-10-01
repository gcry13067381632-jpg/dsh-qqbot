/**
 * 历史行里的引用块回归（2026-10-01 主人实测：**聚合进历史**的那条消息里没有引用块 ——
 * 当前消息有、历史里没有；根因是 quoteRef 挂在链上第 11 步、而记历史在第 4 步）。
 *
 * ⚠️ 一律用**虚构** URL / 昵称（对外红线：真实内容禁入仓库）。
 */
import { describe, expect, it } from 'vitest';
import { foldMedia } from './media-history.js';

const NO_LIB = 'D:/no-such-sticker-dir';

describe('foldMedia — 历史 content 里的引用块', () => {
  it('文字引用：引用原文进历史，且**不带** `[当前]` 标记', () => {
    const out = foldMedia({ content: '这样啊，好老呀', mentions: [], wasMentioned: false }, { text: '原来那句' }, NO_LIB);
    expect(out).toContain('[引]');
    expect(out).toContain('原来那句');
    expect(out).toContain('[/引]');
    expect(out).toContain('这样啊，好老呀');
    expect(out).not.toContain('[当前]');
    // 引用块内部被压成一行（历史行是"一条一行"的形状；正文另起一行，与 `[图片: path]` 同款处理）
    expect(out.split('\n')[0]).toContain('[引]');
    expect(out.split('\n')[0]).toContain('[/引]');
  });

  it('引用纯图片（SDK 只给 `[image]` 占位）：历史里也要能看到是哪张图', () => {
    const out = foldMedia(
      { content: '好老呀', mentions: [], wasMentioned: false },
      { text: '[image]', attachments: [{ contentType: 'image/png', url: 'https://multimedia.example.com/a.png' }] },
      NO_LIB,
    );
    expect(out).toContain('📷 被引用的图片: https://multimedia.example.com/a.png');
    expect(out).not.toContain('[image]');
  });

  it('没有引用时行为不变（只有正文）', () => {
    expect(foldMedia({ content: '在吗', mentions: [], wasMentioned: false }, undefined, NO_LIB)).toBe('在吗');
  });

  it('引用 + 图片附件：两者都在（顺序：引用块在前）', () => {
    const out = foldMedia(
      {
        content: '看这个',
        mentions: [],
        wasMentioned: false,
        attachments: [{ content_type: 'image/png', url: 'https://multimedia.example.com/cur.png' }],
      },
      { text: '被引的话' },
      NO_LIB,
    );
    expect(out.indexOf('[引]')).toBeLessThan(out.indexOf('看这个'));
    expect(out).toContain('[图片: https://multimedia.example.com/cur.png]');
  });
});
