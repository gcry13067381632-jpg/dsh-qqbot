/**
 * inject 命令: /inject <文本> — 把一条消息安全插入当前会话的 LLM 回合(2026-09-10 主人定)
 *
 * 用途(主人 13:00): QQ 里发「/inject 请帮我查一下xxx」, 这条消息会以安全方式注入
 * 本会话上下文, 让 LLM 在回合安全边界看到并"中途处理别的事情"——不打断当前回合、
 * 不拆散 tool_calls↔结果配对。
 *
 * 注入语义(与 group-hub.safeAppendUserMessage 同源):
 *   ① 优先等回合空闲(whenIdle)后 session.append → 干净追加到上下文(web 流可见, 不唤醒);
 *   ② 回合未在窗口内空闲 → agent.inject 排队(next-step, 回合安全, 不唤醒)。
 *
 * 权限: 命令层权限由宿主统一管控(permission 档位); 文本即命令剩余参数。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
export declare function injectCommand({ manager }: CommandDeps): SlashCommand;
//# sourceMappingURL=inject.d.ts.map