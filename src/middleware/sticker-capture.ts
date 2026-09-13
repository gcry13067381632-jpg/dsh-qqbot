/**
 * sticker-capture.ts — 表情包自动收藏中间件（P0）
 *
 * 群消息里的图片 → 收藏进本地表情包库（下载/去重/落盘在 sticker-store），
 * 并把「URL → 本地路径」记进 image-path-cache，供入站消息**直接写本地路径**
 * （2026-09-13 主人要求：看图不用再下载一次，token 也更短；下载失败自动回退 QQ 链接）。
 *
 * ⚠️ 时机关键：收藏调度必须放在 `await next()` 之前——
 * 未@机器人的群消息会在下游被 mentionGate 截断(链不走到结尾)，
 * 若收藏放在 next() 之后(finally)就永远不触发(线上已踩坑)。
 *
 * ⚠️ 2026-09-13 主人定稿：**只等"下载已发起"就放行**(即主链 0 等待)——
 *   下载 fire-and-forget 跑，落盘后把「URL→本地路径」补进 image-path-cache；
 *   消息组装时**检索得到就给本地路径，检索不到就回退 QQ 链接**(不影响正确性)。
 *   自动打标(视觉 CLI)同样永远后台，绝不挡主链。
 *
 * ⚠️ 本地手改功能（fork 新增）：维护清单见工作区根《插件改动维护注意事项.md》。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.js';
import { stickerDirOf } from '../gateway/data-root.js';
import type { Logger, RawAttachment } from '../types.js';
import { getStickerStore } from '../features/sticker-store.js';
import { autoTagImage } from '../features/sticker-tagger.js';
import { rememberImagePath } from '../features/image-path-cache.js';
import { recordImageUrl } from '../features/image-url-ledger.js';

/** 同进程并发下载上限，防止群图轰炸时打爆连接 */
let inflight = 0;
const MAX_INFLIGHT = 3;

/** 候选区软上限(2026-09-13 主人定: 300 → 500) —— 超出的最久未见条目滚进回收站 */
const MAX_CANDIDATES = 500;

/** 单条消息里最多顺手收几张图 */
const MAX_PER_MSG = 3;

/** 图片 URL 是否可收藏（仅 https + 看似 QQ 图片下载链接） */
function isCollectableImage(url: string | undefined): url is string {
  return !!url && /^https:\/\//i.test(url) && /multimedia|qq\.com|download/i.test(url);
}

/**
 * 类型粗筛：SDK 的 content_type 是 MIME(如 image/jpeg —— 已实测不是 'image')。
 * 明确非图片(音/视频)的排除；未知/缺失交给 store 的魔数校验兜底(非图不入库)。
 */
function isNonImageContentType(ct: string | undefined): boolean {
  if (!ct) return false;
  const t = ct.toLowerCase();
  return t.startsWith('audio/') || t.startsWith('video/') || t === 'voice';
}

/** 收藏一张图（落盘 + 记住本地路径）；返回本地路径（失败/并发超限返回 undefined） */
async function captureOne(
  url: string,
  contentType: string | undefined,
  ctx: MiddlewareContext,
  config: ImQQBotConfig,
  logger: Logger,
): Promise<string | undefined> {
  if (inflight >= MAX_INFLIGHT) return undefined;
  inflight += 1;

  const msg = ctx.message as { attachments?: RawAttachment[]; senderId?: string; senderName?: string; groupOpenid?: string; content?: string };
  const stickerDir = stickerDirOf(config);
  const store = getStickerStore(stickerDir, logger);
  const senderId = msg.senderId;
  const senderName = msg.senderName;
  const sourceGroup = ctx.message.kind === 'group' ? msg.groupOpenid : undefined;
  const msgText = (msg.content ?? '').trim().slice(0, 120) || undefined;

  let resolved: { status: 'new' | 'dup' | 'error'; id?: string; error?: string };
  try {
    resolved = await store.capture(url, { sourceGroup, senderId, senderName, msgText, sourceUrl: url }, contentType);
  } catch (err) {
    inflight -= 1;
    logger.debug(`[sticker] capture error: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  inflight -= 1;

  if (!resolved.id) {
    if (resolved.status === 'error') logger.debug(`[sticker] capture failed: ${resolved.error}`);
    return undefined;
  }

  // 台账兜底(2026-09-13 主人要求, 只图片): 记「图库 id → 这条 QQ 链接」——
  //   本地文件日后被清理/搬层/删掉时, dock 还能拿这条链接把图显示出来。上限 1000 条。
  recordImageUrl(stickerDir, resolved.id, url);

  const localPath = store.pathOf(resolved.id);
  if (localPath) rememberImagePath(url, localPath);

  if (resolved.status === 'new') {
    logger.debug(`[sticker] captured #${resolved.id} → ${localPath ?? '(path?)'}`);
    // 候选区软上限 + 回收站物理清理（纯本地操作，同步做完很快）
    try { store.cleanupCandidates(MAX_CANDIDATES); } catch { /* ignore */ }
    try { store.purgeTrashed(); } catch { /* ignore */ }
    // 后台自动打标(可配视觉CLI 生成 tags+desc; 无可用引擎则保持 needsDescribe 待 agent 视觉补)
    if (localPath && config.sticker.autoTagEnabled !== false) {
      void (async () => {
        try {
          const tag = await autoTagImage(localPath, config.sticker.visionCli ?? '', logger);
          if (tag) {
            store.setDescTags(resolved.id!, tag.tags, tag.desc);
            logger.debug(`[sticker] 自动打标 #${resolved.id}: tags=${tag.tags.join('/') || '(启发)'} desc=${tag.desc.slice(0, 40)}…`);
          }
        } catch (err) {
          logger.debug(`[sticker] autotag error: ${err instanceof Error ? err.message : String(err)}`);
        }
      })();
    }
  } else {
    logger.debug(`[sticker] dup #${resolved.id} (已在库, 只刷新 lastSeenAt)`);
  }
  return localPath;
}

export function stickerCapture(config: ImQQBotConfig, logger: Logger) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    // 先"发起"下载（不等它完成），再走主链 —— 保证被后续截断(未@被门控吞)也照样收藏。
    // ⚠️ 2026-09-13 主人定稿：主链**0 等待**，落盘后路径才异步补进 image-path-cache，
    //   所以这条消息未必用得上本地路径(检索不到就回退 QQ 链接) —— 这是刻意取舍：宁可用链接也不拖入站。
    if (config.sticker.collectEnabled) {
      try {
        const msg = ctx.message as { attachments?: RawAttachment[] };
        // content_type 是 MIME(image/jpeg 等)，不能 == 'image'（踩坑修正）
        const images = (msg.attachments ?? [])
          .filter(a => isCollectableImage(a.url) && !isNonImageContentType(a.content_type))
          .slice(0, MAX_PER_MSG);
        for (const img of images) {
          void captureOne(img.url, img.content_type, ctx, config, logger).catch(() => undefined);
        }
      } catch {
        // 收藏调度失败不影响主链
      }
    }
    await next();
  };
}
