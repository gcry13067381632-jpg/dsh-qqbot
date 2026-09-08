/**
 * extension-store.ts — 用户扩展注册表(Phase 4 P4.1, 2026-09-08)
 *
 * 目的: 让用户/AI 能写【自定义斜杠命令】存在【插件包之外】的扩展目录,
 * 插件 npm 升级只换"引擎"(node_modules), 扩展目录永不覆盖 —— 用户资产与代码分离。
 *
 * 扩展目录(每账号独立, 与表情包/定时同理念): {config.cwd}/.qqbot-extensions/commands/*.js
 * 扩展文件格式(ESM, 与 SDK SlashCommand 对齐):
 *   export default {
 *     name: 'hello',                    // 或 name: ['hello','hi'](别名)
 *     description: '打招呼',
 *     usage: '/hello [名字]',
 *     handler: (ctx) => '你好呀~',       // 返回 string 或 {kind:'noop'}
 *   };
 *
 * 加载策略: 启动时同步列目录 + 逐个动态 import(fail-soft: 坏文件跳过不拖垮插件);
 * 注册接点: middleware-setup 把 loadExtensionCommands() 结果并入 buildCommandList →
 * 群聊前置解析 cmdMap + SDK slash 都覆盖 → /命令 重启后即用(宿主有 /bot-restart 一键重启)。
 * 热刷(不重启)留给 P4.2 dock 管理 UI。
 */
import { readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { Logger } from '../types.js';

/** 扩展命令目录名(相对 cwd) */
export const EXT_COMMANDS_SUBDIR = join('.qqbot-extensions', 'commands');
/** 扩展工具目录名(相对 cwd) */
export const EXT_TOOLS_SUBDIR = join('.qqbot-extensions', 'tools');

/** 扩展文件允许的扩展名 */
const ALLOWED_EXT = new Set(['.js', '.mjs', '.cjs']);

/** 归一化为 SDK SlashCommand: 支持 default 导出 或 具名 name/handler */
function normalizeModule(mod: unknown, file: string, logger: Logger): SlashCommand | null {
  try {
    const m = (mod as { default?: unknown })?.default ?? mod;
    const obj = m as {
      name?: string | string[];
      aliases?: string[];
      description?: string;
      usage?: string;
      handler?: (ctx: never) => unknown;
      authorized?: (ctx: never) => boolean | string;
    };
    if (!obj || typeof obj !== 'object') {
      logger.warn(`[ext] ${file}: 导出不是对象, 跳过`);
      return null;
    }
    const names = Array.isArray(obj.name) ? obj.name : [obj.name ?? ''];
    const finalNames = [...names, ...(Array.isArray(obj.aliases) ? obj.aliases : [])].filter(Boolean);
    if (finalNames.length === 0 || typeof obj.handler !== 'function') {
      logger.warn(`[ext] ${file}: 缺 name 或 handler, 跳过`);
      return null;
    }
    const cmd: SlashCommand = {
      name: finalNames.length > 1 ? finalNames : finalNames[0]!,
      description: String(obj.description ?? '自定义扩展命令'),
      handler: obj.handler as never,
    };
    if (obj.usage) cmd.usage = obj.usage;
    if (typeof obj.authorized === 'function') cmd.authorized = obj.authorized as never;
    return cmd;
  } catch (err) {
    logger.warn(`[ext] ${file}: 归一化失败 ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * 扫描并加载扩展命令目录下的全部命令。
 * fail-soft: 单个文件坏/抛错只记日志, 不影响其它扩展与插件本体。
 */
export async function loadExtensionCommands(cwd: string | undefined, logger: Logger): Promise<SlashCommand[]> {
  const dir = cwd ? join(cwd, EXT_COMMANDS_SUBDIR) : join(process.cwd(), EXT_COMMANDS_SUBDIR);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => ALLOWED_EXT.has(extname(f).toLowerCase()));
  } catch {
    // 目录不存在 → 无扩展, 正常
    return [];
  }
  const out: SlashCommand[] = [];
  for (const f of files.sort()) {
    const abs = join(dir, f);
    try {
      // Windows 绝对路径必须转 file:// URL 再动态 import(带时间戳防模块缓存)
      const url = pathToFileURL(abs).href + `?t=${Date.now()}`;
      const mod = await import(url);
      const cmd = normalizeModule(mod, f, logger);
      if (cmd) {
        out.push(cmd);
        logger.info(`[ext] 已加载扩展命令: ${f} → /${Array.isArray(cmd.name) ? cmd.name.join('|') : cmd.name}`);
      }
    } catch (err) {
      logger.warn(`[ext] ${f} 加载失败(已跳过, 不影响其它): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

/** 扩展目录路径(cwd 不存在时 undefined; dock/工具展示用) */
export function extensionCommandsDir(cwd: string | undefined): string {
  return cwd ? join(cwd, EXT_COMMANDS_SUBDIR) : join(process.cwd(), EXT_COMMANDS_SUBDIR);
}

/** 扩展工具目录路径(dock/工具展示用) */
export function extensionToolsDir(cwd: string | undefined): string {
  return cwd ? join(cwd, EXT_TOOLS_SUBDIR) : join(process.cwd(), EXT_TOOLS_SUBDIR);
}

// ── 扩展工具(P4.2) ─────────────────────────────────────────────
// 扩展文件格式(ESM, 与 dsh tool 形状对齐, 见 README/示例):
//   export default {
//     name: 'echo_text',
//     description: '把用户文本原样返回(演示)',
//     inputSchema: { text: { type: 'string', required: true, description: '要回显的文本' } },
//     async run(args, env) {          // env: { cwd, manager, sender, replyTarget, logger, ... }
//       return { ok: true, msg: args.text };
//     },
//   };
// run 返回值统一 { ok, msg, data? }; 抛错会被外层捕获转 { ok:false, msg }。

/** 归一化后的扩展工具定义 */
export interface ExtensionToolDef {
  file: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 执行体: 参数 schema 由调用方校验, run 直接收已校验 args + env */
  run: (args: Record<string, unknown>, env: Record<string, unknown>) => Promise<unknown> | unknown;
}

function normalizeToolModule(mod: unknown, file: string, logger: Logger): ExtensionToolDef | null {
  try {
    const m = (mod as { default?: unknown })?.default ?? mod;
    const obj = m as {
      name?: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      parameters?: Record<string, unknown>;
      run?: (args: Record<string, unknown>, env: Record<string, unknown>) => unknown;
    };
    const name = String(obj?.name ?? '').trim();
    if (!name || typeof obj?.run !== 'function') {
      logger.warn(`[ext-tool] ${file}: 缺 name 或 run, 跳过`);
      return null;
    }
    return {
      file,
      name,
      description: String(obj.description ?? '用户扩展工具'),
      inputSchema: obj.inputSchema ?? obj.parameters ?? {},
      run: obj.run,
    };
  } catch (err) {
    logger.warn(`[ext-tool] ${file}: 归一化失败 ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** 扫描并加载扩展工具目录(P4.2; 由 channel-tools 在注册时调用) */
export async function loadExtensionTools(cwd: string | undefined, logger: Logger): Promise<ExtensionToolDef[]> {
  const dir = cwd ? join(cwd, EXT_TOOLS_SUBDIR) : join(process.cwd(), EXT_TOOLS_SUBDIR);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => ALLOWED_EXT.has(extname(f).toLowerCase()));
  } catch {
    return [];
  }
  const out: ExtensionToolDef[] = [];
  for (const f of files.sort()) {
    const abs = join(dir, f);
    try {
      const url = pathToFileURL(abs).href + `?t=${Date.now()}`;
      const mod = await import(url);
      const def = normalizeToolModule(mod, f, logger);
      if (def) {
        out.push(def);
        logger.info(`[ext-tool] 已加载扩展工具: ${f} → ${def.name}`);
      }
    } catch (err) {
      logger.warn(`[ext-tool] ${f} 加载失败(已跳过): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
