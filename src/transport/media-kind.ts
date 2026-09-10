/**
 * media-kind.ts — 附件真实媒体类型推断（单一真源）
 *
 * ⚠️ 2026-09-10 根因修复（主人实测 + dock 接口取证）:
 *   QQ 群消息里「图片 / 视频」附件的 `content_type` 实测为 `'file'`（**不是** 'image'/'video'），
 *   直接按 content_type 分支会让图片和视频全程被当文件：
 *     ① Layer 1 `describeAttachments` 只给 `[File: 名 (大小)]`；
 *     ② Layer 4 给 `- File: 名 → url`；
 *     ③ dock(chatAttachmentKind 见 `- File:`) 渲染成 `📎 download` —— 图片不显示、视频不能播；
 *     ④ `inject-rules` 的 hasImage() 依赖 content_type 含 'image' → 读图小提醒**永不触发**。
 *   取证: GET /api/qqbot-settings/chat/history 返回
 *     {kind:'file', name:'download', url:'https://multimedia.nt.qq.com.cn/download?appid=1415&format=origin&orgfmt=t264…'}
 *   （name='download' 只能出自 chatFileDisplayName(URL 尾段)，即 dock 走了 `- File:` 分支。）
 *
 *   因此类型判定必须综合多路证据，**不能盲信 content_type**：
 *     MIME → 文件名/URL 扩展名 → 宽高(QQ 只给图片带尺寸) → QQ 媒体 URL 特征(appid/orgfmt)。
 */
import type { RawAttachment } from '../types.js';

/** 归一化后的媒体类型（inbound / 历史折叠 / 类型推断 共用的四种） */
export type MediaKind = 'image' | 'video' | 'voice' | 'file';

/** 推断所需的最小形状：RawAttachment 与 media-history 的折叠对象都能直接传入 */
export interface KindableAttachment {
  content_type?: string;
  filename?: string;
  url?: string;
  width?: number;
  height?: number;
  asr_refer_text?: string;
}

// 扩展名匹配: 后面必须是查询串/锚点/空白/结尾 —— 因为判定用的 haystack 是
// `${filename} ${url}` 的拼接串, 文件名后面紧跟的是空格而不是行尾(踩坑: 漏了 \s 会导致 .mp4 判不出视频)
const EXT_IMAGE = /\.(?:jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?)(?:[?#\s]|$)/i;
const EXT_VIDEO = /\.(?:mp4|mov|m4v|webm|avi|mkv|flv|wmv|mpe?g|3gp)(?:[?#\s]|$)/i;
const EXT_VOICE = /\.(?:silk|amr|mp3|wav|ogg|oga|opus|m4a|aac|flac|wma)(?:[?#\s]|$)/i;

/** QQ 富媒体下载 URL 的业务 appid（实测样本: 1403 语音 / 1407 图片 / 1415 视频） */
const APPID_VOICE = new Set(['1403']);
const APPID_IMAGE = new Set(['1406', '1407']);
const APPID_VIDEO = new Set(['1415']);

/**
 * 推断附件的真实媒体类型。
 * 顺序即优先级：显式 MIME > 扩展名 > 宽高 > QQ URL 特征 > 兜底 file。
 */
export function inferMediaKind(att: KindableAttachment | RawAttachment): MediaKind {
  const ct = String(att.content_type ?? '').toLowerCase().trim();

  // ① 显式类型 / MIME（语音最可靠：官方给 'voice'）
  if (ct === 'voice' || ct.startsWith('audio/')) return 'voice';
  if (ct === 'image' || ct.startsWith('image/')) return 'image';
  if (ct === 'video' || ct.startsWith('video/')) return 'video';

  // ② 文件名 / URL 扩展名（次可靠）
  const hay = `${att.filename ?? ''} ${att.url ?? ''}`;
  if (EXT_IMAGE.test(hay)) return 'image';
  if (EXT_VIDEO.test(hay)) return 'video';
  if (EXT_VOICE.test(hay)) return 'voice';

  // ③ 带宽高 → 图片（QQ 只在图片附件上给 width/height）
  if (att.width && att.height) return 'image';

  // ④ QQ 媒体下载 URL 特征
  const url = String(att.url ?? '');
  if (url) {
    // orgfmt= 是"原始编码格式"参数，视频实测带 orgfmt=t264(H.264)；图片 URL 没有该参数
    if (/[?&]orgfmt=/i.test(url)) return 'video';
    const appid = (url.match(/[?&]appid=(\d+)/) ?? [])[1];
    if (appid && APPID_VOICE.has(appid)) return 'voice';
    if (appid && APPID_IMAGE.has(appid)) return 'image';
    if (appid && APPID_VIDEO.has(appid)) return 'video';
  }

  // ⑤ 兜底：content_type='file' 或未知 → 文件
  return 'file';
}

/** 人类可读的类型名（写进 AI 上下文用） */
export function mediaKindLabel(kind: MediaKind): string {
  switch (kind) {
    case 'image': return 'Image';
    case 'video': return 'Video';
    case 'voice': return 'Voice';
    default: return 'File';
  }
}
