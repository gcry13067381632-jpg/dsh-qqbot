/**
 * 通用工具函数
 *
 * 纯函数与常量，供插件入口与其他模块复用。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, '../..');

/** 插件包名（从 package.json 读取，随发布名自动对齐） */
const PLUGIN_NAME = readPluginName();

/** 插件版本号（从 package.json 读取） */
const PLUGIN_VERSION = readPluginVersion();

function readPluginName(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, 'package.json'), 'utf8')) as { name?: string };
    return pkg.name ?? '';
  } catch {
    return '';
  }
}

function readPluginVersion(): string {
  try {
    const pkgPath = resolve(PLUGIN_ROOT, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * 构造 User-Agent 头
 *
 * 格式: dsh-qqbot/{version} (Node/{nodeVersion}; {platform})
 */
export function buildUserAgent(): string {
  return `dsh-qqbot/${PLUGIN_VERSION} (Node/${process.versions.node}; ${os.platform()})`;
}

/**
 * 定位当前 dsh profile 目录（装本插件的那个 profile 根，如 …/profiles/web）
 *
 * 探测链（前两级对 pnpm link:/symlink/isolated 等任意安装形态都可靠，不依赖代码文件位置）：
 *   0) 环境变量 QQBOT_PROFILE_DIR 显式指定（安装脚本/高级用户）；
 *   1) 宿主扫描：遍历 ~/.dsh/profiles/<name>，找到「装着本插件」的 profile
 *      （node_modules/<scope>/<name> 存在，或 package.json 的 bundles/dependencies 提及本包名）；
 *   2) 兜底：从代码安装路径逐级向上找名为 node_modules 的目录并返回其父目录
 *      （仅实体安装/hoisted 布局有效）。
 *
 * @param baseDir - 起始目录，缺省为插件根（可注入便于测试）
 */
export function getProfileDir(baseDir: string = PLUGIN_ROOT): string | null {
  // 0) 显式覆盖
  const override = (process.env.QQBOT_PROFILE_DIR ?? '').trim();
  if (override && existsSync(override)) return override;

  // 1) 宿主扫描（link / symlink / isolated nodeLinker 都可靠）
  const scanned = scanDshProfiles();
  if (scanned) return scanned;

  // 2) 兜底：代码位置向上找 node_modules 的父目录
  let dir = baseDir;
  for (let i = 0; i < 32; i++) {
    if (basename(dir) === 'node_modules') return dirname(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 遍历 ~/.dsh/profiles/<name>，返回装着本插件的 profile 根目录（找不到返回 null） */
function scanDshProfiles(): string | null {
  const profilesRoot = join(os.homedir(), '.dsh', 'profiles');
  let entries: string[];
  try {
    entries = readdirSync(profilesRoot);
  } catch {
    return null;
  }
  for (const name of entries) {
    const prof = resolve(profilesRoot, name);
    try {
      if (!statSync(prof).isDirectory()) continue;
    } catch {
      continue;
    }
    // 判据 1: node_modules/<scope>/<pkg> 已安装（实体目录或 link 都能命中）
    if (PLUGIN_NAME) {
      const scope = PLUGIN_NAME.startsWith('@') ? PLUGIN_NAME.split('/')[0] : '';
      const pkg = scope ? PLUGIN_NAME.slice(scope.length + 1) : PLUGIN_NAME;
      const installed = scope
        ? join(prof, 'node_modules', scope, pkg)
        : join(prof, 'node_modules', pkg);
      if (existsSync(installed)) return prof;
    }
    // 判据 2: package.json 的 bundles / dependencies 提及本包名（尚未实体安装时）
    try {
      const pkg = JSON.parse(readFileSync(join(prof, 'package.json'), 'utf8')) as {
        dsh?: { profile?: { bundles?: string[] } }; dependencies?: Record<string, string>;
      };
      const blob = JSON.stringify(pkg.dsh?.profile?.bundles ?? []) + JSON.stringify(pkg.dependencies ?? {});
      if (PLUGIN_NAME && blob.includes(PLUGIN_NAME)) return prof;
    } catch {
      /* 无 package.json 的目录跳过 */
    }
  }
  return null;
}

/**
 * 解析环境变量占位配置
 */
export function resolveEnv(configValue: string, envKey: string): string {
  if (configValue && configValue !== '__FROM_ENV__' && !configValue.startsWith('process.env')) {
    return configValue;
  }
  return process.env[envKey] ?? '';
}

/**
 * 格式化相对时间
 */
export function formatRelativeTime(ts?: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s 前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m 前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h 前`;
  return `${Math.floor(diff / 86_400_000)}d 前`;
}
