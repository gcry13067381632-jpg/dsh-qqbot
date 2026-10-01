/**
 * 引用文本清洗（2026-10-01 主人实测：「历史里包含引用的排版太乱了」）。
 *
 * QQ 的「引用消息」在 `msg_elements` 里是一段**模板串**，形如：
 *   `=== 消息 1 === [消息内容] 呜哇~… [消息类型] 引用消息 [关联消息] --- 第1条 ---
 *      [消息内容] 还敢说话，再干干你 [消息类型] 引用消息 [关联消息] --- 第1条 ---
 *      [消息内容] 必须好好调教 …`
 * 嵌套几层就重复几段，每段还夹着 `[消息类型]` / `[关联消息]` / `引用消息` 这种**纯噪声** ——
 * 原样塞进上下文又长又乱（主人：看不懂是谁引用了什么）。
 *
 * 这里做两件事：
 *   ① {@link stripQqQuoteTemplate} 剥壳：只留各层正文，按 `最外层 → … → 更早` 的顺序返回；
 *   ② {@link slimQuoteText} 压平：把链压成 `A ← B ← C`（← 读作"引用了"），并限长。
 *
 * ⚠️ 只去噪声、不去信息：非模板串（普通引用原文）原样按行返回。
 */
/**
 * 剥掉 QQ 引用模板的壳，返回各层正文（**最外层在前**，即"最近被引用的那句话"排第一）。
 * 不是模板串时，按行返回原文（保留原样，只 trim）。
 */
export declare function stripQqQuoteTemplate(s: string): string[];
/**
 * 引用块正文瘦身：剥模板壳 → 多层压成 `A ← B ← C` → 压平空白 → 限长。
 * @param max 最大字数（默认 160；超出截断加 `…`）
 */
export declare function slimQuoteText(s: string, max?: number): string;
/**
 * 把整个 `[引]…[/引]` 块压成**一行**并限长（历史行用）。
 * 附件行不参与截断（否则路径被切掉 = 白记）。
 */
export declare function slimQuoteBlockOneLine(block: string, max?: number): string;
//# sourceMappingURL=quote-text.d.ts.map