/** 保留天数(14 天: 够出"本周"和"上周对比") */
export declare const KEEP_DAYS = 14;
export interface DayCell {
    name?: string;
    msgs: number;
    mentions: number;
    replies: number;
    imgs: number;
}
/** 记一条(每条群消息调一次): key = `group:<gid>|<senderId>` */
export declare function touchDaily(dataRoot: string, gid: string, senderId: string, opts?: {
    name?: string;
    mention?: boolean;
    reply?: boolean;
    img?: boolean;
}): void;
export interface WeeklyRow {
    key: string;
    name?: string;
    msgs: number;
    mentions: number;
    replies: number;
    imgs: number;
    /** 有互动的天数(体现"常来"还是"来一次爆刷") */
    activeDays: number;
}
/** 汇总最近 days 天(默认 7)的每人数据, 按 msgs 降序 */
export declare function weeklyRows(dataRoot: string, days?: number, now?: number): WeeklyRow[];
/** 台账文件路径(脚本/面板用) */
export declare function ledgerPathOf(dataRoot: string): string;
//# sourceMappingURL=intimacy-ledger.d.ts.map