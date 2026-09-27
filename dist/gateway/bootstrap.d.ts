/**
 * 网关组装 — 创建 bot、编排中间件、注册事件、出站、生命周期
 *
 * 将 QQ 消息平台作为 dsh 前端协议驱动：入站消息 → handleInbound → dsh agent，
 * dsh session/event → createOutboundHandler → QQ 出站。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type DshAgentRegistry } from '../session/index.js';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
export declare function bootstrapGateway(ctx: Context, agents: DshAgentRegistry, config: ImQQBotConfig, logger: Logger): Promise<void>;
//# sourceMappingURL=bootstrap.d.ts.map