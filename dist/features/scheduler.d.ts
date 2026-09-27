import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
import type { SessionManager } from '../session/index.js';
/**
 * 启动定时调度器。返回 stop()：停止轮询并落盘。
 * config 为 live 对象引用(schedule.targets 现读, Web 设置热更新即时生效)。
 */
export declare function startScheduler(manager: SessionManager, config: ImQQBotConfig, logger: Logger): () => void;
//# sourceMappingURL=scheduler.d.ts.map