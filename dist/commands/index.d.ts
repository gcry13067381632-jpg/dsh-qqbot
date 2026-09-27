/**
 * 斜杠命令注册中心
 *
 * 每个命令拆分为独立文件，此处仅编排。参考 openclaw-qqbot 的
 * commands/index.ts 模式：工厂函数注入依赖，统一导出命令列表。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
/**
 * 构建标准命令列表
 */
export declare function buildCommandList(deps: CommandDeps): SlashCommand[];
//# sourceMappingURL=index.d.ts.map