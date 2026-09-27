/**
 * 构造 User-Agent 头
 *
 * 格式: dsh-qqbot/{version} (Node/{nodeVersion}; {platform})
 */
export declare function buildUserAgent(): string;
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
export declare function getProfileDir(baseDir?: string): string | null;
/**
 * 解析环境变量占位配置
 */
export declare function resolveEnv(configValue: string, envKey: string): string;
/**
 * 格式化相对时间
 */
export declare function formatRelativeTime(ts?: number): string;
//# sourceMappingURL=utils.d.ts.map