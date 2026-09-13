/**
 * msg-index.ts — 入站消息短索引台账(2026-09-13 主人定)
 *
 * 背景: 完整 msg_id(ROBOT1.0_… 60+ 字符)每轮注入太耗 token。
 * 方案: 入站时给每条消息发一个**短消息号**(形如 `0913a` = 月日 + base36 流水号),
 *       台账落 `{dataRoot}/.qqbot/msg-index/{peer}/refs.json`(分 dsh 会话/peer 建文件夹),
 *       记录 短号 ↔ 完整 msg_id; 注入给 AI 的只有短号; 出站正文写 [rf:短号] → 查表还原
 *       msg_id → message_reference 以"引用"形式发出。
 * 容量: 每个 peer 目录上限 500 条, 超出 FIFO 淘汰最旧(旧消息本就难再引用)。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 每个 peer 台账上限(超出丢最旧) */
export const MSG_INDEX_MAX = 500;

export interface MsgIndexEntry {
  /** 短消息号(索引), 如 0913a */
  i: string;
  /** 完整 QQ msg_id(ROBOT1.0_…) */
  id: string;
  /** 登记时间 ISO(排查用) */
  t: string;
  /** 发送者 openid(排查用) */
  s?: string;
  /** 发送者昵称(排查用) */
  n?: string;
}

interface StoreFile {
  /** 流水号计数器(base36 递增, 不因淘汰回退) */
  seq: number;
  entries: MsgIndexEntry[];
}

/** peer 文件夹名(scope + 目标 openid; openid 本身是十六进制安全, 兜底清洗特殊字符) */
export function msgIndexPeerKey(scope: string, targetId: string): string {
  return `${scope}_${String(targetId || '').replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/** 台账文件路径: {dataRoot}/.qqbot/msg-index/{peer}/refs.json */
export function msgIndexFile(dataRoot: string, scope: string, targetId: string): string {
  return join(dataRoot, '.qqbot', 'msg-index', msgIndexPeerKey(scope, targetId), 'refs.json');
}

function load(file: string): StoreFile {
  try {
    const d = JSON.parse(readFileSync(file, 'utf8')) as StoreFile;
    if (d && Array.isArray(d.entries)) {
      return { seq: Number(d.seq) || d.entries.length, entries: d.entries };
    }
  } catch { /* 首次/文件损坏 → 空台账 */ }
  return { seq: 0, entries: [] };
}

function save(file: string, data: StoreFile): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data), 'utf8');
  } catch { /* 落盘失败不阻塞消息流 */ }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 登记一条入站消息, 返回短消息号(空 msgId → 返回 '')。
 * 同一 msg_id 重复登记 → 复用原短号(防重试/多中间件重复触发)。
 */
export function registerMsgIndex(
  dataRoot: string,
  scope: string,
  targetId: string,
  msgId: string,
  meta?: { senderId?: string; senderName?: string },
): string {
  const id = String(msgId || '').trim();
  if (!id || !dataRoot) return '';
  const file = msgIndexFile(dataRoot, scope, targetId);
  const data = load(file);
  const dup = data.entries.find((e) => e.id === id);
  if (dup) return dup.i;
  const now = new Date();
  data.seq += 1;
  const idx = `${pad2(now.getMonth() + 1)}${pad2(now.getDate())}${data.seq.toString(36)}`;
  data.entries.push({ i: idx, id, t: now.toISOString(), s: meta?.senderId, n: meta?.senderName });
  if (data.entries.length > MSG_INDEX_MAX) data.entries = data.entries.slice(-MSG_INDEX_MAX);
  save(file, data);
  return idx;
}

/** 按短消息号查完整 msg_id(大小写不敏感); 查不到返回 undefined */
export function resolveMsgIndex(
  dataRoot: string,
  scope: string,
  targetId: string,
  index: string,
): string | undefined {
  const key = String(index || '').trim().toLowerCase();
  if (!key || !dataRoot) return undefined;
  const data = load(msgIndexFile(dataRoot, scope, targetId));
  const hit = data.entries.find((e) => String(e.i).toLowerCase() === key);
  return hit?.id;
}
