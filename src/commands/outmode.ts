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
 * 模式切换后写一条「模拟用户消息」进当前会话(append 不唤醒, 2026-09-07 主人定):
 * 斜杠命令不经 LLM → AI 本来看不见模式被切; 以 user/message 形态落一条
 * "[主人切换了出站模式] …" 进会话上下文, 等下一次真人消息开回合时 AI 自然读到。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { CommandDeps } from './types.js';
import { normalizeOutboundMode, switchOutboundMode } from '../features/outbound-mode-switch.js';
import type { ImQQBotConfig } from '../config.js';
import { getScopePeer } from '../shared/index.js';

const LABEL: Record<string, string> = {
  adaptive: '适配主动(默认): 收到真人消息前5条带引用回你, 之后自动转独立消息',
  passive: '被动: 始终回复你那条(连发约4~5条后被QQ吞)',
  silent: '完全不出站: 照常思考但不向QQ发任何回复(web可对话)',
  nothink: '完全不思考: QQ入站不唤醒AI, 仅记录上下文(web对话仍可看到群聊)',
};

function currentOf(config: ImQQBotConfig): string {
  return normalizeOutboundMode(config.outboundMode);
}

/** 往当前会话 append 一条模拟用户消息(不唤醒): 让 AI 下回合能读到"主人切了模式" */
async function noteModeChange(manager: CommandDeps['manager'], cmdCtx: unknown, mode: string): Promise<void> {
  try {
    const { scope, peerId } = getScopePeer(cmdCtx as never);
    const record = manager.findByPeer(scope, peerId);
    if (!record) return;
    const sess = (record.agent as unknown as {
      session?: { append?: (type: string, data: unknown, opts?: { surfaceOp?: string }) => unknown };
    } | undefined)?.session;
    if (!sess || typeof sess.append !== 'function') return;
    const text = `[主人切换了出站模式] 现在: ${mode} — ${LABEL[mode] ?? ''}`;
    const msg = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    });
    sess.append('user/message', msg, { surfaceOp: 'append' }); // 不唤醒, 只落上下文
  } catch {
    /* 记录失败不影响切换本身 */
  }
}

export function outModeCommand({ manager, config }: CommandDeps): SlashCommand {
  return {
    name: 'outmode',
    description: '查看/切换出站模式(用法: /outmode [adaptive|passive|silent|nothink])',
    handler: async (cmdCtx) => {
      const args = String((cmdCtx.command?.raw ?? '').trim());
      const cur = currentOf(config);
      if (!args) {
        const lines = ['### ⇄ 出站模式', '', `**当前: ${cur}**`, '', '可用模式(直接发 `/outmode 模式名` 切换, 立即生效):'];
        for (const key of ['adaptive', 'passive', 'silent', 'nothink']) {
          lines.push(`- **${key}** — ${LABEL[key]}`);
        }
        return lines.join('\n');
      }
      const want = normalizeOutboundMode(args.toLowerCase());
      const r = await switchOutboundMode(want);
      if (r.ok) {
        // 切换成功 → 模拟用户消息告知 AI(不唤醒, 下回合可见)
        await noteModeChange(manager, cmdCtx, r.mode);
      }
      return r.ok ? `✅ 出站模式已切换: **${r.mode}**\n${LABEL[r.mode] ?? ''}` : `切换失败: ${r.msg}`;
    },
  };
}
