/**
 * image-path-cache.ts — QQ 图片 URL → 本地文件路径 的小缓存
 *
 * 背景(2026-09-13 主人要求): 入站消息里原来只给 QQ 的临时下载 URL
 * (`https://multimedia.nt.qq.com.cn/download?fileid=…&rkey=…` —— 又长又会过期),
 * 结果 AI 要"看图"时还得再下一次(而且它下不动); 现在收藏插件本来就会把图落盘,
 * 于是**直接把本地路径写进消息**, token 更短、看图直接读盘。
 *
 * 为什么用模块级缓存而不是 ctx.state:
 *   - 聚合/连发(debounce)路径 flush 时会**新建 state** 再调 handleInbound,
 *     中间件阶段挂在 ctx.state 上的东西到那时就丢了;
 *   - 同一张图在"中间件阶段"与"消息组装阶段"用的 key 就是那个 URL 本身, 直接按 URL 查最稳。
 *
 * 失效: TTL 1 小时(候选区会滚动清理, 过期后回退用原始 URL) + 容量上限 800 条(超出淘汰最旧)。
 */
import type { Logger } from '../types.js';

interface Entry {
  /** 本地绝对路径 */
  p: string;
  /** 写入时间戳(ms) */
  t: number;
}

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 800;

const cache = new Map<string, Entry>();

/** 记一条 URL → 本地路径(下载成功时调用) */
export function rememberImagePath(url: string, localPath: string): void {
  if (!url || !localPath) return;
  cache.set(url, { p: localPath, t: Date.now() });
  if (cache.size > MAX_ENTRIES) {
    // Map 保留插入顺序 → 最旧的就是第一个
    const over = cache.size - MAX_ENTRIES;
    let i = 0;
    for (const k of cache.keys()) {
      cache.delete(k);
      if (++i >= over) break;
    }
  }
}

/** 查本地路径(没有/过期 → undefined, 调用方回退原始 URL) */
export function lookupImagePath(url: string | undefined, logger?: Logger): string | undefined {
  if (!url) return undefined;
  const e = cache.get(url);
  if (!e) return undefined;
  if (Date.now() - e.t > TTL_MS) {
    cache.delete(url);
    logger?.debug(`[img-path] 缓存过期, 回退 URL: ${url.slice(0, 60)}…`);
    return undefined;
  }
  return e.p;
}

/** 当前缓存条数(诊断用) */
export function imagePathCacheSize(): number {
  return cache.size;
}
