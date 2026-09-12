/**
 * data-root.ts — 插件数据根目录(2026-09-08)
 *
 * 目标(2026-09-12 起是**通用默认**, 不再要求用户手动配置): 插件运行数据
 * (表情包 / .qqbot / .qqbot-extensions / botplay-events.json / schedule-state.json) 一律挂到**数据根**下,
 * 与工作区其他文件分离 —— **任何用户**装了这个插件, 工作目录都能保持干净。
 *   数据根 = config.dataRoot(显式配置) > `{cwd}/dshqqbot`(新默认) > 进程 cwd。
 * 想保留"数据就放工作目录"的老行为: 显式配 `dataRoot: <cwd>`。
 *
 * 迁移: 首次启动时, 若 cwd 下存在旧数据目录而数据根下还没有, 自动整目录搬移(rename, 同盘瞬时完成), 不覆盖已有目标。
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';

/** 旧版数据直接落在 agent cwd 的清单(与数据根对应的相对布局; 目录+散文件) */
export const DATA_SUBDIRS = ['表情包', '.qqbot', '.qqbot-extensions', 'schedule-state.json', 'botplay-events.json'] as const;

/** 未配置 dataRoot 时的默认数据子目录名(通用设计: 让工作目录保持干净) */
export const DEFAULT_DATA_SUBDIR = 'dshqqbot';

/**
 * 插件数据根: config.dataRoot(绝对化) > `{cwd}/dshqqbot` > 进程 cwd。
 *
 * 2026-09-12 通用设计(主人要求: **任何用户**用这个插件, 工作目录都要保持干净):
 * 未配置 dataRoot 时**默认**落到 `{cwd}/dshqqbot`, 不再把 `.qqbot / 表情包 / .qqbot-extensions`
 * 直接倒在工作目录里。老用户 cwd 下的旧数据由 migrateLegacyData() 首次启动自动搬进来;
 * 想保留"数据就在工作目录"的老行为, 显式配 `dataRoot: <cwd>` 即可。
 */
export function dataRootOf(config: ImQQBotConfig): string {
  const r = config.dataRoot ? resolve(config.dataRoot) : '';
  if (r) return r;
  return join(config.cwd || process.cwd(), DEFAULT_DATA_SUBDIR);
}

/** 图库/台账/活性计数等通用数据目录: config.sticker.dataDir 覆盖 > {dataRoot}/表情包 */
export function stickerDirOf(config: ImQQBotConfig): string {
  if (config.sticker?.dataDir) return config.sticker.dataDir;
  return join(dataRootOf(config), '表情包');
}

/**
 * 启动早期调用(bootstrap 最先、任何数据目录初始化之前):
 * 把 cwd 下的旧数据目录搬进数据根(`{cwd}/dshqqbot` 或显式 dataRoot)。
 * 幂等: 目标已存在则跳过该子目录(视为已迁移/已有新数据), 绝不覆盖。
 */
export function migrateLegacyData(config: ImQQBotConfig, logger?: Logger): void {
  // 2026-09-12: 未配置 dataRoot 时现在**也有**默认数据根(`{cwd}/dshqqbot`) → 旧数据同样要搬;
  // 只有用户把 dataRoot 显式指到 cwd 本身(想保持旧行为)时, 下面的 srcBase === root 会自然跳过。
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
