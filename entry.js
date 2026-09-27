/**
 * 包入口守卫（永远随包发布，不参与编译）。
 *
 * 为什么需要它：
 *   仓库不提交编译产物 `dist/`，而 dsh 的插件页支持"填 GitHub 仓库地址安装"。
 *   从 git 直装时若 pnpm 没有执行 `prepare`（新版 pnpm 默认拦截 git 依赖的构建脚本：
 *   `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`），装出来的包里就没有 `dist/`，
 *   宿主只会打印一句很难懂的 `failed to import`。
 *
 *   这里在入口处先自检，把"真正的原因 + 怎么办"直接打到控制台。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const missing = [];
for (const rel of ['dist/index.js', 'client/qqbot-settings.js', 'settings-host.js', 'cordis.patch.yml']) {
  if (!existsSync(join(here, rel))) missing.push(rel);
}

if (missing.length > 0) {
  const isDistMissing = missing.includes('dist/index.js');
  console.error('');
  console.error('  ┌──────────────────────────────────────────────────────────────┐');
  console.error('  │  dsh-qqbot 安装不完整，无法启动                              │');
  console.error('  └──────────────────────────────────────────────────────────────┘');
  console.error('  缺少文件: ' + missing.join(', '));
  console.error('  安装目录: ' + here);
  console.error('');
  if (isDistMissing) {
    console.error('  【最可能的原因】你是用 "GitHub 仓库地址" 安装的。');
    console.error('   仓库不提交编译产物 dist/，而新版 pnpm 默认不允许 git 依赖执行构建脚本');
    console.error('   （报错类似 ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED），于是 dist/ 没被编译出来。');
    console.error('');
    console.error('  【最简单的解决办法】');
    console.error('   把依赖换成本包在 npm 上的发布版（自带 dist，不需要任何构建）：');
    console.error('     pnpm add @zaofan/dsh-qqbot');
    console.error('   或者在 dsh 插件页里填【包名】 @zaofan/dsh-qqbot （而不是 GitHub 地址）。');
    console.error('');
    console.error('  【想继续用 git 源的化】');
    console.error('   在上面那个安装目录里手动编译一次：');
    console.error('     npm install && npm run build');
    console.error('   如果报 ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED，需要在 profile 的');
    console.error('   pnpm-workspace.yaml 里允许它执行脚本（错误信息里会给出确切的 allowBuilds 写法）。');
  }
  console.error('');
  throw new Error('dsh-qqbot: 安装不完整（缺少 ' + missing.join(', ') + '），请按上面的提示处理');
}

// 自检通过 → 正常导出
export * from './dist/index.js';
export { default } from './dist/index.js';
