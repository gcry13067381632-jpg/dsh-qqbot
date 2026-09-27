import type { QQBotSender } from '../transport/outbound-buffer.js';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
import type { SessionManager } from '../session/index.js';
/** 官方 GROUP_JOIN_REQUEST 事件体(与本项目用到的字段) */
export interface GroupJoinRequestEvent {
    group_openid?: string;
    join_request_id?: string;
    member_openid?: string;
    username?: string;
    apply_at?: string;
    apply_source?: 'self_apply' | 'invited';
    invited_by?: string;
    risk_tips?: string;
    union_openid?: string;
    bot?: boolean;
    verify_info?: {
        method?: string;
        verify_message?: string;
        review_qa_list?: Array<{
            question: string;
            answer: string;
        }>;
    };
    auto_approved?: {
        strategy_id?: string;
    };
    [key: string]: unknown;
}
/** pending 待办条目(落盘, UI/工具可读) */
export interface PendingJoinRequest {
    group_openid: string;
    join_request_id: string;
    member_openid: string;
    username?: string;
    apply_at?: string;
    apply_source?: string;
    invited_by?: string;
    risk_tips?: string;
    verify_message?: string;
    /** 事件到达时间(本机 ISO) */
    seen_at: string;
    /** 是否已发过群内提醒 */
    notified: boolean;
}
/** 追加一条 pending(按 join_request_id 去重, 最新在前; 写入时顺带清掉超期条目) */
export declare function pushPendingJoinRequest(cwd: string | undefined, ev: PendingJoinRequest): void;
/** 读某群 pending(UI/工具用; gid 空 = 全部); 只返回 1 天内的 */
export declare function readPendingJoinRequests(cwd: string | undefined, gid?: string): PendingJoinRequest[];
/**
 * 处理一条 GROUP_JOIN_REQUEST 事件(rawEvent 数据):
 *   ① auto_approved 下行(自动审批已通过)→ 仅记审计, 不打扰;
 *   ② 否则去重 → pending 落盘 → **注入该群 agent 的 inbox(next-step 队列, wakeup=false)**:
 *      - 等效"模拟用户消息 + 不触发模型回合"(dsh 底层: agent.inject = send(msg,'next-step',wakeup:false),
 *        区别于 followup 的唤醒; 消息持久化在会话, 等主人下一条真人消息开回合时同批进 AI 上下文)
 *      - 宿主 agent 无 inject 能力/无活跃会话 → 兜底发一条 QQ 群静态提醒卡片(不静默丢)
 * @returns true = 事件被消费(记录/注入), false = 忽略(重复或无效)
 */
export declare function handleGroupJoinRequestEvent(data: unknown, opts: {
    sender: QQBotSender;
    config: ImQQBotConfig;
    logger: Logger;
    manager: SessionManager;
}): Promise<boolean>;
//# sourceMappingURL=group-join-request.d.ts.map