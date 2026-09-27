/** 每个会话保留的条数（主人定: 最多 10 条） */
export declare const QUOTE_CACHE_MAX = 10;
export interface QuoteEntry {
    /** 编号（全局自增, 引用块里会标出来, 如 `引用#12`） */
    id: number;
    /** 被引用的完整原文 */
    text: string;
    /** 引用者昵称(有就给) */
    sender?: string;
    /** 入站时间戳(ms) */
    at: number;
}
/** 存一条引用原文, 返回它的编号（超上限丢最旧） */
export declare function pushQuote(dataRoot: string, key: string, text: string, sender?: string): QuoteEntry;
/** 某会话的引用列表（新→旧） */
export declare function listQuotes(dataRoot: string, key: string): QuoteEntry[];
/** 按编号取; 不传 id = 最新一条; 传了但不在本会话 = undefined */
export declare function getQuote(dataRoot: string, key: string, id?: number): QuoteEntry | undefined;
//# sourceMappingURL=quote-cache.d.ts.map