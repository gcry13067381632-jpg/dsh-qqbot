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
import { getScopePeer } from '../shared/index.js';

/** 中文/简写 → 宿主档名映射(主人 2026-09-08: 懒得打长英文) */
const ALIAS: Record<string, string> = {
  '只读': 'read-only', 'readonly': 'read-only', 'ro': 'read-only',
  '工作区': 'workspace-write', '工作区写': 'workspace-write', 'workspace': 'workspace-write', 'ww': 'workspace-write', '写': 'workspace-write',
  '全权': 'danger-full-access', '全访问': 'danger-full-access', '放开': 'danger-full-access', 'danger': 'danger-full-access', 'never': 'danger-full-access', 'fa': 'danger-full-access',
};
/** 反查: 宿主档名 → 好记中文(列表展示用) */
const LABEL: Record<string, string> = {
  'read-only': '只读',
  'workspace-write': '工作区写',
  'danger-full-access': '全权(不审批)',
};

export function permissionCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: ['permission', 'perm', '权限'],
    description: '切换权限档: /perm [只读|工作区|全权] 查看/切换',
    usage: '/perm [只读|工作区|全权|档名]',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const rawArgs = String((cmdCtx.command?.raw ?? '').trim());
      const list = await manager.listPermissionPresets();
      const cur = manager.currentPermissionPreset(scope, peerId);
      if (!rawArgs) {
        if (list.length === 0) return '宿主未提供 permissionPresets 服务(需装配 dsh-permission-presets)';
        const curText = cur
          ? (LABEL[cur] ? `${cur}(${LABEL[cur]})` : cur)
          : '(会话尚无权限档记录 = 走宿主默认, 直接 /perm 切一个即可生效)';
        const lines = ['### 🔐 权限档', '', `**当前: ${curText}**`, '', '发 `/perm 只读|工作区|全权` 或 `/perm 档名` 切换:'];
        for (const p of list) {
          lines.push(`- **${p.value}**${LABEL[p.value] ? `(${LABEL[p.value]})` : (p.name && p.name !== p.value ? `(${p.name})` : '')}${p.description ? ` — ${p.description}` : ''}`);
        }
        return lines.join('\n');
      }
      // 中文/简写归一 → 真实档名(宿主没配 read-only 时会失败并列出可用)
      const mapped = ALIAS[rawArgs] ?? ALIAS[rawArgs.toLowerCase()] ?? rawArgs;
      const r = await manager.switchPermissionPreset(scope, peerId, mapped);
      return r.msg;
    },
  };
}
