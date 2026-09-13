/**
 * bot-reply-memo.ts — 记住"她最近在某个群/私聊里说了什么"（内存级，不落盘）
 *
 * 用途（2026-09-13 主人定）: 相关度信号 `relReply` 要算「当前消息 ↔ **她上一条发言**」的余弦 ——
 *   高 = 有人在接她的话（该回），低 = 群友自己在聊（可以少插话）。
 * 为什么记在内存: 只是当下语境判断, 重启丢一次无所谓; 落盘反而多一次 IO。
 * 写入点: `transport/outbound-buffer.ts` 真正发出文本的那一处（sendMarkdown 前）。
 */
const memo = new Map<string, { text: string; at: number }>();

/** 上限（防长跑内存涨）: 群/私聊各记一份, 200 个会话足够 */
const MAX = 200;

/** 记住她刚发出的一段文本(key = 群 openid / 私聊 openid) */
export function rememberBotReply(key: string, text: string): void {
  const k = String(key || '').trim();
  const t = String(text || '').trim();
  if (!k || !t) return;
  memo.set(k, { text: t.slice(0, 300), at: Date.now() });
  if (memo.size > MAX) {
    const first = memo.keys().next().value;
    if (first) memo.delete(first);
  }
}

/** 取她最近一次发言（超过 10 分钟视为过期 —— 隔太久的那句跟当下语境无关） */
export function lastBotReplyOf(key: string, maxAgeMs = 10 * 60 * 1000): { text: string; at: number } | undefined {
  const hit = memo.get(String(key || '').trim());
  if (!hit) return undefined;
  if (Date.now() - hit.at > maxAgeMs) return undefined;
  return hit;
}
