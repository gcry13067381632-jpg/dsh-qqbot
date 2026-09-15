/**
 * 入站消息标签形状回归（2026-09-15 主人复查"没 @ 的只显示昵称呢?"后加）。
 *
 * 口径（与群历史行一致，见 inbound.ts Layer 3 注释）：
 *   没被 @  → `[昵称 #短号] 正文`
 *   被 @ 了 → `[昵称 (openid) #短号] 正文 (@you)`
 *   短号两边都留 —— 引用标记 + id_lookup 反查 openid 的入口，不能省。
 *   私聊不带发送者标签（peer 就是这个人）。
 */
import { describe, expect, it } from 'vitest';
import { buildUserMessage } from './inbound.js';

const ID = 'FB3FB5B8A7B65973682C3CFEEEEFB14A';

describe('buildUserMessage — 群聊发送者标签', () => {
  it('没被 @：只给昵称 + 短号，不给 openid', () => {
    expect(buildUserMessage('最近有啥好玩的', '', ID, '无名的木偶呦', true, false, '0915u4'))
      .toBe('[无名的木偶呦 #0915u4] 最近有啥好玩的');
  });

  it('被 @ 了：带上 openid（要回 @ 他）+ 正文后 (@you)，短号照旧', () => {
    expect(buildUserMessage('大肥鱼看图', '', ID, '无名的木偶呦', true, true, '0915u4'))
      .toBe(`[无名的木偶呦 (${ID}) #0915u4] 大肥鱼看图 (@you)`);
  });

  it('没有短号时（引用功能关）: 退化成纯昵称 / 昵称+openid', () => {
    expect(buildUserMessage('在吗', '', ID, '无名的木偶呦', true, false, '')).toBe('[无名的木偶呦] 在吗');
    expect(buildUserMessage('在吗', '', ID, '无名的木偶呦', true, true, ''))
      .toBe(`[无名的木偶呦 (${ID})] 在吗 (@you)`);
  });

  it('私聊不带发送者标签（只有消息号一行）', () => {
    expect(buildUserMessage('帮我写个脚本', '', ID, '做早饭', false, false, '0915u4'))
      .toBe('[消息号: 0915u4]\n帮我写个脚本');
  });

  it('引用块照样拼在最前面', () => {
    const quote = '[Quoted message begins]\n原来那句\n[Quoted message ends]\n[Current message]\n';
    expect(buildUserMessage('这句是回的', quote, ID, '亚瑟', true, false, '0915u4'))
      .toBe(`${quote}[亚瑟 #0915u4] 这句是回的`);
  });
});
