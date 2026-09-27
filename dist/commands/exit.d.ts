import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
/** 触发自重启: 生成独立重启助手并脱手运行(当前宿主被杀也能继续拉起新宿主) */
export declare function selfRestart(delayMs?: number, killWaitMs?: number): boolean;
export declare function botRestartCommand(): SlashCommand;
/** /bot-exit 旧命令兼容: 同样走自重启(杀+拉一条龙) */
export declare function botExitCommand(): SlashCommand;
//# sourceMappingURL=exit.d.ts.map