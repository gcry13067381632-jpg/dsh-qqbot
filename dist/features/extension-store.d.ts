import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { Logger } from '../types.js';
/** 扩展命令目录名(相对 cwd) */
export declare const EXT_COMMANDS_SUBDIR: string;
/** 扩展工具目录名(相对 cwd) */
export declare const EXT_TOOLS_SUBDIR: string;
/** botplay 自定义事件目录名(相对数据根; 2026-10-05 第三套扩展) */
export declare const EXT_BOTPLAY_SUBDIR: string;
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
/** botplay 自定义事件模块目录(相对数据根) */
export declare function botplayExtensionsDir(dataRoot: string): string;
/**
 * 文件名安全校验(防 `../` 逃逸出扩展目录):
 * 只允许"纯文件名", 不允许任何路径分隔符(Windows 反斜杠也算)。
 * 说明: 允许子目录会带来逃逸面, 而主人的使用场景(一个事件一个模块)根本不需要子目录。
 */
export declare function safeBotplayFileName(file: string): string | null;
/**
 * 归一化后的 botplay 模块(结构形状与 botplay-ext.ts 的 BotplayExtModule 一致)。
 * ⚠️ 这里**故意不 import BotplayExtModule**: 两个模块互相 import 会让"谁先定义"变得微妙,
 *   而这里只需要"是不是函数"这个结构信息 —— 用 unknown 形参最宽, 交给调用方(botplay.ts)
 *   转成 BotplayExtModule(那边才有真正的 ctx 类型), 避免 any/never 打架。
 */
export interface BotplayModuleShape {
    name?: string;
    onInit?: (...args: never[]) => unknown;
    onClick?: (ctx: never, info: never) => unknown;
    onTick?: (ctx: never) => unknown;
    onExpire?: (ctx: never) => unknown;
    onDispose?: (ctx: never) => unknown;
}
/** 加载结果(带来源信息, 供面板/诊断展示) */
export interface LoadedBotplayModule {
    file: string;
    /** 绝对路径 */
    path: string;
    /** mtime(ms): 热重载判据 + 面板"最后修改时间" */
    mtime: number;
    name: string;
    mod: BotplayModuleShape;
}
/**
 * 加载(或热重载)一个 botplay 自定义事件模块。
 *
 * 热重载靠 `?v=<mtime>` 做 cache-bust —— 与 extension-store 的 fileVersion 同款
 * (⚠️ 别改回时间戳: 每次新 URL 会让 Node ESM ModuleMap 永久强引用旧模块, 长跑吃内存直至 OOM,
 *  2026-09-15 那次扩展工具内存泄漏就是这个坑)。
 */
export declare function loadBotplayExtensionModule(dataRoot: string, file: string, logger: Logger): Promise<{
    ok: true;
    loaded: LoadedBotplayModule;
} | {
    ok: false;
    error: string;
    path: string;
}>;
//# sourceMappingURL=extension-store.d.ts.map