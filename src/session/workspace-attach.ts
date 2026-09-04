/**
 * workspace-attach.ts — 把 QQ 会话挂到其 cwd 对应的工作区分组(修复侧边栏归属)
 *
 * 移植自上游 PR tencent-connect/dsh-qqbot#21(workspace-attach)。
 * 问题: Web 侧边栏按工作区成员列表展示会话, 宿主只在客户端 session.create
 * RPC 路径调用 workspace.attachSession(dsh-host-apiproxy), dsh-workspace 的
 * "认领遗漏会话"(bootstrap) 仅在首次初始化执行——插件创建的 QQ 会话两条路径
 * 都不经过 → 不在任何工作区成员列表, 刷新后只能落 Ungrouped(且闲置回收后
 * 从侧边栏消失的另一主因是宿主帧语义, 见 deepseek-harness#4045, 本文件不处理)。
 *
 * 做法: 在 SessionManager.getOrCreate 创建/恢复会话后调用, 把会话挂到其 cwd
 * 对应的 workspace(registry.create(cwd) 幂等取回 → workspace.attachSession 幂等)。
 * - 幂等: 创建与恢复路径都安全调用; 老会话在下一次消息恢复时自动补挂。
 * - 全 fail-soft: workspaceRegistry 未挂载(如 headless)或任何一步失败 →
 *   静默降级(仅日志), 绝不影响消息处理主链。
 *
 * ⚠️ 本地手改功能(fork 新增, 移植上游): 维护清单见工作区根《插件改动维护注意事项.md》。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Logger } from '../types.js';

/** workspaceRegistry service 的最小形状(宿主 dsh-workspace 提供) */
interface WorkspaceRegistryLike {
  create?: (path: string, title?: string) => Promise<{ attachSession?: (sessionId: string) => Promise<unknown> } | undefined>;
}

export async function attachSessionToWorkspace(
  ctx: Context,
  cwd: string | undefined,
  sessionId: string,
  logger: Logger,
): Promise<void> {
  if (!cwd) return;
  try {
    const registry = (ctx as { get?: (name: string) => unknown }).get?.('workspaceRegistry') as WorkspaceRegistryLike | undefined;
    if (!registry?.create) {
      // workspaceRegistry 未挂载(如 headless profile) → 静默跳过
      return;
    }
    const workspace = await registry.create(cwd);
    if (workspace?.attachSession) {
      await workspace.attachSession(sessionId);
      logger.info(`[workspace-attach] session ${sessionId} → workspace ${cwd}`);
    }
  } catch (err) {
    // fail-soft: 挂载失败绝不影响会话使用; 留 warn 便于主人查(无 workspaceRegistry 时宿主会抛)
    logger.warn?.(`[workspace-attach] skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
