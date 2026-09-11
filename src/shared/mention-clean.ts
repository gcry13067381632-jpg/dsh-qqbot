/**
 * 入站 @bot 长 id 清洗(2026-09-11 主人要求省 token):
 * QQ 群消息里 @bot 时, content 会带 `<@botOpenid>`(32 位 hex 的 bot openid),
 * 原样喂 LLM 每条都耗一截 token(当前消息 + 历史折叠都带)。
 * 策略:
 *  ① 从 mentions 数组(is_you === true)拿 bot 自身 id → 精确替换成短标记 `@bot`;
 *  ② 无 mentions 元数据且 wasMentioned 时, 若 content 里恰好只有 1 个 @ 标记
 *     (群聊 @bot 消息通常只 @ 自己) → 兜底替换成 `@bot`;
 *  ③ 多个 @ 标记且无法区分 → 不动(避免误伤 @ 其他群友, 那些有语义)。
 * 只清入站, 出站 AI 回复里的 <@对方openid>(用于 @ 人)原样保留。
 */

export interface MentionLike {
  id?: string;
  is_you?: boolean;
  is_bot?: boolean;
}

export function replaceBotMention(
  content: string | undefined | null,
  mentions?: MentionLike[] | null,
  wasMentioned?: boolean,
): string {
  const text = String(content ?? '');
  if (!text) return text;

  // ① mentions 精确匹配(is_you → bot 自身 openid)
  const botIds: string[] = [];
  if (Array.isArray(mentions)) {
    for (const m of mentions) {
      if (m?.is_you && m.id) botIds.push(m.id);
    }
  }
  if (botIds.length > 0) {
    let out = text;
    for (const bid of botIds) {
      try {
        out = out.replace(new RegExp(`<@!?${bid}>`, 'g'), '@bot');
      } catch { /* 非法 id 跳过 */ }
    }
    return out;
  }

  // ② 无 mentions 元数据 + wasMentioned + 恰好 1 个 @ 标记 → 兜底替换
  if (wasMentioned) {
    const all = [...text.matchAll(/<@!?([A-Za-z0-9]+)>/g)];
    if (all.length === 1) return text.replace(/<@!?[A-Za-z0-9]+>/g, '@bot');
  }

  return text;
}
