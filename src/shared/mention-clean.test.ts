/**
 * mention-clean 回归（2026-09-15 主人修正"@别人要扣分"后补）。
 *
 * 重点钉死两件事：
 *   ① `replaceBotMention` 只把 **bot 自己** 的长 id 换成短标记 `@bot`（别误伤 @ 其他群友，那有语义）；
 *   ② `mentionsOthers` 的语义是「@ 的是**别人**」，而**不是**「没人 @ 她」——
 *      后者是她该主动接话的常态，拿它扣分是错的（主人亲口纠正过）。
 */
import { describe, expect, it } from 'vitest';
import { replaceBotMention, mentionsOthers } from './mention-clean.js';

const BOT = '49C7A1D43E0018DF6F5E9DAB9C823E28';
const OTHER = 'FB3FB5B8A7B65973682C3CFEEEEFB14A';

describe('replaceBotMention — 只清 bot 自己的 id', () => {
  it('is_you 命中 bot → 换成 @bot', () => {
    expect(replaceBotMention(`<@${BOT}> 在吗`, [{ id: BOT, is_you: true }], true)).toBe('@bot 在吗');
  });

  it('@ 的是别人 → 原样不动（那是语义，不能抹掉）', () => {
    const text = `<@${OTHER}> 看这个`;
    expect(replaceBotMention(text, [{ id: OTHER, is_you: false }], false)).toBe(text);
  });
});

describe('mentionsOthers — @ 的是别人（不是"没人@她"）', () => {
  it('@ 了别人且没 @ 她 → true（该扣分）', () => {
    expect(mentionsOthers([{ id: OTHER, is_you: false }], false)).toBe(true);
  });

  it('一个人都没 @ → false（**这才是她该主动接话的常态，不该扣**）', () => {
    expect(mentionsOthers([], false)).toBe(false);
    expect(mentionsOthers(undefined, false)).toBe(false);
  });

  it('@ 的是她自己 → false（走"必回"，不扣）', () => {
    expect(mentionsOthers([{ id: BOT, is_you: true }], true)).toBe(false);
  });

  it('同时 @ 了她和别人 → false（她被点名了，方向就是她）', () => {
    expect(mentionsOthers([{ id: OTHER, is_you: false }, { id: BOT, is_you: true }], true)).toBe(false);
  });

  it('平台细节：她被 @ 时 mentions 不含 bot 自身，所以只看 wasMentioned 就够', () => {
    // GROUP_AT_MESSAGE_CREATE 的 mentions 是"别人"的列表 —— 若不加 wasMentioned 判断就会被误扣
    expect(mentionsOthers([{ id: OTHER, is_you: false }], true)).toBe(false);
  });
});
