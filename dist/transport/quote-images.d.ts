/** 引用里能拿到的附件形状（SDK 的 QuotedAttachment） */
export interface QuoteImageAttachment {
    contentType?: string;
    url?: string;
    filename?: string;
}
/**
 * 把被引用的图片预取到本地（幂等；已缓存/非图片/非 http 的直接跳过）。
 * @returns 成功预取的张数
 */
export declare function prefetchQuoteImages(quote: {
    attachments?: QuoteImageAttachment[];
} | undefined, dataRoot: string, logger?: {
    debug?: (m: string) => void;
    warn?: (m: string) => void;
}): Promise<number>;
//# sourceMappingURL=quote-images.d.ts.map