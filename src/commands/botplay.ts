/**
 * botplay 命令: /botplay — 列出/触发互动事件(2026-09-08, Phase1 MVP)
 *
 * 用法:
 *   /botplay            → 列出全部已装配事件(可点击/抄名字)
 *   /botplay <事件名>   → 精确匹配(id 或 name)触发: bot 发出配置好的键盘卡片
 *
 * 事件装配在 dock「🎮 互动事件」页 / Web 设置保存(live 热更, 无需重启)。
 * 触发走 triggerBotplay 模块级注册表(bootstrap 注册实现, 带 sender/manager)。
 * 权限: 默认所有群友可点; 事件 perm=triggerer 时仅触发者本人可点(推荐, 零配置)。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
import { triggerBotplay, resolveCommandTarget } from '../features/botplay.js';

export function botplayCommand({ config }: CommandDeps): SlashCommand {
  return {
    name: 'botplay',
    description: '互动事件: /botplay 列出; /botplay 事件名 触发发卡',
    usage: '/botplay [事件名]',
    handler: async (cmdCtx) => {
      const args = String((cmdCtx.command?.raw ?? '').trim());
      const events = Array.isArray(config.botplayEvents) ? config.botplayEvents : [];
      // 无参 → 列表
      if (!args) {
        if (events.length === 0) {
          return '🎮 还没有装配任何互动事件——到 dock「🎮 互动事件」或 Web 设置里装配后保存即可。';
        }
        const lines = ['### 🎮 互动事件', '', '发 `/botplay 事件名` 触发发卡:'];
        for (const ev of events) {
          const btnN = Array.isArray(ev.buttons) ? ev.buttons.length : 0;
          const expire = Number(ev.expireSec ?? 600) || 600;
          const maxC = Number(ev.maxClicks ?? 0) || 0;
          lines.push(
            `- **${ev.name}** \`${ev.id}\`(${btnN} 个按钮, ${expire}s${maxC > 0 ? `, 最多${maxC}次` : ''})`,
          );
        }
        return lines.join('\n');
      }
      // 精确匹配: 先 id 后 name(整串, 不模糊)
      const hit = events.find((e) => e.id === args || e.name === args);
      if (!hit) {
        return `找不到事件「${args}」——发 /botplay 看列表(只支持精确名字或id)。`;
      }
      const { target, triggererId } = resolveCommandTarget(cmdCtx as never);
      if (!target.targetId || !triggererId) {
        return '无法定位当前会话, 请稍后再试~';
      }
      const r = await triggerBotplay(target, hit.id, triggererId);
      return r.msg;
    },
  };
}
