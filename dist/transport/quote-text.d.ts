/**
 * 剥掉 QQ 引用模板的壳，返回各层正文（**最外层在前**，即"最近被引用的那句话"排第一）。
 * 不是模板串时，按行返回原文（保留原样，只 trim）。
 */
export declare function stripQqQuoteTemplate(s: string): string[];
/**
 * 从 QQ 表情标签里挖**图片线索**。
 *
 * 背景（2026-10-01 主人实测：「图片收藏进了表情里，依然是图片」）：
 *   QQ 的「图片表情 / 收藏表情」在消息里只给一个 `<faceType=…,ext="base64">` 标签。
 *   实测那条 ext = `eyJ0ZXh0IjoiIn0=` → `{"text":""}` —— **里面没有图**（QQ 官方文档也没定义 faceType，
 *   SDK 同样只解 ext.text），所以光靠标签解析不出图；真正的出路是"那条消息入站时的附件"
 *   （走本地台账回查，见 msg-content-cache.ts / quote-images.ts 的预取）。
 *   但不同端/版本的 ext 里**可能**带 url 之类字段 —— 这里全部扫一遍，挖到就当真图片附件用。
 */
export declare function extractFaceImageUrls(text: string): string[];
/**
 * 引用块正文瘦身：剥模板壳 → **只取最外层那一句** → 表情标签转可读 → 压平空白 → 限长。
 *
 * ⚠️ 只取最外层 —— 那才是"他引用的内容"。QQ 给的嵌套链（`[关联消息] --- 第1条 --- [消息内容] …`）
 *   全是"那句话又引用了谁"，又长又乱（主人：「不止是排版乱的问题，这是内容就乱了」）。
 * @param max 最大字数（默认 160；传 0 = 不限长）
 */
export declare function slimQuoteText(s: string, max?: number): string;
/**
 * 把整个 `[引]…[/引]` 块压成**一行**并限长（历史行用）。
 * 附件行不参与截断（否则路径被切掉 = 白记）。
 */
export declare function slimQuoteBlockOneLine(block: string, max?: number): string;
//# sourceMappingURL=quote-text.d.ts.map