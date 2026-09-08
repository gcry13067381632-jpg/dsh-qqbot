/**
 * data-root.ts — 插件数据根目录(2026-09-08)
 *
 * 目标: 插件运行数据(表情包 / .qqbot / .qqbot-extensions)不再散落在 agent cwd 根,
 * 而是统一挂到 config.dataRoot(通常 = cwd/dshqqbot)下, 与工作区其他文件分离。
 * 未配置 dataRoot 时全部行为与旧版一致(数据仍在 cwd), 向后兼容。
 *
 * 迁移: 配置 dataRoot 后首次启动, 若 cwd 下存在旧数据目录而 dataRoot 下还没有,
 * 自动整目录搬移(rename, 同盘瞬时完成), 不覆盖已有目标。
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';

/** 旧版数据直接落在 agent cwd 的清单(与 dataRoot 对应的相对布局; 目录+散文件) */
export const DATA_SUBDIRS = ['表情包', '.qqbot', '.qqbot-extensions', 'schedule-state.json'] as const;

/** 插件数据根: config.dataRoot(绝对化) > config.cwd > 进程 cwd */
export function dataRootOf(config: ImQQBotConfig): string {
  const r = config.dataRoot ? resolve(config.dataRoot) : '';
  if (r) return r;
  return config.cwd || process.cwd();
}

/** 图库/台账/活性计数等通用数据目录: config.sticker.dataDir 覆盖 > {dataRoot}/表情包 */
export function stickerDirOf(config: ImQQBotConfig): string {
  if (config.sticker?.dataDir) return config.sticker.dataDir;
  return join(dataRootOf(config), '表情包');
}

/**
 * 启动早期调用(bootstrap 最先、任何数据目录初始化之前):
 * 已配置 dataRoot 时, 把 cwd 下的旧数据目录搬进 dataRoot。
 * 幂等: 目标已存在则跳过该子目录(视为已迁移/已有新数据), 绝不覆盖。
 */
export function migrateLegacyData(config: ImQQBotConfig, logger?: Logger): void {
  if (!config.dataRoot) return; // 未启用 dataRoot → 数据仍留 cwd, 无需迁移
  const root = resolve(dataRootOf(config));
  const srcBase = config.cwd ? resolve(config.cwd) : process.cwd();
  if (srcBase === root) return;
  for (const sub of DATA_SUBDIRS) {
    const from = join(srcBase, sub);
    const to = join(root, sub);
    try {
      if (!existsSync(from)) continue;
      if (existsSync(to)) {
        logger?.warn(`[data-root] ${sub}: 目标已存在, 保留 ${to}(跳过迁移)`);
        continue;
      }
      mkdirSync(root, { recursive: true });
      renameSync(from, to);
      logger?.info(`[data-root] 已迁移 ${from} → ${to}`);
    } catch (err) {
      logger?.warn(`[data-root] 迁移 ${sub} 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
