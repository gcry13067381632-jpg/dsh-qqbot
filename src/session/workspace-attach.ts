/**
 * workspace-attach.ts — 把 QQ 会话挂到其 cwd 对应的工作区分组 + 「会话被触发时」把它从归档里拉回可见
 *
 * ── 第一件事: 工作区归属(移植自上游 PR tencent-connect/dsh-qqbot#21) ──
 * 问题: Web 侧边栏按工作区成员列表展示会话, 宿主只在客户端 session.create
 * RPC 路径调用 workspace.attachSession(dsh-host-apiproxy), dsh-workspace 的
 * "认领遗漏会话"(bootstrap) 仅在首次初始化执行——插件创建的 QQ 会话两条路径
 * 都不经过 → 不在任何工作区成员列表, 刷新后只能落 Ungrouped(且闲置回收后
 * 从侧边栏消失的另一主因是宿主帧语义, 见 deepseek-harness#4045, 本文件不处理)。
 * 做法: 在 SessionManager.getOrCreate 创建/恢复会话后调用, 把会话挂到其 cwd
 * 对应的 workspace(registry.create(cwd) 幂等取回 → workspace.attachSession 幂等)。
 *
 * ── 第二件事: 触发式反归档(2026-09-11 主人定稿) ──
 * 侧边栏可见性是**两层**独立机制:
 *   ① 工作区归属(sessionIds) — attachSession 管;
 *   ② 全局归档集合(registry.archivedSessionIds) — 宿主 UI 的「归档会话」写它,
 *      侧边栏的分组/扁平/搜索三处推导全都 `!archived.has(id)` 过滤。
 * 两层互不影响: 归档的会话哪怕已经挂进工作区也**照样不显示**; 而宿主
 * (dsh-api-workspace-controller)只暴露了 `archiveSession`, **没有任何
 * unarchive / restore 接口**(registry 类里同样只有 archiveSession), 于是
 * "点了归档就再也拉不回来"。本文件自己补上这一环。
 *
 * 语义(主人 2026-09-11 明确纠正):
 *   **不是"归档动作秒级弹回", 而是"会话被触发时弹回"。**
 *   · 主人主动归档 → 保持归档状态。**不拦截归档动作、也不跑定时巡检**——
 *     那两样(半成品初版曾实现)会让「归档」功能形同虚设, 已按主人要求移除;
 *   · 该 QQ 会话下次被消息**触发**时, 顺带把它的 id 从归档集合里摘掉 →
 *     侧边栏恢复可见(走宿主同一条持久化链, 热刷新, 无需重启宿主)。
 *   落点两处(SessionManager 侧):
 *     ① getOrCreate 命中**已有活跃记录** → unarchiveSession();
 *     ② 新建/恢复会话 → attachSessionToWorkspace()(内部顺带 unarchive)。
 *
 * ⚠️ 风险与边界(宿主升级时重点回归):
 *   - setState / enqueueOperation / state / global 是 workspaceRegistry 的**内部成员**,
 *     宿主没有对外公开 unarchive 能力, 便桥只能这么搭。这里全部 duck-typing +
 *     fail-soft: 缺哪个就用能用的那条(全取不到就只记日志, 绝不抛)。
 *   - 只对**被 QQ 消息触发**的会话生效, 主人手动归档的其它会话不受影响。
 *   - 全 fail-soft: workspaceRegistry 未挂载(如 headless)或任何一步失败 →
 *     静默降级(仅日志), 绝不影响消息处理主链。
 *
 * ⚠️ 本地手改功能(fork 新增): 维护清单见工作区根《dsh-qqbot-开发维护手册.md》。
 */
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { Logger } from '../types.js';

/** workspaceRegistry service 的最小形状(宿主 dsh-workspace 提供) */
interface WorkspaceRegistryLike {
  create?: (path: string, title?: string) => Promise<{ attachSession?: (sessionId: string) => Promise<unknown> } | undefined>;
  /** getter: 全局归档会话 id(按归档顺序) */
  archivedSessionIds?: readonly string[];
  /** 内部状态(durable global state; 与 archivedSessionIds getter 同源) */
  state?: { initialized?: boolean; workspaceIds?: readonly string[]; archivedSessionIds?: readonly string[] };
  /** 内部写入: 落盘 + 更新内存 state(宿主 setState) */
  setState?: (state: unknown) => Promise<void>;
  /** 内部串行队列: 与宿主其它 registry 写操作排队, 防交错 */
  enqueueOperation?: <T>(operation: () => Promise<T>) => Promise<T>;
}

const REGISTRY_SERVICE = 'workspaceRegistry';

