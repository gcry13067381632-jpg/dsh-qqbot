import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INTRANET_NAME = '@tencent/dsh-qqbot';

// 1. 修改 package.json 的 name
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = INTRANET_NAME;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

// 2. 同步 cordis.patch.yml 中的插件 name
const patchFile = pkg.dsh?.bundle?.patch;
if (patchFile) {
  const patchPath = join(root, patchFile);
  const patch = readFileSync(patchPath, 'utf8');
  writeFileSync(
    patchPath,
    patch.replace(/name:\s*'@tencent-connect\/dsh-qqbot'/, `name: '${INTRANET_NAME}'`),
  );
}
