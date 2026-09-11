/**
 * 群历史存储共享模块
 *
 * historyBuffer 中间件需要一个跨调用可访问的 HistoryStore 实例，
 * 以便在回复完成后清空某群的历史缓存（避免下次 @ 时重复组包）。
 * 对齐 openclaw-qqbot 的 features/history-store。
 */
import { MemoryHistoryStore } from '@tencent-connect/qqbot-nodejs';
import type { HistoryStore } from '@tencent-connect/qqbot-nodejs';

// ⚠️ 2026-09-11 B类修复: 原 _store 单例被多实例共享(内存 store, key 带 appId 隔离其实无害),
//    但为彻底隔离改为 per-appId —— 每个实例(账号)各持一个 MemoryHistoryStore。
//    getHistoryStore() 无参保留单例兜底(兼容旧调用)。
const _storesByAppId = new Map<string, HistoryStore>();
let _store: HistoryStore | null = null;

/** 获取历史存储。带 appId → 按实例(账号)独立 store; 无参 → 共享单例(兼容旧调用)。 */
export function getHistoryStore(appId?: string): HistoryStore {
  if (appId) {
    let s = _storesByAppId.get(appId);
    if (!s) {
      s = new MemoryHistoryStore();
      _storesByAppId.set(appId, s);
    }
    return s;
  }
  if (!_store) _store = new MemoryHistoryStore();
  return _store;
}

/** 用 appId 前缀隔离群历史（单账号下等价于 groupOpenid，保留多账号扩展） */
export function historyGroupKey(appId: string, groupId: string): string {
  return `${appId}:${groupId}`;
}

/** 清空群历史（回复后调用，避免下次 @ 时重复组包） */
export function clearGroupHistory(appId: string, groupId: string): void {
  (getHistoryStore(appId) as HistoryStore).clear?.(historyGroupKey(appId, groupId));
}
