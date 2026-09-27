import type { GroupAdminClient } from '../api/group-admin.js';
/** 任务状态 */
export type BroadcastState = 'draft' | 'queued' | 'sending' | 'partial_failed' | 'done' | 'cancelled';
/** 目标类型 */
export type BroadcastTarget = {
    scope: 'group' | 'c2c';
    peerId: string;
    name?: string;
};
export interface BroadcastTask {
    task_id: string;
    /** text=纯文本 / markdown=markdown 正文 / card=markdown+按钮卡片(2026-09-10 加 card) */
    type: 'text' | 'markdown' | 'card';
    /** card 类型时 keyboard 为官方 keyboard 对象; 其余类型忽略 */
    payload: {
        content: string;
        keyboard?: Record<string, unknown>;
    };
    targets: BroadcastTarget[];
    state: BroadcastState;
    /** 逐目标结果: peerId → { ok, message_id?, err? } */
    results: Record<string, {
        ok: boolean;
        message_id?: string;
        err?: string;
    }>;
    retries: Record<string, number>;
    created_at: number;
    created_by: 'dock' | 'agent';
    confirmed_at?: number;
    done_at?: number;
    cancelled_by?: string;
}
export interface BroadcastStore {
    tasks: BroadcastTask[];
}
export declare function createTask(dataRoot: string, input: {
    type: 'text' | 'markdown' | 'card';
    content: string;
    keyboard?: Record<string, unknown>;
    targets: BroadcastTarget[];
    created_by: 'dock' | 'agent';
}): BroadcastTask;
export declare function confirmTask(dataRoot: string, taskId: string): BroadcastTask | undefined;
export declare function cancelTask(dataRoot: string, taskId: string, by?: string): BroadcastTask | undefined;
export declare function listTasks(dataRoot: string): BroadcastTask[];
export declare function getTask(dataRoot: string, taskId: string): BroadcastTask | undefined;
/**
 * 推进一个 queued/sending 任务(串行逐目标 + 失败退避重试)—— 带并发保护的外层入口。
 * 注意: 本函数是"单步推进"——由调用方(settings-host 定时器或每次请求)驱动,
 * 每步处理 1 个未完成目标; 若同一任务多次调用会串行推进, 天然限频。
 * 返回任务当前状态。
 */
export declare function advanceTask(dataRoot: string, taskId: string, client: GroupAdminClient, opts?: {
    isCancelled?: () => boolean;
}): Promise<BroadcastTask | undefined>;
/** 撤回某任务发给指定目标的某条消息(2 分钟窗口, 由调用方做权限判断) */
export declare function recallTaskMessage(dataRoot: string, taskId: string, peerId: string, client: GroupAdminClient): Promise<{
    ok: boolean;
    err?: string;
    message_id?: string;
}>;
//# sourceMappingURL=broadcast.d.ts.map