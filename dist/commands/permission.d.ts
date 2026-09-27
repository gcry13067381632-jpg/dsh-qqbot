/**
 * /permission — 切换宿主权限档位(2026-09-08)
 *
 * 档位(宿主 dsh-permission-presets 提供, 可配置):
 *   workspace-write      工作区内可写, 更宽操作需审批(ask)
 *   danger-full-access   全访问, 不再弹审批(never)
 *   read-only            只读(若宿主配置了该档)
 *
 * 用法:
 *   /permission          → 查看当前档 + 可用档
 *   /permission <档名>   → 切换到该档(即时生效, 作用于当前会话)
 *
 * ⚠️ 与 /approve 6位码(放行单笔审批)不同: 本命令切的是"会话级权限档位"。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
export declare function permissionCommand({ manager }: CommandDeps): SlashCommand;
//# sourceMappingURL=permission.d.ts.map