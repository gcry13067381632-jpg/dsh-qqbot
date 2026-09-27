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
/** 记一条 URL → 本地路径(下载成功时调用) */
export declare function rememberImagePath(url: string, localPath: string): void;
/** 查本地路径(没有/过期 → undefined, 调用方回退原始 URL) */
export declare function lookupImagePath(url: string | undefined, logger?: Logger): string | undefined;
/** 当前缓存条数(诊断用) */
export declare function imagePathCacheSize(): number;
//# sourceMappingURL=image-path-cache.d.ts.map