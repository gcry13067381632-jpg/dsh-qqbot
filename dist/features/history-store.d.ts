import type { HistoryStore } from '@tencent-connect/qqbot-nodejs';
/** 获取历史存储。带 appId → 按实例(账号)独立 store; 无参 → 共享单例(兼容旧调用)。 */
export declare function getHistoryStore(appId?: string): HistoryStore;
/** 用 appId 前缀隔离群历史（单账号下等价于 groupOpenid，保留多账号扩展） */
export declare function historyGroupKey(appId: string, groupId: string): string;
/** 清空群历史（回复后调用，避免下次 @ 时重复组包） */
export declare function clearGroupHistory(appId: string, groupId: string): void;
//# sourceMappingURL=history-store.d.ts.map