import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
import type { SessionManager } from '../session/index.js';
export interface HubNotice {
    /** 事件类型(文案前缀/分类用) */
    kind: 'join_request' | 'member_add' | 'add_robot';
    /** 群 openid */
    gid: string;
    /** 群内成员/操作者 openid(有则给) */
    memberOpenid?: string;
    /** 昵称(join_request 有 username; member_add 事件不带) */
    name?: string;
    /** 额外说明(申请来源/验证/风险等) */
    extra?: string;
}
/**
 * 回合安全地把一条"模拟用户消息"append 进目标会话(web 流可见、不唤醒、不坏记录)。
 * 优先级: ①agent.whenIdle() 空闲后 session.append; ②无 whenIdle 时 agent.inject(宿主回合安全)。
 * @returns 'ok' | 'no-agent' | 'no-append' | 'busy' | 'fail'
 */
export declare function safeAppendUserMessage(agent: unknown, text: string, logger: Logger): Promise<'ok' | 'no-agent' | 'no-append' | 'busy' | 'fail'>;
/**
 * 群事件 → 群组管理器会话(hub)注入。hubSessionId 空/hubNotify=false → 'no-hub'。
 * 会话寻址: manager.findBySessionId(hubSessionId)(宿主 QQ 会话 record, fork 后仍为当前 id)。
 * @returns 'ok' | 'no-hub' | 'no-session' | 其它见 safeAppendUserMessage
 */
export declare function notifyGroupHub(manager: SessionManager, config: ImQQBotConfig, logger: Logger, ev: HubNotice): Promise<string>;
/**
 * 判断某 scope/peer 是否就是群组管理器(hub)会话绑定的目标(2026-09-11):
 * 事件/poll 通知申请所在群前调用——申请群即 hub 群时, hub 注记已覆盖,
 * 再对同一会话 notifyGroup/wakeGroup 就是重复。返回 true=应跳过。
 */
export declare function isHubPeerOf(manager: SessionManager, config: ImQQBotConfig, scope: 'group' | 'c2c', peerId: string): Promise<boolean>;
/**
 * 唤醒指定会话的 LLM: 把 text 作为"用户消息" followup 给该会话的 agent,
 * AI 开回合即可主动处理。可用于 hub 轮询唤醒, 也可跨会话发送+唤醒(工具用)。
 * @returns 'ok' | 'no-session' | 'no-followup' | 'fail'
 */
export declare function wakeSessionAgent(manager: SessionManager, sessionId: string, logger: Logger, text: string): Promise<string>;
/**
 * 唤醒群组管理器会话的 LLM(轮询用): 把待审批摘要 followup 给 hub 会话的 agent,
 * AI 开回合即可主动处理(查列表/按主人指令批拒)。不依赖普通群会话。
 * @returns 'ok' | 'no-hub' | 'no-session' | 'no-followup'
 */
export declare function wakeHubAgent(manager: SessionManager, config: ImQQBotConfig, logger: Logger, text: string): Promise<string>;
/** GROUP_MEMBER_ADD: 新成员入群 → 记成员台账(事件无 username, 只落 openid)+ hub 通知 */
export declare function handleGroupMemberAddEvent(data: unknown, opts: {
    config: ImQQBotConfig;
    logger: Logger;
    manager: SessionManager;
}): Promise<boolean>;
/** GROUP_ADD_ROBOT: 机器人被拉进新群 → 记群台账(known-chats group 首见)+ hub 通知 */
export declare function handleGroupAddRobotEvent(data: unknown, opts: {
    config: ImQQBotConfig;
    logger: Logger;
    manager: SessionManager;
}): Promise<boolean>;
/** 与 chat-ledger 同 dataDir(表情包目录)的取法: **dataRootOf(config)** + 表情包
 *  ⚠️ 2026-09-12 补漏: 原来写的是 `config.dataRoot || config.cwd` —— 未配 dataRoot 的实例会落到工作目录,
 *  而且不会走新的默认数据根(`{cwd}/dshqqbot`), 与其它模块分裂成两份台账。 */
export declare function joinDataDir(config: ImQQBotConfig): string;
//# sourceMappingURL=group-hub.d.ts.map