/**
 * QQ Bot 凭据初始化 — 扫码绑定
 *
 * 当 appId/appSecret 未配置时，通过 @tencent-connect/qqbot-connector
 * 唤起终端扫码流程获取凭据，并写入 dsh profile 配置。
 */
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { startQrConnect } from '@tencent-connect/qqbot-connector';
import type { QrConnectCredentials } from '@tencent-connect/qqbot-connector';

/** 凭据结果 */
export interface SetupCredentials {
  appId: string;
  appSecret: string;
}

/** 终端可点击的 OSC 8 超链接（不支持 OSC 8 的终端会忽略控制序列，退化为纯 URL 文本） */
function clickableLink(url: string): string {
  return `\u001b]8;;${url}\u001b\\${url}\u001b]8;;\u001b\\`;
}

/**
 * 执行 QR 扫码绑定，获取 QQ Bot 凭据
 *
 * 在终端打印二维码等待用户扫码；同时输出扫码 URL，
 * 供二维码因系统字符问题渲染错位时点击/复制到浏览器打开扫码。
 */
export async function runQrSetup(source = 'dsh-qqbot'): Promise<SetupCredentials | null> {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  QQ Bot 凭据未配置，启动扫码绑定');
  console.log('══════════════════════════════════════════════════════\n');

  try {
    console.log('请使用手机 QQ 扫描下方二维码完成绑定...\n');

    // 回调风格：onQrDisplayed 会在二维码打印后、轮询开始前回调扫码 URL，
    // 让用户在二维码错位时也能通过链接打开扫码页（二维码过期刷新会再次触发）。
    const credentials = await new Promise<QrConnectCredentials[]>((resolve, reject) => {
      startQrConnect(
        {
          onSuccess: resolve,
          onFailure: reject,
          onQrDisplayed: (url) => {
            console.log('二维码显示异常？点击下方链接，用浏览器打开即可完成扫码:');
            console.log(`  ${clickableLink(url)}\n`);
          },
          onQrExpired: () => {
            console.log('二维码已过期，正在刷新…\n');
          },
        },
        { source },
      );
    });

    if (!credentials || credentials.length === 0) {
      console.error('[im-qqbot] 扫码未返回凭据');
      return null;
    }

    const cred = credentials[0];
    if (!cred) {
      console.error('[im-qqbot] 扫码未返回有效凭据');
      return null;
    }
    console.log(`\n✔ 绑定成功！AppID: ${cred.appId}\n`);

    return {
      appId: cred.appId,
      appSecret: cred.appSecret,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('Cannot find') || msg.includes('ERR_MODULE_NOT_FOUND')) {
      console.error('[im-qqbot] @tencent-connect/qqbot-connector 未安装，无法扫码绑定');
      console.error('[im-qqbot] 请通过环境变量配置:');
      console.error('  export QQBOT_APPID="你的AppID"');
      console.error('  export QQBOT_SECRET="你的AppSecret"');
    } else {
      console.error(`[im-qqbot] 扫码绑定失败: ${msg}`);
    }

    return null;
  }
}

/**
 * 将凭据写入 dsh profile 的 cordis.patch.yml
 *
 * 行级编辑(不再整文件 YAML 解析)——cordis.patch.yml 常含宿主 `!!js` 自定义标签,
 * js-yaml 无法解析会抛错导致自动保存失败(实测线上文件即因此走到手动引导)。
 * 只定位/更新目标实例条目块(顶层或 `- insert:` 内的 4 空格形态)中的 appId/appSecret 行,
 * 文件其它内容(含 !!js、其它实例、insert 包装)原样保留。
 *
 * ⚠️ 2026-09-10 修复两处线上事故:
 *   1. 旧实现把条目名硬编码成 `im-qqbot`, 对 `im-qqbot-2` 这类实例找不到块 →
 *      在文件末尾追加了一个顶层 `- id: im-qqbot`(新版 dsh 无此 entry, 会让整棵插件树加载失败);
 *      现按 instEntryId(来自 config.settingsNs)定位, 且**绝不新建顶层 entry id**。
 *   2. appId 必须写为**带引号的字符串** —— 新版 cordis 严格校验 `$.appId expected string`,
 *      裸数字(1905515836)会让 preset/插件树整体挂载失败。
 *
 * @param credentials 扫码得到的 appId/appSecret
 * @param profileDir dsh profile 目录(含 cordis.patch.yml)
 * @param logger 日志器
 * @param instEntryId 目标条目 id(即 loader entry id, 默认 `im-qqbot`)
 */
