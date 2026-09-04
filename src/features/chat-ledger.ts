/**
 * chat-ledger.ts — 聊天台账(M3 v4, 2026-09-03 新增)
 *
 * 定时唤醒/遥控台要"选一个聊天对象"却要主人手抄 openid——体验失败(主人已吐槽)。
 * 本模块把机器人见过的每个聊天(群/私聊)自动记台账：
 *   {dataDir}/known-chats.jsonl  append-only 一行一条
 *   {ts, scope:'group'|'c2c', id, name?}
 *     - c2c: id=用户 openid, name=用户昵称(QQ 平台给的 senderName)
 *     - group: id=group_openid, name=该群最近一条发言者昵称(群无群名, 用成员名帮主人辨认)
 * host 半边读此文件聚合出"最近聊过的对象"下拉, ④区点选即填 targetId。
 * 中间件挂在 mentionGate 之前(未@消息也流经), 与活性计数同位置。
 *
 * ⚠️ 本地手改功能（fork 新增）：维护清单见工作区根《插件改动维护注意事项.md》。
 */
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';

export interface KnownChatLine {
  ts: number;
  scope: 'group' | 'c2c';
  id: string;
  name?: string;
}

/** 台账文件路径(与图库同 dataDir, host 侧可经 sticker store 推导) */
export function ledgerPath(dataDir: string): string {
  return join(dataDir, 'known-chats.jsonl');
}

/** 由 dsh-qqbot 侧写入(中间件); host 侧只读聚合 */
export function appendLedger(dataDir: string, line: KnownChatLine): void {
  try {
    appendFileSync(ledgerPath(dataDir), JSON.stringify(line) + '\n', 'utf8');
  } catch { /* 台账失败不影响主链 */ }
}

/** host 侧读台账文件(不存在/坏行容错), 返回按 ts 升序的行 */
export function readLedger(dataDir: string): KnownChatLine[] {
  try {
    const raw = readFileSync(ledgerPath(dataDir), 'utf8');
    const lines: KnownChatLine[] = [];
    for (const l of raw.split('\n')) {
      const t = l.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t) as KnownChatLine;
        if (o && typeof o.id === 'string' && (o.scope === 'group' || o.scope === 'c2c')) {
          lines.push({ ts: typeof o.ts === 'number' ? o.ts : 0, scope: o.scope, id: o.id, name: typeof o.name === 'string' ? o.name : undefined });
        }
      } catch { /* 坏行跳过 */ }
    }
    return lines;
  } catch {
    return [];
  }
}

/**
 * 聚合"最近聊过的对象"(供下拉): 每对象保留最近 ts/最近昵称 + 消息数。
 * c2c 优先展示昵称; group 无群名, name=该群最近发言者昵称。
 */
export function aggregateKnownChats(
  lines: KnownChatLine[],
  limit = 60,
): Array<{ scope: 'group' | 'c2c'; id: string; name?: string; lastSeen: number; count: number }> {
  const map = new Map<string, { scope: 'group' | 'c2c'; id: string; name?: string; lastSeen: number; count: number }>();
  for (const l of lines) {
    const key = `${l.scope}:${l.id}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { scope: l.scope, id: l.id, name: l.name, lastSeen: l.ts, count: 1 });
    } else {
      cur.count += 1;
      if (l.ts > cur.lastSeen) {
        cur.lastSeen = l.ts;
        if (l.name) cur.name = l.name; // group: 群名不可得, 用最近发言者昵称帮助辨认
      }
    }
  }
  return [...map.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);
}

/** 台账文件大小(给 host 状态用; 不存在返回 0) */
export function ledgerSize(dataDir: string): number {
  try {
    return statSync(ledgerPath(dataDir)).size;
  } catch {
    return 0;
  }
}

/** 中间件: 记录见过的群/私聊(放 mentionGate 之前, 未@消息也流经) */
export function chatLedgerRecorder(dataDir: string) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    try {
      const msg = ctx.message as { kind?: string; senderId?: string; senderName?: string; groupOpenid?: string };
      const now = Date.now();
      if (msg.kind === 'group' && msg.groupOpenid) {
        appendLedger(dataDir, { ts: now, scope: 'group', id: msg.groupOpenid, name: msg.senderName || undefined });
      } else if ((msg.kind === 'c2c' || msg.kind === 'direct') && msg.senderId) {
        appendLedger(dataDir, { ts: now, scope: 'c2c', id: msg.senderId, name: msg.senderName || undefined });
      }
    } catch { /* 记录失败不影响主链 */ }
    await next();
  };
}
