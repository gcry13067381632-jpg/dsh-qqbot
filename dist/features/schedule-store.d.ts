import type { Logger } from '../types.js';
export type TimerKind = 'once' | 'daily';
export interface TimerJob {
    id: string;
    kind: TimerKind;
    /** 目标会话(scope/peerId 与 qqbot sessionKey 对应) */
    scope: 'group' | 'c2c';
    peerId: string;
    /** 每天触发时刻 HH:MM(daily 必填; once 且用 atTime 时也填) */
    atTime?: string;
    /** 一次性: 绝对触发时间(ms); seconds 相对或 atTime 换算后写入 */
    dueAt?: number;
    /** 到点注入会话的提示内容 */
    prompt: string;
    createdAt: number;
    /** daily 上次触发日期(YYYY-MM-DD), 防同一天重复 */
    lastRunDate?: string;
    enabled: boolean;
}
export interface TimerCreateInput {
    kind?: TimerKind;
    scope: 'group' | 'c2c';
    peerId: string;
    /** 相对秒(once; 至少与 atTime 一个) */
    seconds?: number;
    /** 几点几分 HH:MM(24h; daily 必填; once 可选=今天该点, 已过则明天) */
    atTime?: string;
    prompt: string;
}
export declare class ScheduleStore {
    private jobs;
    private saveTimer;
    private dirty;
    readonly dataDir: string;
    private logger?;
    constructor(dataDir: string, logger?: Logger);
    private file;
    private load;
    private save;
    flush(): void;
    /** 新建任务; 返回 {ok, id?, error?}。kind 缺省: atTime 且无 seconds→daily, 否则 once */
    add(input: TimerCreateInput): {
        ok: boolean;
        id?: string;
        error?: string;
    };
    get(id: string): TimerJob | undefined;
    /** 下次触发时间戳(用于展示; once=dueAt, daily=今天该点(已过则明天); 禁用/null) */
    nextFireAt(job: TimerJob, now?: number): number | null;
    list(): TimerJob[];
    remove(id: string): boolean;
    /** 当前应触发的任务(由 ticker 调用) */
    due(now?: number): TimerJob[];
    /** 触发后记账: once 删除; daily 记今天 */
    markDone(id: string): void;
    setEnabled(id: string, enabled: boolean): boolean;
}
/** 配置定时任务实例(启动早期每账号按自己 dataDir 预初始化; 同目录幂等)。ns=实例标识。 */
export declare function configureScheduleStore(dataDir: string, logger?: Logger, ns?: string): ScheduleStore;
/** 获取实例。带 dataDir → 按目录取(不在则容错新建); 带 ns → 按该实例 primary; 无参 → 全局 primary。 */
export declare function getScheduleStore(dataDir?: string, logger?: Logger, ns?: string): ScheduleStore;
//# sourceMappingURL=schedule-store.d.ts.map