/**
 * image-url-ledger.ts — 「本地文件名(图库 id) ↔ QQ 图片链接」台账（兜底用）
 *
 * 背景（2026-09-13 主人要求）: 入站消息的图片现在直接给**本地路径**，但本地文件会消失 ——
 *   ● 候选区超 500 张滚动清理（文件搬进回收站，老路径失效）
 *   ● 图库整理 / 手动删除
 * 一旦路径失效，dock/网页端就什么都显示不出来。于是留一本**最近 1000 张图**的
 *   「图库 id → 当时那条 QQ 链接」台账兜底：本地读不到就拿 QQ 链接顶上。
 * 只记图片（主人明确: 音频/视频/文件不用）。
 *
 * 存储: `{表情包目录}/image-url-ledger.jsonl`，一行一条 `{"id","url","at"}`，**追加写**(便宜)，
 *   查表时从后往前找最新一条；文件超过 COMPACT_BYTES 时压缩成"最新 1000 条唯一 id"。
 *   ⚠️ 格式是跨进程契约: 宿主侧 settings-host.js 里有同格式的同步只读实现（那边不能 await）。
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, sep } from 'node:path';

/** 台账文件名（放在表情包目录里，跟图库同生共死） */
export const IMAGE_URL_LEDGER = 'image-url-ledger.jsonl';

/** 上限（主人定: 1000 条） */
const MAX_ENTRIES = 1000;
/** 超过这个体积就压缩一次（追加太多次后回收） */
const COMPACT_BYTES = 1.5 * 1024 * 1024;

interface Entry { id: string; url: string; at: number }

/** 台账绝对路径 */
export function ledgerFileOfStickerDir(stickerDir: string): string {
  return join(stickerDir, IMAGE_URL_LEDGER);
}

/** 图库文件名 → id（`1456cfc6a256.jpg` → `1456cfc6a256`） */
export function stickerIdOfFile(file: string): string {
  const b = basename(String(file || ''));
  const e = extname(b);
  return e ? b.slice(0, -e.length) : b;
}

/**
 * 从图片文件路径推回表情包目录:
 * `…\表情包\lib\candidate\1456cfc6a256.jpg` → `…\表情包`
 * （找不到 `lib` 段就退回上一级，宁可错也别抛异常）
 */
export function stickerDirFromImagePath(imgPath: string): string {
  const p = String(imgPath || '');
  const s = p.includes('\\') ? '\\' : sep;
  const parts = p.split(/[\\/]/);
  const i = parts.lastIndexOf('lib');
  if (i > 0) return parts.slice(0, i).join(s);
  return dirname(p);
}

/** 记录一条「id → QQ 链接」（追加写，失败静默；不影响主链） */
export function recordImageUrl(stickerDir: string, id: string, url: string): void {
  const sid = stickerIdOfFile(id);
  if (!sid || !/^https?:\/\//i.test(String(url || ''))) return;
  const file = ledgerFileOfStickerDir(stickerDir);
  try {
    mkdirSync(stickerDir, { recursive: true });
    appendFileSync(file, JSON.stringify({ id: sid, url: String(url), at: Date.now() } as Entry) + '\n', 'utf8');
  } catch {
    return; // 台账纯兜底，写不进去也不影响收藏/入站
  }
  try {
    if (statSync(file).size > COMPACT_BYTES) compact(file);
  } catch { /* ignore */ }
}

/** 压缩: 只留最新 MAX_ENTRIES 条唯一 id（新→旧顺序不变，最新的在最后） */
function compact(file: string): void {
  const items = loadAll(file);
  const uniq = new Map<string, Entry>();
  for (const it of items) {
    if (uniq.has(it.id)) uniq.delete(it.id); // 重插到末尾 = 视为更新
    uniq.set(it.id, it);
  }
  const kept = [...uniq.values()].slice(-MAX_ENTRIES);
  try {
    writeFileSync(file, kept.map(x => JSON.stringify(x)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
  } catch { /* ignore */ }
}

/** 读全量（坏行跳过） */
function loadAll(file: string): Entry[] {
  let txt = '';
  try {
    txt = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: Entry[] = [];
  for (const line of txt.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s) as Entry;
      if (o && typeof o.id === 'string' && typeof o.url === 'string') out.push({ id: o.id, url: o.url, at: Number(o.at) || 0 });
    } catch { /* 坏行跳过 */ }
  }
  return out;
}

// ── 同步查表 + 缓存（按 mtime/size 失效，跨进程也能拿到最新） ──
const cache = new Map<string, { key: string; index: Map<string, string> }>();

function indexOfFile(file: string): Map<string, string> {
  let key = 'missing';
  try {
    const st = statSync(file);
    key = `${st.mtimeMs}:${st.size}`;
  } catch { /* 文件还不存在 */ }
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.index;
  const index = new Map<string, string>();
  for (const it of loadAll(file)) index.set(it.id, it.url); // 后出现的覆盖前面的 = 最新链接
  cache.set(file, { key, index });
  return index;
}

/** 按「图库 id」或「图片文件路径」查 QQ 链接（查不到返回 undefined） */
export function lookupImageUrl(stickerDir: string, idOrPath: string): string | undefined {
  const id = stickerIdOfFile(idOrPath);
  if (!id) return undefined;
  return indexOfFile(ledgerFileOfStickerDir(stickerDir)).get(id);
}

/** 直接给图片文件路径也能查（内部自己推表情包目录） */
export function lookupImageUrlByPath(imgPath: string): string | undefined {
  return lookupImageUrl(stickerDirFromImagePath(imgPath), imgPath);
}

// ── 反向查: QQ 链接 → 图库 id（省 token: 历史里那条几百字符的长链接能换成短标记/本地路径） ──
const revCache = new Map<string, { key: string; rev: Map<string, string> }>();

/** QQ 链接 → 图库 id（查不到返回 undefined; 反向索引按 mtime/size 缓存） */
export function lookupStickerIdByUrl(stickerDir: string, url: string): string | undefined {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return undefined;
  const file = ledgerFileOfStickerDir(stickerDir);
  let key = 'missing';
  try {
    const st = statSync(file);
    key = `${st.mtimeMs}:${st.size}`;
  } catch { /* 没有台账 */ }
  const hit = revCache.get(file);
  if (hit && hit.key === key) return hit.rev.get(u);
  const rev = new Map<string, string>();
  for (const it of loadAll(file)) rev.set(it.url, it.id); // 后出现的覆盖 = 最新
  revCache.set(file, { key, rev });
  return rev.get(u);
}