export function persistCredentialsToProfile(
  credentials: SetupCredentials,
  profileDir?: string,
  logger?: { info(msg: string, ...args: unknown[]): void; warn(msg: string, ...args: unknown[]): void },
  instEntryId = 'im-qqbot',
): boolean {
  const log = logger ?? console;
  const dir = profileDir;
  const entryId = (instEntryId || 'im-qqbot').trim() || 'im-qqbot';
  if (!dir) {
    // 开发模式：插件从源码加载、不在 node_modules 下，无法定位 profile 目录
    printEnvInstructions(credentials);
    return false;
  }

  const patchPath = resolve(dir, 'cordis.patch.yml');

  try {
    // 1. 读原文(可能含 !!js 等宿主标签, 绝不做整文件 YAML 解析)
    let text = '';
    if (existsSync(patchPath)) text = readFileSync(patchPath, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines: string[] = text.length ? text.split(/\r\n|\n/) : [];

    /** appId/appSecret 一律单引号字符串: 宿主 schema 要求 string, 裸数字会挂载失败 */
    const ystr = (v: string): string => `'${String(v).replace(/'/g, "''")}'`;

    // 条目行: 允许任意缩进(顶层 0 / insert 内 4), id 需精确匹配 entryId
    const esc = entryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const HEAD_RE = new RegExp(`^\\s*-\\s*id:\\s*['"]?${esc}['"]?\\s*$`);
    const headIdx = lines.findIndex((l) => HEAD_RE.test(l));

    let outLines: string[];
    if (headIdx >= 0) {
      // 2a. 已有目标块: 块结束 = 下一个"缩进不更深的条目行"(或文件尾)
      const headIndent = ((lines[headIdx] as string).match(/^\s*/) ?? [''])[0].length;
      let blockEnd = lines.length;
      for (let i = headIdx + 1; i < lines.length; i++) {
        const li = lines[i] as string;
        const ind = ((li.match(/^\s*/) ?? [''])[0]).length;
        if (/- /.test(li) && ind <= headIndent) { blockEnd = i; break; }
      }
      const block = lines.slice(headIdx, blockEnd);
      // config 字段缩进: 找块内 `config:` 行缩进; 默认 headIndent + 2
      let cfgIndent = headIndent + 2;
      const cfgLine = block.findIndex((l) => new RegExp(`^\\s{${headIndent + 1},}config:\\s*$`).test(l));
      if (cfgLine >= 0) {
        cfgIndent = ((block[cfgLine] as string).match(/^\s*/) ?? [''])[0].length;
      }
      const valIndent = cfgIndent + 2;

      const upsertKey = (key: string, value: string, arr: string[]): string[] => {
        const re = new RegExp(`^(\\s*)${key}:\\s*.*$`);
        const hit = arr.findIndex((l) => re.test(l));
        if (hit >= 0) {
          const indent = ((arr[hit] as string).match(/^\s*/) ?? [''])[0];
          arr[hit] = `${indent}${key}: ${value}`;
          return arr;
        }
        // 无该键: config: 行后插入; 无 config: 则在 id 行后补 config + 键
        const insertAt = cfgLine >= 0 ? cfgLine + 1 : 1;
        const pad = ' '.repeat(valIndent);
        if (cfgLine < 0) {
          arr.splice(1, 0, ' '.repeat(cfgIndent) + 'config:', `${pad}${key}: ${value}`);
        } else {
          arr.splice(insertAt, 0, `${pad}${key}: ${value}`);
        }
        return arr;
      };
      const nb = upsertKey('appId', ystr(credentials.appId), block.slice());
      upsertKey('appSecret', ystr(credentials.appSecret), nb);
      outLines = lines.slice(0, headIdx).concat(nb, lines.slice(blockEnd));
    } else {
      // 2b. 没有目标块: **不再新建顶层 `- id: xxx`**(顶层 id 只能覆盖已存在的 bundle entry,
      //     否则宿主报 patch entry not found / 插件树加载失败)。改用 `- insert:` 包装新增。
      const tail = lines.slice();
      while (tail.length > 0 && tail[tail.length - 1] === '') tail.pop();
      outLines = tail.concat([
        '',
        '# QQ Bot 凭据（扫码绑定自动生成）',
        '- insert:',
        `    - id: ${entryId}`,
        '      name: @zaofan/dsh-qqbot',
        '      config:',
        `        appId: ${ystr(credentials.appId)}`,
        `        appSecret: ${ystr(credentials.appSecret)}`,
        ...(entryId !== 'im-qqbot' ? [`        settingsNs: '${entryId}'`] : []),
      ]);
    }

    mkdirSync(dir, { recursive: true });
    const finalText = (outLines.join(eol)).replace(/\n{3,}/g, '\n\n').trimEnd() + eol;
    writeFileSync(patchPath, finalText, 'utf8');
    log.info(`✔ 凭据已写入: ${patchPath} (entry id: ${entryId})`);
    log.info(`  下次启动将自动使用保存的凭据`);
    return true;
  } catch (err) {
    log.warn(`写入配置失败: ${err instanceof Error ? err.message : String(err)}`);
    printYamlInstructions(credentials, patchPath, entryId);
    return false;
  }
}


/** 开发模式引导：未定位到 profile 目录，引导用环境变量配置（console.log 确保可见） */
function printEnvInstructions(credentials: SetupCredentials): void {
  console.log('未检测到 profile 目录（开发模式），请通过环境变量配置凭据:');
  if (process.platform === 'win32') {
    // CMD 语法
    console.log(`  set QQBOT_APPID=${credentials.appId}`);
    console.log(`  set QQBOT_SECRET=${credentials.appSecret}`);
    // PowerShell 语法（dsh 默认 shell 是 pwsh）
    console.log('PowerShell 用户请用:');
    console.log(`  $env:QQBOT_APPID="${credentials.appId}"`);
    console.log(`  $env:QQBOT_SECRET="${credentials.appSecret}"`);
  } else {
    console.log(`  export QQBOT_APPID="${credentials.appId}"`);
    console.log(`  export QQBOT_SECRET="${credentials.appSecret}"`);
  }
}

/** 正式安装引导：自动写入失败，引导手动在 cordis.patch.yml 配置（console.log 确保可见） */
function printYamlInstructions(credentials: SetupCredentials, patchPath: string, entryId = 'im-qqbot'): void {
  console.log('无法自动保存凭据，请手动打开以下文件添加配置:');
  console.log(`  ${patchPath}`);
  console.log('');
  console.log('  - insert:');
  console.log(`      - id: ${entryId}`);
  console.log("        name: '@zaofan/dsh-qqbot'");
  console.log('        config:');
  console.log(`          appId: '${credentials.appId}'`);
  console.log(`          appSecret: '${credentials.appSecret}'`);
}
