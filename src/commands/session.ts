/**
 * 会话相关命令：/bot-reset /bot-clear /bot-new
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
import { getScopePeer } from '../shared/index.js';

/** /bot-reset /bot-clear — 重置当前会话 */
export function resetCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: ['bot-reset', 'bot-clear'],
    description: '重置当前会话（清除上下文）',
    handler: (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      void manager.remove(scope, peerId);
      return '会话已重置 ✓';
    },
  };
}

/** /bot-new — 开启新会话(真 fork: 旧会话存档可回看, 本会话开新档; 2026-09-08 修假实现) */
export function newCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'bot-new',
    description: '开启新会话(保留旧会话存档, 可回看)',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const ok = await manager.startNewSession(scope, peerId, false);
      return ok ? '已开启新会话 ✓(旧会话已存档)' : '当前没有活跃会话, 无需开新';
    },
  };
}

/** /new <preset> — 按会话切换 agent preset(2026-09-08, 学 DLive 社区版; fork 开新档用指定人格) */
export function newPresetCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'new',
    description: '以指定人格开新会话: /new <preset>(如 /new code); 不带参=/bot-new; /presets 查看可选人格',
    usage: '/new [preset]',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const args = String((cmdCtx.command?.raw ?? '').trim());
      if (!args) {
        const ok = await manager.startNewSession(scope, peerId, false);
        return ok ? '已开启新会话 ✓(使用当前默认人格)' : '当前没有活跃会话, 无需开新';
      }
      // 精确匹配 preset id(先验存在, 避免未知 id 建错会话)
      const list = await manager.listPresets();
      const hit = list.find((p) => p.id === args && !p.broken);
      if (!hit) {
        const lines = [`找不到人格「${args}」— 可用:`];
        for (const p of list) {
          lines.push(`- ${p.id}${p.name ? `(${p.name})` : ''}${p.broken ? ' [损坏]' : ''}`);
        }
        return lines.join('\n');
      }
      const ok = await manager.startNewSession(scope, peerId, false, hit.id);
      return ok ? `✅ 已用人格「${hit.id}」开启新会话(旧会话存档可回看)` : '当前没有活跃会话, 请先聊一句再切';
    },
  };
}

/** /preset <id> — 热切换当前会话的人格(preset), 不丢对话历史(2026-09-10) */
export function presetSwitchCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'preset',
    description: '热切换当前会话人格: /preset <id>(不丢对话历史, 即时生效); /presets 查看可选',
    usage: '/preset <id>',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const args = String((cmdCtx.command?.raw ?? '').trim());
      if (!args) {
        return '用法: /preset <id> — 热切换人格(不丢历史)\n/presets 查看可用人格';
      }
      const list = await manager.listPresets();
      const hit = list.find((p) => p.id === args && !p.broken);
      if (!hit) {
        const lines = [`找不到人格「${args}」— 可用:`];
        for (const p of list) {
          lines.push(`- ${p.id}${p.name ? `(${p.name})` : ''}${p.broken ? ' [损坏]' : ''}`);
        }
        return lines.join('\n');
      }
      const r = await manager.switchPreset(scope, peerId, hit.id);
      if (r === 'ok') return `✅ 已热切换人格为「${hit.id}」${hit.name ? `(${hit.name})` : ''}，对话历史保留，即时生效！`;
      if (r === 'no-session') return '当前没有活跃会话, 请先聊一句再切换';
      if (r === 'no-preset') return `人格「${hit.id}」不可用`;
      return '⚠️ 热切换失败, 已回退(fork 未生效)';
    },
  };
}

/** /presets — 列出全部可用 agent preset(2026-09-08, 配合 /new 切人格) */
export function presetsCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'presets',
    description: '列出可用人格(preset), 配合 /preset <id> 热切换 / /new <id> 开新档',
    handler: async () => {
      const list = await manager.listPresets();
      if (list.length === 0) return '宿主暂未提供 agent preset(或未挂载 agentPresets 服务)';
      const lines = ['### 🧬 可用人格(preset)', '', '发 `/preset <id>` 热切换(不丢历史); `/new <id>` 以该人格开新会话:'];
      for (const p of list) {
        lines.push(`- **${p.id}**${p.name ? ` ${p.name}` : ''}${p.broken ? ' ⚠️损坏' : ''}`);
      }
      lines.push('', '提示: /preset=当前会话即时换人格(上下文保留); /new 不带参=用默认人格开新档');
      return lines.join('\n');
    },
  };
}
