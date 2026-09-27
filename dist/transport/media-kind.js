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
export function inferMediaKind(att) {
    const ct = String(att.content_type ?? '').toLowerCase().trim();
    // ① 显式类型 / MIME（语音最可靠：官方给 'voice'）
    if (ct === 'voice' || ct.startsWith('audio/'))
        return 'voice';
    if (ct === 'image' || ct.startsWith('image/'))
        return 'image';
    if (ct === 'video' || ct.startsWith('video/'))
        return 'video';
    // ② 文件名 / URL 扩展名（次可靠）
    const hay = `${att.filename ?? ''} ${att.url ?? ''}`;
    if (EXT_IMAGE.test(hay))
        return 'image';
    if (EXT_VIDEO.test(hay))
        return 'video';
    if (EXT_VOICE.test(hay))
        return 'voice';
    // ③ 带宽高 → 图片（QQ 只在图片附件上给 width/height）
    if (att.width && att.height)
        return 'image';
    // ④ QQ 媒体下载 URL 特征
    const url = String(att.url ?? '');
    if (url) {
        // orgfmt= 是"原始编码格式"参数，视频实测带 orgfmt=t264(H.264)；图片 URL 没有该参数
        if (/[?&]orgfmt=/i.test(url))
            return 'video';
        const appid = (url.match(/[?&]appid=(\d+)/) ?? [])[1];
        if (appid && APPID_VOICE.has(appid))
            return 'voice';
        if (appid && APPID_IMAGE.has(appid))
            return 'image';
        if (appid && APPID_VIDEO.has(appid))
            return 'video';
    }
    // ⑤ 兜底：content_type='file' 或未知 → 文件
    return 'file';
}
/** 人类可读的类型名（写进 AI 上下文用） */
export function mediaKindLabel(kind) {
    switch (kind) {
        case 'image': return 'Image';
        case 'video': return 'Video';
        case 'voice': return 'Voice';
        default: return 'File';
    }
}
//# sourceMappingURL=media-kind.js.map