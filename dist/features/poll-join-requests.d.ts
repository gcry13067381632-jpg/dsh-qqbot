import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
import type { SessionManager } from '../session/index.js';
/**
 * 启动入群申请轮询。config 为 live 引用(设置热更新即时生效); 返回 stop()。
 * 依赖: manager.groupAdmin(GroupAdminClient) + manager(会话寻址/hub)。
 */
export declare function startJoinRequestPolling(manager: SessionManager, config: ImQQBotConfig, logger: Logger): () => void;
//# sourceMappingURL=poll-join-requests.d.ts.map