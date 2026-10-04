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
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { Logger } from '../types.js';

/** 扩展命令目录名(相对 cwd) */
export const EXT_COMMANDS_SUBDIR = join('.qqbot-extensions', 'commands');
/** 扩展工具目录名(相对 cwd) */
export const EXT_TOOLS_SUBDIR = join('.qqbot-extensions', 'tools');
/** botplay 自定义事件目录名(相对数据根; 2026-10-05 第三套扩展) */
export const EXT_BOTPLAY_SUBDIR = join('.qqbot-extensions', 'botplay');

/** 扩展文件允许的扩展名 */
const ALLOWED_EXT = new Set(['.js', '.mjs', '.cjs']);

/**
 * 扩展文件版本号(取文件 mtime)。
 * 2026-09-15 修复内存泄漏: 原用时间戳 query 做 cache-bust, 每次调用都生成全新 URL,
 * Node 的 ESM 模块注册表(ModuleMap)对每个 URL 永久强引用, 旧模块实例无法被 GC ——
 * 长时间运行(每次消息 mount / hotReload)会持续吃内存直至 OOM。
 * 改为按 mtime: 文件未改动 → URL 相同 → 复用缓存模块; 改动后自动加载新版本。
 */
function fileVersion(p: string): string {
  try {
    return String(Math.floor(statSync(p).mtimeMs));
  } catch {
    return String(Date.now());
  }
}

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
      // Windows 绝对路径必须转 file:// URL 再动态 import(版本号=mtime, 见 fileVersion)
      const url = pathToFileURL(abs).href + `?v=${fileVersion(abs)}`;
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
      const url = pathToFileURL(abs).href + `?v=${fileVersion(abs)}`;
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

// ── botplay 自定义事件模块(2026-10-05) ─────────────────────────────────
// 契约与 ctx 能力见 features/botplay-ext.ts 头部注释; 这里只负责"按文件名加载一个模块"。
// 与上面两套扩展的两点不同(为什么不能直接复用 loadExtensionTools):
//   ① 扫描根是**数据根**(dataRoot)不是 agent cwd —— botplay 事件本身就是 dataRoot 下的文件;
//   ② 是"按需单文件加载"(事件 JSON 的 file 字段点名), 而且**必须能把错误带回去给面板**,
//      所以这里不做 fail-soft 吞错: 抛出/返回 error 由调用方(botplay 控制器)决定降级方式。

/** botplay 自定义事件模块目录(相对数据根) */
export function botplayExtensionsDir(dataRoot: string): string {
  return join(dataRoot, EXT_BOTPLAY_SUBDIR);
}

/**
 * 文件名安全校验(防 `../` 逃逸出扩展目录):
 * 只允许"纯文件名", 不允许任何路径分隔符(Windows 反斜杠也算)。
 * 说明: 允许子目录会带来逃逸面, 而主人的使用场景(一个事件一个模块)根本不需要子目录。
 */
export function safeBotplayFileName(file: string): string | null {
  const f = String(file ?? '').trim();
  if (!f) return null;
  if (f.includes('/') || f.includes('\\') || f.includes('..')) return null;
  if (!/^[A-Za-z0-9._@-]+$/.test(f)) return null;
  if (!ALLOWED_EXT.has(extname(f).toLowerCase())) return null;
  return f;
}

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

/** 校验模块至少导出了一个钩子(全空的模块必然是写错了, 早点报错比静默不响应好) */
const BOTPLAY_HOOKS = ['onInit', 'onClick', 'onTick', 'onExpire', 'onDispose'] as const;

function normalizeBotplayModule(mod: unknown): { mod: BotplayModuleShape; name: string } | { error: string } {
  const m = ((mod as { default?: unknown })?.default ?? mod) as BotplayModuleShape | undefined;
  if (!m || typeof m !== 'object') return { error: '模块没有 default 导出对象(应 export default { onInit, onClick, … })' };
  const hooks = BOTPLAY_HOOKS.filter((h) => typeof (m as Record<string, unknown>)[h] === 'function');
  if (hooks.length === 0) {
    return { error: `模块没有导出任何钩子(至少要有 ${BOTPLAY_HOOKS.join(' / ')} 之一)` };
  }
  return { mod: m, name: String(m.name ?? '').trim() };
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
export async function loadBotplayExtensionModule(
  dataRoot: string,
  file: string,
  logger: Logger,
): Promise<{ ok: true; loaded: LoadedBotplayModule } | { ok: false; error: string; path: string }> {
  const safe = safeBotplayFileName(file);
  const dir = botplayExtensionsDir(dataRoot);
  if (!safe) {
    return { ok: false, error: `文件名不安全/扩展名不支持: ${file}(只允许 .mjs/.js/.cjs 的纯文件名)`, path: join(dir, String(file ?? '')) };
  }
  const abs = join(dir, safe);
  let mtime = 0;
  try {
    mtime = statSync(abs).mtimeMs;
  } catch (err) {
    return {
      ok: false,
      error: `模块文件不存在或读不到: ${abs}(${err instanceof Error ? err.message : String(err)})`,
      path: abs,
    };
  }
  try {
    const url = pathToFileURL(abs).href + `?v=${fileVersion(abs)}`;
    const raw = await import(url);
    const norm = normalizeBotplayModule(raw);
    if ('error' in norm) return { ok: false, error: `${safe}: ${norm.error}`, path: abs };
    logger.info(`[botplay-ext] 已加载模块: ${safe} (mtime=${Math.floor(mtime)})`);
    return {
      ok: true,
      loaded: {
        file: safe,
        path: abs,
        mtime: Math.floor(mtime),
        name: norm.name || safe.replace(/\.(mjs?|cjs)$/i, ''),
        mod: norm.mod,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[botplay-ext] ${safe} 加载失败: ${msg}`);
    return { ok: false, error: `${safe}: ${msg}`, path: abs };
  }
}

