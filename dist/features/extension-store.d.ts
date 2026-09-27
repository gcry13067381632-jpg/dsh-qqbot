import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { Logger } from '../types.js';
/** 扩展命令目录名(相对 cwd) */
export declare const EXT_COMMANDS_SUBDIR: string;
/** 扩展工具目录名(相对 cwd) */
export declare const EXT_TOOLS_SUBDIR: string;
/**
 * 扫描并加载扩展命令目录下的全部命令。
 * fail-soft: 单个文件坏/抛错只记日志, 不影响其它扩展与插件本体。
 */
export declare function loadExtensionCommands(cwd: string | undefined, logger: Logger): Promise<SlashCommand[]>;
/** 扩展目录路径(cwd 不存在时 undefined; dock/工具展示用) */
export declare function extensionCommandsDir(cwd: string | undefined): string;
/** 扩展工具目录路径(dock/工具展示用) */
export declare function extensionToolsDir(cwd: string | undefined): string;
/** 归一化后的扩展工具定义 */
export interface ExtensionToolDef {
    file: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    /** 执行体: 参数 schema 由调用方校验, run 直接收已校验 args + env */
    run: (args: Record<string, unknown>, env: Record<string, unknown>) => Promise<unknown> | unknown;
}
/** 扫描并加载扩展工具目录(P4.2; 由 channel-tools 在注册时调用) */
export declare function loadExtensionTools(cwd: string | undefined, logger: Logger): Promise<ExtensionToolDef[]>;
//# sourceMappingURL=extension-store.d.ts.map