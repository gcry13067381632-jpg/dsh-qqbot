import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { getScopePeer } from '../shared/index.js';
import { skipSilentAppend } from '../session/surface-guard.js';
/** 等回合空闲的最长等待(ms): 空闲立即返回; 超时降级 inject 排队 */
const INJECT_IDLE_WAIT_MS = 8_000;
export function injectCommand({ manager }) {
    return {
        name: 'inject',
        description: '插入消息到本会话 LLM 回合(用法: /inject 文本; AI 会在安全边界读到并处理)',
        handler: async (cmdCtx) => {
            const text = String((cmdCtx.command?.raw ?? '').trim());
            if (!text) {
                return '用法: `/inject 文本` —— 把这条消息安全插入当前会话, AI 会在回合安全边界读到并处理(不打断当前回合)。示例: `/inject 待会记得提醒我下午开会`';
            }
            const { scope, peerId } = getScopePeer(cmdCtx);
            const record = manager.findByPeer(scope, peerId);
            const agent = record?.agent;
            if (!agent)
                return '⚠️ 找不到当前会话的 AI 实例, 注入失败(稍后重试或发在机器人所在会话)';
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
                    }
                    catch { /* whenIdle 异常按未空闲处理 */ }
                    if (!idle) {
                        // 回合未在窗口内空闲 → 降级宿主 inject 排队(回合安全, 不唤醒, 不拆 tool_calls)
                        if (typeof agent.inject === 'function') {
                            try {
                                agent.inject(msg);
                                return '✅ 已注入(回合进行中, 排队到下个安全边界; AI 会读到并处理)';
                            }
                            catch {
                                return '❌ 注入失败(队列写入异常)';
                            }
                        }
                        return '⏳ 回合正忙且无法排队注入, 请稍后再试';
                    }
                }
                // ★ 2026-10-06: 人设未落盘的会话不能静默 append（会把会话日志写废）——
                //   如实告诉主人，别假装注入成功（见 session/surface-guard.ts）。
                if (agent.session && skipSilentAppend(agent, undefined, 'inject')) {
                    return '⚠️ 这条会话还没跑过回合(人设尚未落盘), 现在追加会写坏日志 —— 已跳过。等它被唤醒一次后再注入即可。';
                }
                try {
                    agent.session.append('user/message', msg, { surfaceOp: 'append' });
                    return '✅ 已注入(回合空闲, 已追加到上下文; AI 下轮会读到)';
                }
                catch {
                    return '❌ 注入失败(上下文追加异常)';
                }
            }
            // ② 无 session.append 能力 → 直接宿主 inject
            if (typeof agent.inject === 'function') {
                try {
                    agent.inject(msg);
                    return '✅ 已注入(安全边界排队中)';
                }
                catch {
                    return '❌ 注入失败(队列写入异常)';
                }
            }
            return '❌ 当前会话不支持注入';
        },
    };
}
//# sourceMappingURL=inject.js.map