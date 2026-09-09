/**
 * 杂项命令：/ping /version /stop
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';

/** /bot-ping — 测试当前 dsh 与 QQ 连接的网络延迟(对齐上游 0.5.0) */
export function pingCommand(): SlashCommand {
  return {
    name: 'bot-ping',
    description: '测试当前 dsh 与 QQ 连接的网络延迟',
    usage: [
      '/bot-ping',
      '',
      '测试 dsh 主机与 QQ 服务器之间的网络延迟。',
      '返回网络传输耗时和插件处理耗时。',
    ].join('\n'),
    handler: (ctx) => {
      const now = Date.now();
      const ts = ctx.message.timestamp;
      const eventTime = ts ? new Date(ts).getTime() : NaN;
      if (Number.isNaN(eventTime)) {
        return '✅ pong!';
      }
      const totalMs = now - eventTime;
      const qqToPlugin = ctx.receivedAt - eventTime;
      const pluginProcess = now - ctx.receivedAt;
      return [
        '✅ pong！',
        `⏱ 延迟: ${totalMs}ms`,
        `  ├ 网络传输: ${qqToPlugin}ms`,
        `  └ 插件处理: ${pluginProcess}ms`,
      ].join('\n');
    },
  };
}

/** /bot-version — 查看版本信息 */
export function versionCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'bot-version',
    description: '查看版本信息',
    handler: () => {
      const current = manager.getEffectiveModel('c2c', '');
      const modelInfo = current ? `${current.provider}/${current.model}` : '宿主默认';
      return `dsh-qqbot v0.1.0 | model: ${modelInfo}`;
    },
  };
}

/** /bot-stop — 中止当前生成（隐藏） */
export function stopCommand(): SlashCommand {
  return {
    name: 'bot-stop',
    description: '中止当前生成',
    hidden: true,
    handler: () => ({ kind: 'noop' as const }),
  };
}

/** /tools-reload — 热刷新 QQ 通道工具(开发用, 2026-09-05): 新增工具即时生效, 无需重启宿主 */
export function toolsReloadCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'tools-reload',
    description: '热刷新 QQ 通道工具(开发用: 新工具无需重启即可用; 已有工具改动仍需重启)',
    hidden: true,
    handler: async () => manager.reloadAllChannelTools(),
  };
}
