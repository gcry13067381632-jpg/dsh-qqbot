import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
/** 旧版数据直接落在 agent cwd 的清单(与数据根对应的相对布局; 目录+散文件) */
export declare const DATA_SUBDIRS: readonly ["表情包", ".qqbot", ".qqbot-extensions", "schedule-state.json", "botplay-events.json"];
/** 未配置 dataRoot 时的默认数据子目录名(通用设计: 让工作目录保持干净) */
export declare const DEFAULT_DATA_SUBDIR = "dshqqbot";
/**
 * 插件数据根: config.dataRoot(绝对化) > `{cwd}/dshqqbot` > 进程 cwd。
 *
 * 2026-09-12 通用设计(主人要求: **任何用户**用这个插件, 工作目录都要保持干净):
 * 未配置 dataRoot 时**默认**落到 `{cwd}/dshqqbot`, 不再把 `.qqbot / 表情包 / .qqbot-extensions`
 * 直接倒在工作目录里。老用户 cwd 下的旧数据由 migrateLegacyData() 首次启动自动搬进来;
 * 想保留"数据就在工作目录"的老行为, 显式配 `dataRoot: <cwd>` 即可。
 */
export declare function dataRootOf(config: ImQQBotConfig): string;
/** 图库/台账/活性计数等通用数据目录: config.sticker.dataDir 覆盖 > {dataRoot}/表情包 */
export declare function stickerDirOf(config: ImQQBotConfig): string;
/**
 * 启动早期调用(bootstrap 最先、任何数据目录初始化之前):
 * 把 cwd 下的旧数据目录搬进数据根(`{cwd}/dshqqbot` 或显式 dataRoot)。
 * 幂等: 目标已存在则跳过该子目录(视为已迁移/已有新数据), 绝不覆盖。
 */
export declare function migrateLegacyData(config: ImQQBotConfig, logger?: Logger): void;
//# sourceMappingURL=data-root.d.ts.map