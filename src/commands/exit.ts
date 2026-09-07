/**
 * /bot-restart — 通用自重启 dsh 宿主(2026-09-08, 主人定: 通用插件能力)
 *
 * 通用性: 不依赖任何硬编码路径/外部脚本 —— 动态自发现:
 *  - process.execPath = node 可执行文件; process.argv.slice(1) = 宿主启动参数(如 bin.js web);
 *  - 中间"重启助手"脚本写入系统 tmpdir(无中文路径坑), 用同一 node 解释器 detached 运行;
 *  - 助手: 延迟→杀当前宿主进程(process.kill)→等端口释放→按原命令重新 spawn 宿主(detached, unref)。
 * 跨平台(win/mac/linux), 任何机器装了本插件即可用 /bot-restart(或兼容的 /bot-exit)。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';

/** 触发自重启: 生成独立重启助手并脱手运行(当前宿主被杀也能继续拉起新宿主) */
export function selfRestart(delayMs = 1600, killWaitMs = 2000): boolean {
  try {
    const exe = process.execPath;              // node 路径(动态)
    const args = process.argv.slice(1);        // 宿主启动参数(动态, 如 [bin.js, 'web'])
    const pid = process.pid;                    // 当前宿主 PID(自己)
    const cwd = process.cwd();

    // 重启助手(独立 node 进程): 延迟 → 杀宿主 → 等 → 按原命令拉起新宿主
    const helper = [
      "const { spawn } = require('child_process');",
      `const pid = ${JSON.stringify(pid)};`,
      `const exe = ${JSON.stringify(exe)};`,
      `const args = ${JSON.stringify(args)};`,
      `const cwd = ${JSON.stringify(cwd)};`,
      'setTimeout(() => {',
      '  try { process.kill(pid, \'SIGTERM\'); } catch {}',
      `  setTimeout(() => {`,
      '    try {',
      '      const c = spawn(exe, args, { detached: true, stdio: \'ignore\', cwd });',
      '      c.unref();',
      '      try { require(\'fs\').unlinkSync(__filename); } catch {}',
      '    } catch (e) { console.error(\'[restart-helper] spawn fail\', e); }',
      `  }, ${killWaitMs});`,
      `}, ${delayMs});`,
    ].join('\n');

    const tmpFile = join(tmpdir(), `dsh-restart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.cjs`);
    writeFileSync(tmpFile, helper, 'utf8');
    // detached + unref: 重启助手脱离宿主独立存活, 宿主被杀它继续执行
    const child = spawn(exe, [tmpFile], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    // 宿主若被杀, 助手自己清理 tmp; 这里再兜底一个延迟删除(助手若已删则忽略)
    setTimeout(() => { try { rmSync(tmpFile, { force: true }); } catch { /* 已删 */ } }, delayMs + killWaitMs + 8000).unref?.();
    return true;
  } catch (err) {
    console.error('[bot-restart] 触发失败: ' + (err instanceof Error ? err.message : String(err)));
    return false;
  }
}

export function botRestartCommand(): SlashCommand {
  return {
    name: 'bot-restart',
    description: '通用自重启 dsh 宿主(动态识别启动命令, 杀旧+自动拉起; 回执后约4秒完成, 期间短暂离线)',
    handler: async () => {
      const ok = selfRestart();
      return ok
        ? '🔁 dsh web 即将自重启(约4秒, 期间短暂离线)。重启完成后我会回来报到~'
        : '❌ 自重启触发失败(看宿主日志)';
    },
  };
}

/** /bot-exit 旧命令兼容: 同样走自重启(杀+拉一条龙) */
export function botExitCommand(): SlashCommand {
  return {
    name: 'bot-exit',
    description: '(已升级) 结束并自重启 dsh 宿主, 同 /bot-restart',
    handler: async () => {
      const ok = selfRestart();
      return ok
        ? '👋 即将自重启(约4秒)。此命令已升级为 /bot-restart 同款(动态识别, 杀+自动拉起)。'
        : '❌ 自重启触发失败';
    },
  };
}