/** 反归档诊断(离线可查: 写 ~/.dsh/qqbot-archive.log) */
const DIAG_FILE = join(homedir(), '.dsh', 'qqbot-archive.log');
function diag(line: string): void {
  try {
    appendFileSync(DIAG_FILE, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch { /* 诊断写失败忽略 */ }
}

/** 反归档统计(供 /api/qqbot-settings/_debug 与排障查看) */
const stats = { unarchived: 0, lastUnarchivedId: '', lastUnarchivedAt: 0, lastError: '' };

/** 取 workspaceRegistry(未挂载时 undefined; 全程 fail-soft) */
function getRegistry(ctx: Context): WorkspaceRegistryLike | undefined {
  try {
    return (ctx as { get?: (name: string) => unknown }).get?.(REGISTRY_SERVICE) as WorkspaceRegistryLike | undefined;
  } catch {
    return undefined;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 反归档
// ───────────────────────────────────────────────────────────────────────────

/** 读当前归档集合(getter 优先, 回落 state 字段) */
function readArchived(registry: WorkspaceRegistryLike): string[] {
  const direct = registry.archivedSessionIds;
  if (Array.isArray(direct)) return direct.map(String);
  const raw = registry.state?.archivedSessionIds;
  return Array.isArray(raw) ? raw.map(String) : [];
}

/** 真正把 id 从归档集合里摘掉(串行 + 持久化) */
async function removeFromArchived(registry: WorkspaceRegistryLike, sessionId: string): Promise<boolean> {
  const write = async (): Promise<boolean> => {
    const archived = readArchived(registry);
    if (!archived.includes(sessionId)) return false;
    const state = registry.state;
    if (state === undefined) return false;
    const next = { ...state, archivedSessionIds: archived.filter(id => id !== sessionId) };
    if (typeof registry.setState === 'function') {
      // 正常路径: 宿主 setState = 落盘 + 更新内存(会触发 controller 推 follow 'archived' 帧)
      await registry.setState(next);
      return true;
    }
    // 兜底: 直接写 domain global, 并同步内存 state(否则下一次 requireState 会把旧集合写回去)
    const global = (registry as unknown as { global?: { set?: (value: unknown) => Promise<void> } }).global;
    if (typeof global?.set !== 'function') return false;
    await global.set(next);
    (registry as { state?: unknown }).state = next;
    return true;
  };
  return typeof registry.enqueueOperation === 'function'
    ? await registry.enqueueOperation(write)
    : await write();
}

/**
 * 把一个会话从「归档」里拉回可见(幂等; 不在归档集合里就是 no-op)。
 * 走宿主同一条持久化链 → 侧边栏热刷新, 不需要重启宿主。
 * @returns true = 本次真的摘掉了(之前处于归档)
 */
export async function unarchiveSession(ctx: Context, sessionId: string, logger: Logger): Promise<boolean> {
  try {
    const registry = getRegistry(ctx);
    if (!registry) {
      stats.lastError = 'no-workspaceRegistry';
      return false;
    }
    const id = String(sessionId);
    const removed = await removeFromArchived(registry, id);
    if (removed) {
      stats.unarchived += 1;
      stats.lastUnarchivedId = id;
      stats.lastUnarchivedAt = Date.now();
      stats.lastError = '';
      logger.info(`[workspace-attach] session ${id} 已从「归档」拉回可见(触发式反归档)`);
      diag(`unarchived ${id}`);
    }
    return removed;
  } catch (err) {
    // fail-soft: 反归档失败绝不影响会话使用
    const msg = err instanceof Error ? err.message : String(err);
    stats.lastError = msg;
    logger.warn?.(`[workspace-attach] unarchive skipped: ${msg}`);
    diag(`unarchive-failed ${sessionId}: ${msg}`);
    return false;
  }
}

/** 供诊断: 反归档统计(有多少次真的把会话从归档里拉回可见) */
export function workspaceAttachState(): {
  unarchived: number;
  lastUnarchivedId: string;
  lastUnarchivedAt: number;
  lastError: string;
} {
  return { ...stats };
}

// ───────────────────────────────────────────────────────────────────────────
// 对外主入口
// ───────────────────────────────────────────────────────────────────────────

/**
 * 会话可用性总入口: 挂到工作区 + 保证不在归档里(两者都幂等 + fail-soft)。
 * SessionManager.getOrCreate **创建/恢复**会话后调用, fire-and-forget 不阻塞主链。
 */
export async function attachSessionToWorkspace(
  ctx: Context,
  cwd: string | undefined,
  sessionId: string,
  logger: Logger,
): Promise<void> {
  const registry = getRegistry(ctx);
  if (!registry) return; // workspaceRegistry 未挂载(如 headless profile) → 静默跳过
  if (cwd) {
    try {
      if (typeof registry.create === 'function') {
        const workspace = await registry.create(cwd);
        if (workspace?.attachSession) {
          await workspace.attachSession(sessionId);
          logger.info(`[workspace-attach] session ${sessionId} → workspace ${cwd}`);
        }
      }
    } catch (err) {
      // fail-soft: 挂载失败绝不影响会话使用; 留 warn 便于主人查(无 workspaceRegistry 时宿主会抛)
      logger.warn?.(`[workspace-attach] skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // 顺带把误归档的会话拉回可见(归档与工作区归属无关, 故不依赖 cwd)
  await unarchiveSession(ctx, sessionId, logger);
}
