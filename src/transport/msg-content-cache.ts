/**
 * 被引用消息的内容台账（2026-10-01 主人实测：**引用纯图片**看不到是哪张图）。
 *
 * 为什么要自己记：
 *   QQ 引用一条**纯图片**消息时，`msg_elements` 里往往只有个文件名（`[image: x.jpg]`）甚至
 *   什么都没有 —— 拿不到 URL / 本地路径，AI 就不知道被引用的是哪张图（实测：群里引用表情包回话，她答非所问）。
 *   而这条消息**入站那一刻**我们手里是有图片本地路径的
 *   （表情包采集中间件已落盘 + image-path-cache 已缓存 URL→本地路径）。
 *   → 入站时把「QQ 的 msg_idx → { 文本, 图片本地路径 }」记进本地台账；解析引用时按 `refKey` 回查补齐。
 *
 * 落盘：`{dataRoot}/.qqbot/msg-content.jsonl`（一行一条；超过 {@link MAX_LINES} 行时只留尾部）。
 *   ⚠️ 只存消息索引与**本机路径**，不存任何凭据；与本机图库同生命周期。
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 单个 peer 保留的台账行数上限（超出只留尾部，防文件无限膨胀） */
const MAX_LINES = 2000;

/** 台账里存的一条：被引用消息的文本 + 图片本地路径 */
export interface MsgContent {
  /** 文本（截断） */
  t?: string;
  /** 图片**本地路径**（入站时由 image-path-cache 解析得到；AI 能直接读） */
  imgs?: string[];
}

interface Row {
  /** peer 键：`group:<openid>` / `c2c:<openid>` */
  p: string;
  /** QQ 的消息索引 msg_idx（引用时就是 refKey） */
  i: string;
  t?: string;
  imgs?: string[];
  at: number;
}

/** 文件路径 → { mtimeKey, index, lines } */
const cache = new Map<string, { key: string; index: Map<string, MsgContent>; lines: number }>();

function fileOf(dataRoot: string): string {
  return join(dataRoot, '.qqbot', 'msg-content.jsonl');
}

function indexKey(peerKey: string, msgIdx: string): string {
  return peerKey + '\u0000' + msgIdx;
}

function load(dataRoot: string): { index: Map<string, MsgContent>; lines: number } {
  const file = fileOf(dataRoot);
  let key = 'missing';
  try {
    const st = statSync(file);
    key = st.mtimeMs + ':' + st.size;
  } catch { /* 还没有台账文件 */ }
  const hit = cache.get(file);
  // 'dirty' = 本进程刚写过，内存比文件新 → 直接用内存，别重读整个文件
  if (hit && (hit.key === key || hit.key === 'dirty')) return { index: hit.index, lines: hit.lines };
  const index = new Map<string, MsgContent>();
  let lines = 0;
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      lines++;
      try {
        const r = JSON.parse(s) as Row;
        if (!r || !r.p || !r.i) continue;
        index.set(indexKey(r.p, r.i), {
          ...(r.t ? { t: r.t } : {}),
          ...(Array.isArray(r.imgs) && r.imgs.length ? { imgs: r.imgs } : {}),
        });
      } catch { /* 坏行跳过 */ }
    }
  } catch { /* 没有文件 */ }
  cache.set(file, { key, index, lines });
  return { index, lines };
}

/**
 * 记一条：这条消息（msgIdx）的文本与图片本地路径。
 * 之后有人**引用它**时，就能靠 `refKey = msgIdx` 回查到"被引用的到底是哪张图"。
 */
export function rememberMsgContent(dataRoot: string, peerKey: string, msgIdx: string, rec: MsgContent): void {
  const idx = String(msgIdx ?? '').trim();
  if (!dataRoot || !peerKey || !idx) return;
  if (!rec.t && !(rec.imgs && rec.imgs.length)) return;   // 没内容可记（纯表情符号之类），跳过
  const { index, lines } = load(dataRoot);
  index.set(indexKey(peerKey, idx), rec);
  const file = fileOf(dataRoot);
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ p: peerKey, i: idx, ...rec, at: Date.now() } as Row) + '\n');
    const nextLines = lines + 1;
    if (nextLines > MAX_LINES) {
      // 超上限 → 重写成尾部 MAX_LINES 条（内存里已有的直接重建）
      const tail: string[] = [];
      for (const [k, v] of index) {
        const pos = k.indexOf('\u0000');
        tail.push(JSON.stringify({ p: k.slice(0, pos), i: k.slice(pos + 1), ...v, at: 0 } as Row));
      }
      writeFileSync(file, tail.slice(-MAX_LINES).join('\n') + '\n', 'utf8');
      cache.set(file, { key: 'dirty', index, lines: Math.min(nextLines, MAX_LINES) });
      return;
    }
    cache.set(file, { key: 'dirty', index, lines: nextLines });
  } catch { /* 落盘失败不影响主链（内存索引已经更新） */ }
}

/** 回查：这条被引用消息（msgIdx）我们记过什么 */
export function lookupMsgContent(dataRoot: string, peerKey: string, msgIdx: string): MsgContent | undefined {
  if (!dataRoot || !peerKey || !msgIdx) return undefined;
  try {
    return load(dataRoot).index.get(indexKey(peerKey, msgIdx));
  } catch {
    return undefined;
  }
}
