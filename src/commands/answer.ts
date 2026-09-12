/**
 * 提问文字兜底命令: `/答 <内容>` 与 `/ans`（2026-09-11 主人定, 与 `/approve CODE` 同姿势）
 *
 * 背景: 提问卡片在 QQ 上是**按钮卡片**, 但按钮不一定可用(未开通/被客户端拒/超 5 行上限),
 * 用户也可能想直接打字回答。最初把兜底挂在 `bot.on('message')` 里(裸文字即可作答),
 * 实测**失效**:
 *   · 群聊裸文字先被 mentionGate(@门控) 拦下 —— 没 @bot 的消息根本走不到 message 处理器;
 *   · 私聊/群消息又被 debounce 延迟聚合层接管 —— 那一层是**自己直接调 transport.handleInbound
 *     喂 agent**(见 gateway/debounce.ts), 绕过 message 处理器。
 * 症状: 回了 "a" 直接被当普通消息聚合进 AI, 提问卡片还在原地等, 最后只能手动点按钮。
 *
 * 正解 = 学 `/approve CODE`:**走斜杠命令**。
 *   · debounce 层对以 `/` 开头的消息**直放行**(`if (content.startsWith('/')) return next()`);
 *   · 命令层在链中被前置解析并立即执行, 执行完 `ctx.stop()` → 不惊动 LLM、不进上下文。
 * 这是唯一稳定能到达通道层的用户输入形态(裸文字做不到)。
 *
 * 用法:
 *   /答 A                选第 1 个选项(字母 A-Z 与序号 1-N 都认)
 *   /答 A,C  或 /答 1 3  多选(该问题 multiSelect 时)
 *   /答 #2 B             多个提问并存时指定第 2 问
 *   /答 我觉得再等等      不是选项的文字 → 作为自由回答(custom)原样转给 AI
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
import { getScopePeer } from '../shared/index.js';
import { answerPendingQuestionByText } from '../features/qq-user-questions.js';

const USAGE = [
  '用法: `/答 <选项字母|序号|你的回答>`',
  '例: `/答 A`(选第一个)、`/答 1 3`(多选)、`/答 #2 B`(第2问)、`/答 我觉得再等等`(自由回答)',
].join('\n');

/** /答（中文主命令）：把斜杠后面的文字当成对当前待答提问的回答 */
export function answerCommand({ config }: CommandDeps): SlashCommand {
  return {
    name: '答',
    description: '回答机器人的提问卡片(文字兜底: /答 A | /答 #2 B | /答 你的回答)',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const raw = String(cmdCtx.command?.raw ?? '').trim();
      if (raw === '') return USAGE;
      const senderId = String(
        (cmdCtx as unknown as { message?: { senderId?: string } }).message?.senderId ?? '',
      );
      const ns = String(config.settingsNs ?? '').trim() || 'im-qqbot';
      const r = answerPendingQuestionByText({ ns, scope, peerId, senderId, text: raw });
      return r.ok ? `✅ ${r.msg}` : `⚠️ ${r.msg}\n\n${USAGE}`;
    },
  };
}

/** /ans（英文简写别名, 复用同一 handler） */
export function answerAliasCommand(deps: CommandDeps): SlashCommand {
  const base = answerCommand(deps);
  return { name: 'ans', description: '回答机器人的提问卡片(简写, 同 /答)', handler: base.handler };
}
