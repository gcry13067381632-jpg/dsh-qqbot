/**
 * 引用文本清洗回归（2026-10-01 主人实测：「历史里包含引用的排版太乱了」）。
 *
 * QQ 的引用在 msg_elements 里是一段模板串：
 *   `=== 消息 1 === [消息内容] A [消息类型] 引用消息 [关联消息] --- 第1条 --- [消息内容] B …`
 * 嵌套几层就重复几段 —— 原样进上下文又长又乱。
 */
import { describe, expect, it } from 'vitest';
import { slimQuoteBlockOneLine, slimQuoteText, stripQqQuoteTemplate } from './quote-text.js';

const QQ_TEMPLATE =
  '=== 消息 1 === [消息内容] 呜哇~你们俩好吵 [消息类型] 引用消息 [关联消息] ' +
  '--- 第1条 --- [消息内容] 还敢说话 [消息类型] 引用消息 [关联消息] ' +
  '--- 第1条 --- [消息内容] 必须好好调教 [消息类型] 引用消息';

describe('stripQqQuoteTemplate — 剥 QQ 引用模板壳', () => {
  it('多层模板 → 各层正文，最外层在前', () => {
    expect(stripQqQuoteTemplate(QQ_TEMPLATE)).toEqual(['呜哇~你们俩好吵', '还敢说话', '必须好好调教']);
  });

  it('普通引用原文原样按行返回（不做多余加工）', () => {
    expect(stripQqQuoteTemplate('没啥足')).toEqual(['没啥足']);
    expect(stripQqQuoteTemplate('第一行\n第二行')).toEqual(['第一行', '第二行']);
  });
});

describe('slimQuoteText — 压平 + 限长', () => {
  it('多层只取最外层（= 他真正引用的那句），噪声标记全清掉', () => {
    const out = slimQuoteText(QQ_TEMPLATE, 0);
    expect(out).toBe('呜哇~你们俩好吵');
    expect(out).not.toContain('[消息类型]');
    expect(out).not.toContain('第1条');
    expect(out).not.toContain('[关联消息]');
  });

  it('限长加省略号；max=0 表示不限长', () => {
    expect(slimQuoteText('一二三四五', 3)).toBe('一二三…');
    expect(slimQuoteText('一二三四五', 0)).toBe('一二三四五');
  });
});

describe('slimQuoteBlockOneLine — 历史行用（一行 + 附件行豁免截断）', () => {
  it('压成一行，且 `📷 被引用的图片: <路径>` 不被切掉', () => {
    const blk = [
      '[引]',
      '萝莉魅魔合集很长很长很长很长很长很长很长很长很长很长很长很长很长很长的正文',
      '📷 被引用的图片: D:\\pics\\a.jpg',
      '[/引]',
    ].join('\n');
    const out = slimQuoteBlockOneLine(blk, 10);
    expect(out).toContain('D:\\pics\\a.jpg');   // 关键线索不能被截掉
    expect(out.split('\n').length).toBe(1);    // 一行
    expect(out).toContain('[引]');
  });

  it('空块 → 空串', () => {
    expect(slimQuoteBlockOneLine('', 10)).toBe('');
  });
});
