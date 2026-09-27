/**
 * 出站模式命令：/outmode — 查看/切换四档模式(逃生通道, 2026-09-07)
 *
 * 四档: adaptive=适配主动(默认) / passive=被动 / silent=完全不出站 / nothink=完全不思考。
 * ⚠️ 此命令走 SDK 斜杠直通不经 LLM —— 即使机器人处于 nothink(不思考)也能被主人唤醒:
 *    `/outmode adaptive` 一条即可切回。命令层允许切到 nothink(主人逃生/主动休眠都行),
 *    但 channel-tools 的 AI 工具 outbound_mode 禁止写入 nothink(防机器人自锁)。
 *
 * 切换实现走 outbound-mode-switch 注册表(index.ts 注册): 改 live config 立即热生效 +
 * settings 持久化 → dock/设置面板与 live 三方一致。
 *
 * 切换后通知 AI(回合安全, 2026-09-09 主人定/修复):
 *   斜杠命令不经 LLM → AI 不知道模式被切。用宿主的 agent.inject 注入一条
 *   "模式已切换" 消息(不唤醒)。⚠️ 必须在 AI 回合结束后注入:
 *   回合中(assistant tool_calls 未结算)往会话塞消息会把 tool_calls 与其 tool 结果
 *   拆开 → 下次请求 INVALID_REQUEST(insufficient tool messages)。
 *   做法: 先回执给主人, 后台 await agent.whenIdle()(回合结束)后再 inject ——
 *   与 QQ 入站"回合中攒消息、turn/end 后整批进上下文"同一安全语义。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
export declare function outModeCommand({ manager, config }: CommandDeps): SlashCommand;
//# sourceMappingURL=outmode.d.ts.map