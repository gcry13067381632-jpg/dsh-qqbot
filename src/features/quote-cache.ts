/**
 * quote-cache.ts — 引用消息原文缓存（省 token 用）
 *
 * 背景（2026-09-13 主人定）: 引用消息会把**被引用的原文**整段塞进上下文, 引用一长就很吃 token。
 * 现在入站只给**前 N 字**（inbound 里 QUOTE_KEEP, 默认 60), 完整原文落到本地缓存
 * （**每个会话最多 10 条**, 超出丢最旧), AI 需要时用 `quote_view` 工具取（默认最新一条）。
 *
 * 存储: `{dataRoot}/.qqbot/quote-cache.json`
 *   `{ seq: 自增编号, map: { "group:<gid>" | "c2c:<openid>": [{id,text,sender,at}, …] } }`
 * 编号全局自增（人也能在文件里直接看/对号), 每个会话各自留最近 10 条。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 每个会话保留的条数（主人定: 最多 10 条） */
export const QUOTE_CACHE_MAX = 10;

export interface QuoteEntry {
  /** 编号（全局自增, 引用块里会标出来, 如 `引用#12`） */
  id: number;
  /** 被引用的完整原文 */
  text: string;
  /** 引用者昵称(有就给) */
  sender?: string;
  /** 入站时间戳(ms) */
  at: number;
}

interface CacheFile {
  seq: number;
  map: Record<string, QuoteEntry[]>;
}

const cache = new Map<string, CacheFile>();

function fileOf(dataRoot: string): string {
  return join(dataRoot, '.qqbot', 'quote-cache.json');
}

function load(dataRoot: string): CacheFile {
  const hit = cache.get(dataRoot);
  if (hit) return hit;
  let data: CacheFile = { seq: 0, map: {} };
  try {
    const raw = JSON.parse(readFileSync(fileOf(dataRoot), 'utf8')) as CacheFile;
    if (raw && typeof raw === 'object' && raw.map && typeof raw.map === 'object') {
      data = { seq: Number(raw.seq) || 0, map: raw.map };
    }
  } catch { /* 首次/损坏 → 空缓存 */ }
  cache.set(dataRoot, data);
  return data;
}

function save(dataRoot: string, data: CacheFile): void {
  try {
    const p = fileOf(dataRoot);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(data), 'utf8');
  } catch { /* 缓存写失败不影响主链 */ }
}

/** 存一条引用原文, 返回它的编号（超上限丢最旧） */
export function pushQuote(dataRoot: string, key: string, text: string, sender?: string): QuoteEntry {
  const data = load(dataRoot);
  const entry: QuoteEntry = { id: (data.seq += 1), text: String(text || ''), sender, at: Date.now() };
  const list = Array.isArray(data.map[key]) ? data.map[key] : [];
  list.push(entry);
  data.map[key] = list.slice(-QUOTE_CACHE_MAX);
  save(dataRoot, data);
  return entry;
}

/** 某会话的引用列表（新→旧） */
export function listQuotes(dataRoot: string, key: string): QuoteEntry[] {
  const list = load(dataRoot).map[key];
  return Array.isArray(list) ? [...list].reverse() : [];
}

/** 按编号取; 不传 id = 最新一条; 传了但不在本会话 = undefined */
export function getQuote(dataRoot: string, key: string, id?: number): QuoteEntry | undefined {
  const list = load(dataRoot).map[key];
  if (!Array.isArray(list) || list.length === 0) return undefined;
  if (typeof id === 'number' && Number.isFinite(id)) return list.find((x) => x.id === id);
  return list[list.length - 1];
}
