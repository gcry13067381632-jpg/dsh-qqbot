/**
 * 杂项命令：/ping /version /stop
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
/** /bot-ping — 测试当前 dsh 与 QQ 连接的网络延迟(对齐上游 0.5.0) */
export declare function pingCommand(): SlashCommand;
/** /bot-version — 查看版本信息 */
export declare function versionCommand({ manager }: CommandDeps): SlashCommand;
/** /bot-stop — 中止当前生成（隐藏） */
export declare function stopCommand(): SlashCommand;
/** /tools-reload — 热刷新 QQ 通道工具(开发用, 2026-09-05): 新增工具即时生效, 无需重启宿主 */
export declare function toolsReloadCommand({ manager }: CommandDeps): SlashCommand;
//# sourceMappingURL=misc.d.ts.map