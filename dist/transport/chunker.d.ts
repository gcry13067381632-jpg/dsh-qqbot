/**
 * Markdown 文本切分器
 *
 * QQ 单条消息有字符数限制（约 5000），需要在合适边界切分，
 * 并保持 GFM 表格、代码块的完整性。
 */
/**
 * 按换行边界切分 Markdown 文本
 * - 不在代码块中间断开
 * - 不在 GFM 表格中间断开
 * - 优先在空行处断开
 */
export declare function chunkMarkdownText(text: string, limit: number): string[];
//# sourceMappingURL=chunker.d.ts.map