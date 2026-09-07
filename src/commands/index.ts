/**
 * 斜杠命令注册中心
 *
 * 每个命令拆分为独立文件，此处仅编排。参考 openclaw-qqbot 的
 * commands/index.ts 模式：工厂函数注入依赖，统一导出命令列表。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
import { resetCommand, newCommand } from './session.js';
import { modelCommand, modelAliasCommand } from './model.js';
import { statusCommand } from './status.js';
import { helpCommand } from './help.js';
import { pingCommand, versionCommand, stopCommand, toolsReloadCommand } from './misc.js';
import { outModeCommand } from './outmode.js';

/**
 * 构建标准命令列表
 */
export function buildCommandList(deps: CommandDeps): SlashCommand[] {
  const commands: SlashCommand[] = [
    // 会话
    resetCommand(deps),
    newCommand(deps),
    // 模型
    modelCommand(deps),
    modelAliasCommand(deps), // /model 简写
    // 状态
    statusCommand(deps),
    // 出站模式(逃生通道: SDK 直通不经 LLM, nothink 也能唤醒)
    outModeCommand(deps),
    // 杂项
    pingCommand(),
    versionCommand(deps),
    stopCommand(),
    // 开发: 工具热刷新
    toolsReloadCommand(deps),
  ];

  // help 需要访问完整列表（含自身），通过闭包惰性引用
  commands.push(helpCommand(deps, () => commands));

  return commands;
}
