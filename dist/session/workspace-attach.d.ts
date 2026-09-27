import type { Context } from '@deepseek-ai/cordis';
import type { Logger } from '../types.js';
/**
 * 把一个会话从「归档」里拉回可见(幂等; 不在归档集合里就是 no-op)。
 * 走宿主同一条持久化链 → 侧边栏热刷新, 不需要重启宿主。
 * @returns true = 本次真的摘掉了(之前处于归档)
 */
export declare function unarchiveSession(ctx: Context, sessionId: string, logger: Logger): Promise<boolean>;
/** 供诊断: 反归档统计(有多少次真的把会话从归档里拉回可见) */
export declare function workspaceAttachState(): {
    unarchived: number;
    lastUnarchivedId: string;
    lastUnarchivedAt: number;
    lastError: string;
};
/**
 * 会话可用性总入口: 挂到工作区 + 保证不在归档里(两者都幂等 + fail-soft)。
 * SessionManager.getOrCreate **创建/恢复**会话后调用, fire-and-forget 不阻塞主链。
 */
export declare function attachSessionToWorkspace(ctx: Context, cwd: string | undefined, sessionId: string, logger: Logger): Promise<void>;
//# sourceMappingURL=workspace-attach.d.ts.map