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
/**
 * 推断附件的真实媒体类型。
 * 顺序即优先级：显式 MIME > 扩展名 > 宽高 > QQ URL 特征 > 兜底 file。
 */
export declare function inferMediaKind(att: KindableAttachment | RawAttachment): MediaKind;
/** 人类可读的类型名（写进 AI 上下文用） */
export declare function mediaKindLabel(kind: MediaKind): string;
//# sourceMappingURL=media-kind.d.ts.map