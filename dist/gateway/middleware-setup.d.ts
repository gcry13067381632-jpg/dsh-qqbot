/**
 * SDK 中间件编排
 *
 * 根据插件配置组装 SDK 内置中间件链（洋葱模型）。
 * 中间件负责过滤与上下文富化；最终消息统一由 bot.on('message') 处理转发。
 */
import type { QQBot } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.js';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';
export declare function setupMiddlewares(bot: QQBot, config: ImQQBotConfig, manager: SessionManager, logger: Logger, 
/** ★ 插件的 cordis ctx —— 传给自定义命令当"内核句柄"（env.ctx），见 ext-capabilities.ts */
pluginCtx?: unknown): Promise<void>;
//# sourceMappingURL=middleware-setup.d.ts.map