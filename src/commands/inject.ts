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
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { CommandDeps } from './types.js';
import { getScopePeer } from '../shared/index.js';

/** 等回合空闲的最长等待(ms): 空闲立即返回; 超时降级 inject 排队 */
const INJECT_IDLE_WAIT_MS = 8_000;

export function injectCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'inject',
    description: '插入消息到本会话 LLM 回合(用法: /inject 文本; AI 会在安全边界读到并处理)',
    handler: async (cmdCtx) => {
      const text = String((cmdCtx.command?.raw ?? '').trim());
      if (!text) {
        return '用法: `/inject 文本` —— 把这条消息安全插入当前会话, AI 会在回合安全边界读到并处理(不打断当前回合)。示例: `/inject 待会记得提醒我下午开会`';
      }
      const { scope, peerId } = getScopePeer(cmdCtx as never);
      const record = manager.findByPeer(scope, peerId);
      const agent = record?.agent as
        | ({ whenIdle?: () => Promise<void>; inject?: (m: unknown) => void } & {
            session?: { append?: (type: string, data: unknown, opts?: { surfaceOp?: string }) => unknown };
          })
        | undefined;
      if (!agent) return '⚠️ 找不到当前会话的 AI 实例, 注入失败(稍后重试或发在机器人所在会话)';

      const msg = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      });

      // ① 等回合空闲后 session.append(主人硬约束: 回合中 append 坏记录)
      if (agent.session && typeof agent.session.append === 'function') {
        if (typeof agent.whenIdle === 'function') {
          let idle = false;
          try {
            await Promise.race([
              agent.whenIdle().then(() => { idle = true; }),
              new Promise((resolve) => setTimeout(resolve, INJECT_IDLE_WAIT_MS)),
            ]);
          } catch { /* whenIdle 异常按未空闲处理 */ }
          if (!idle) {
            // 回合未在窗口内空闲 → 降级宿主 inject 排队(回合安全, 不唤醒, 不拆 tool_calls)
            if (typeof agent.inject === 'function') {
              try {
                agent.inject(msg);
                return '✅ 已注入(回合进行中, 排队到下个安全边界; AI 会读到并处理)';
              } catch {
                return '❌ 注入失败(队列写入异常)';
              }
            }
            return '⏳ 回合正忙且无法排队注入, 请稍后再试';
          }
        }
        try {
          agent.session.append('user/message', msg, { surfaceOp: 'append' });
          return '✅ 已注入(回合空闲, 已追加到上下文; AI 下轮会读到)';
        } catch {
          return '❌ 注入失败(上下文追加异常)';
        }
      }
      // ② 无 session.append 能力 → 直接宿主 inject
      if (typeof agent.inject === 'function') {
        try {
          agent.inject(msg);
          return '✅ 已注入(安全边界排队中)';
        } catch {
          return '❌ 注入失败(队列写入异常)';
        }
      }
      return '❌ 当前会话不支持注入';
    },
  };
}
