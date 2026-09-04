/**
 * sticker-capture.ts — 表情包自动收藏中间件（P0）
 *
 * 群消息里的图片 → fire-and-forget 收藏进本地表情包库（下载/去重/落盘在 sticker-store）。
 *
 * ⚠️ 时机关键：收藏调度必须放在 `await next()` 之前——
 * 未@机器人的群消息会在下游被 mentionGate 截断(链不走到结尾)，
 * 若收藏放在 next() 之后(finally)就永远不触发(线上已踩坑)。
 * 下载本身 fire-and-forget 不 await，不拖慢主链。
 *
 * ⚠️ 本地手改功能（fork 新增）：维护清单见工作区根《插件改动维护注意事项.md》。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.js';
import type { Logger, RawAttachment } from '../types.js';
import { join } from 'node:path';
import { getStickerStore } from '../features/sticker-store.js';
import { autoTagImage } from '../features/sticker-tagger.js';

/** 同进程并发下载上限，防止群图轰炸时打爆连接 */
let inflight = 0;
const MAX_INFLIGHT = 2;

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

/** 调度一次收藏（fire-and-forget，不阻塞调用方） */
function scheduleCapture(
  url: string,
  contentType: string | undefined,
  ctx: MiddlewareContext,
  config: ImQQBotConfig,
  logger: Logger,
): void {
  if (inflight >= MAX_INFLIGHT) return;
  inflight += 1;
  const msg = ctx.message as { attachments?: RawAttachment[]; senderId?: string; senderName?: string; groupOpenid?: string; content?: string };
  const dataDir = config.sticker.dataDir || join(config.cwd || process.cwd(), '表情包');
  const store = getStickerStore(dataDir, logger);
  const senderId = msg.senderId;
  const senderName = msg.senderName;
  const sourceGroup = ctx.message.kind === 'group' ? msg.groupOpenid : undefined;
  const msgText = (msg.content ?? '').trim().slice(0, 120) || undefined;

  void (async () => {
    try {
      const r = await store.capture(url, { sourceGroup, senderId, senderName, msgText, sourceUrl: url }, contentType);
      if (r.status === 'new' && r.id) {
        logger.info(`[sticker] captured #${r.id} (${url.slice(0, 60)}…)`);
        // 候选区软上限: 超 300 张时最久未用的滚进回收站(防膨胀; 数值后续可设置化)
        try { store.cleanupCandidates(300); } catch { /* ignore */ }
        // 顺带物理清掉超 30 天的回收站条目
        try { store.purgeTrashed(); } catch { /* ignore */ }
        // 后台自动打标(可配视觉CLI 生成 tags+desc; 无可用引擎则保持 needsDescribe 待 agent 视觉补)
        try {
          if (config.sticker.autoTagEnabled !== false) {
            const p = store.pathOf(r.id);
            if (p) {
              const tag = await autoTagImage(p, config.sticker.visionCli ?? '', logger);
              if (tag) {
                store.setDescTags(r.id, tag.tags, tag.desc);
                logger.info(`[sticker] 自动打标 #${r.id}: tags=${tag.tags.join('/') || '(启发)'} desc=${tag.desc.slice(0, 40)}…`);
              }
            }
          }
        } catch (err) {
          logger.debug(`[sticker] autotag error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else if (r.status === 'error') {
        logger.debug(`[sticker] capture failed: ${r.error}`);
      }
    } catch (err) {
      logger.debug(`[sticker] capture error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      inflight -= 1;
    }
  })();
}

export function stickerCapture(config: ImQQBotConfig, logger: Logger) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    // 先调度收藏（不等待下载），再走主链 —— 保证被后续截断(未@被门控吞)也照样收藏
    if (config.sticker.collectEnabled) {
      try {
        const msg = ctx.message as { attachments?: RawAttachment[] };
        // content_type 是 MIME(image/jpeg 等)，不能 == 'image'（踩坑修正）
        const images = (msg.attachments ?? [])
          .filter(a => isCollectableImage(a.url) && !isNonImageContentType(a.content_type));
        for (const img of images.slice(0, 3)) {
          scheduleCapture(img.url, img.content_type, ctx, config, logger);
        }
      } catch {
        // 收藏调度失败不影响主链
      }
    }
    await next();
  };
}
