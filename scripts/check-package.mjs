#!/usr/bin/env node
/**
 * check-package.mjs — 发布前自检:「单包自含」能成立的 4 项家当必须齐全,
 * 缺一即中止(配合 prepublishOnly 防止把半成品发出去)。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'dist/index.js',
  'client/qqbot-settings.js',
  'cordis.patch.yml',
  'settings-host.js',
];
const missing = required.filter((f) => !existsSync(resolve(root, f)));
if (missing.length) {
  console.error('[check-package] ✗ 缺少关键文件(单包自含不成立):');
  for (const f of missing) console.error('   ' + f);
  process.exit(1);
}

// package.json 自身完整性: files 白名单覆盖上述四项 + name/exports/dsh.client 在
let pkg;
try {
  pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
} catch (e) {
  console.error('[check-package] ✗ package.json 解析失败:', e.message);
  process.exit(1);
}
const files = Array.isArray(pkg.files) ? pkg.files : [];
const needInFiles = ['dist', 'client', 'cordis.patch.yml', 'settings-host.js'];
const notCovered = needInFiles.filter((f) => !files.some((x) => x === f || x.startsWith(f + '/')));
if (notCovered.length) {
  console.error('[check-package] ✗ files 白名单未覆盖:', notCovered.join(', '));
  process.exit(1);
}
if (!pkg.dsh?.client || pkg.dsh.client.platform !== 'web' || !pkg.exports?.['./client']) {
  console.error('[check-package] ✗ 缺 dsh.client(web) 或 exports["./client"] —— 设置面板 UI 不会出现');
  process.exit(1);
}

console.log('[check-package] ✓ 单包自含校验通过: dist + client + patch + settings-host 齐全, files/dsh.client 就绪');
