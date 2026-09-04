/**
 * 命令依赖类型
 *
 * 每个命令工厂函数接收 CommandDeps，由 commands/index.ts 统一注入。
 */
import type { SessionManager } from '../session/index.js';
import type { ImQQBotConfig } from '../config.js';

export interface CommandDeps {
  manager: SessionManager;
  config: ImQQBotConfig;
}
