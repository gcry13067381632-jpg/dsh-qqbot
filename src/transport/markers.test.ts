/**
 * markers.ts 回归 —— 「块标记」是**跨层契约**（生产/解析/富文本清洗/dock 展示都认这些字面量），
 * 2026-09-15 主人要求省 token 后从英文长标记改成中文短标记，这里把三条铁律钉死：
 *   ① 生产端只用新标记；② **解析端必须同时认老标记**（老会话是渲染时解析的）；
 *   ③ 引用原文里的标记要转义掉，别让它伪造结构。
 */
import { describe, expect, it } from 'vitest';
import {
  MK, MK_LEGACY, QUOTE_BEGIN_ALL, QUOTE_END_ALL,
  hasAnyMarker, findFirstMarker, findLastMarker, escapeBlockMarkers, stripBlockMarkers,
} from './markers.js';

describe('markers — 短标记常量（省 token）', () => {
  it('新标记比老标记短得多（这是省 token 的全部意义）', () => {
    const pairs: Array<[string, string]> = [
      [MK.QUOTE_BEGIN, MK_LEGACY.QUOTE_BEGIN],
      [MK.QUOTE_END, MK_LEGACY.QUOTE_END],
      [MK.CURRENT, MK_LEGACY.CURRENT],
      [MK.HISTORY_BEGIN, MK_LEGACY.HISTORY_BEGIN],
      [MK.HISTORY_END, MK_LEGACY.HISTORY_END],
    ];
    for (const [now, old] of pairs) expect(now.length).toBeLessThan(old.length / 2);
  });

  it('新标记都是 [x] / [/x] 方括号形状（模型看得出是结构标记，文中不会自然出现）', () => {
    for (const m of Object.values(MK)) expect(m).toMatch(/^\[\/?[\u4e00-\u9fa5]+\]$/);
  });
});

describe('findFirstMarker / findLastMarker — 认新旧两套', () => {
  it('新标记：取第一个 begin + 最后一个 end', () => {
    const t = `${MK.QUOTE_BEGIN}\n原话\n${MK.QUOTE_END}\n${MK.CURRENT}\n正文`;
    const b = findFirstMarker(t, QUOTE_BEGIN_ALL)!;
    const e = findLastMarker(t, QUOTE_END_ALL)!;
    expect(t.slice(b.idx + b.len, e.idx).trim()).toBe('原话');
  });

  it('老标记照样认（老会话渲染）', () => {
    const t = `${MK_LEGACY.QUOTE_BEGIN}\n原话\n${MK_LEGACY.QUOTE_END}\n${MK_LEGACY.CURRENT}\n正文`;
    const b = findFirstMarker(t, QUOTE_BEGIN_ALL)!;
    const e = findLastMarker(t, QUOTE_END_ALL)!;
    expect(t.slice(b.idx + b.len, e.idx).trim()).toBe('原话');
  });

  it('原文里自带假 end 标记时，取**最后一个** end 才不会截断（2026-09-13 踩过的坑）', () => {
    const t = `${MK.QUOTE_BEGIN}\n他说 ${MK.QUOTE_END} 是结束标记\n${MK.QUOTE_END}\n${MK.CURRENT}\n正文`;
    const e = findLastMarker(t, QUOTE_END_ALL)!;
    const b = findFirstMarker(t, QUOTE_BEGIN_ALL)!;
    expect(t.slice(b.idx + b.len, e.idx)).toContain('是结束标记');
  });

  it('没有标记 → undefined', () => {
    expect(findFirstMarker('就是一句普通聊天', QUOTE_BEGIN_ALL)).toBeUndefined();
    expect(findLastMarker('就是一句普通聊天', QUOTE_END_ALL)).toBeUndefined();
  });
});

describe('escapeBlockMarkers — 引用原文里的标记退化成圆括号', () => {
  it('新旧标记都转义（转义后不再参与结构匹配）', () => {
    expect(escapeBlockMarkers(`${MK.QUOTE_BEGIN} 和 ${MK.QUOTE_END}`)).toBe('(引) 和 (/引)');
    expect(escapeBlockMarkers('[Quoted message begins] 和 [Quoted message ends]'))
      .toBe('(Quoted message begins) 和 (Quoted message ends)');
  });

  it('大小写变体也转义（老标记是英文）', () => {
    expect(escapeBlockMarkers('[quoted message ends]')).toBe('(Quoted message ends)');
  });
});

describe('stripBlockMarkers / hasAnyMarker — 打分与判断用', () => {
  it('抹掉新旧标记，只留正文', () => {
    expect(stripBlockMarkers(`${MK.QUOTE_BEGIN}\n原话\n${MK.QUOTE_END}\n${MK.CURRENT}\n帮我看看`).replace(/\s+/g, ' ').trim())
      .toBe('原话 帮我看看');
    expect(stripBlockMarkers('[Quoted message begins] 他说的 [Quoted message ends] 我的回复').replace(/\s+/g, ' ').trim())
      .toBe('他说的 我的回复');
  });

  it('hasAnyMarker 新旧都认，普通聊天为 false', () => {
    expect(hasAnyMarker(`${MK.HISTORY_BEGIN}\n[a] 在吗`)).toBe(true);
    expect(hasAnyMarker('[Chat history ends]')).toBe(true);
    expect(hasAnyMarker('就是一句普通聊天 [图片]')).toBe(false);
  });
});
