/**
 * botplay-store.ts — botplay 事件配置文件存储(2026-09-10 M4.3)
 *
 * 动机(主人 2026-09-10 11:50): botplay 事件原本存 ~/.dsh/settings.yaml 的
 * im-qqbot* 命名空间里, 和 behavior/sticker/groupAdmin 等开关挤在一起;
 * 改为独立文件 {dataRoot}/.qqbot/botplay-events.json —— 跟群管台账
 * (groups.json/join-pending.json/broadcast-tasks.json) 同目录, 跟随账号 dataRoot 走。
 *
 * 读写纪律:
 *   - 读: 每次现读文件(支持热更), 首次启动检测 settings 里旧数据 → 自动迁移到文件;
 *   - 写: 原子写(tmp+rename, 仿 chat-ledger); dock 装配器保存走 settings-host 新路由;
 *   - 兜底: 文件读失败/为空时回退 settings 现值(双源一致由 host 路由保证)。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { BotplayEventConfig } from '../config.js';

/** 事件配置文件路径: {dataRoot}/botplay-events.json(2026-09-10 M4.3 主人定:
 *  存工作目录根, 和「表情包」等平级, 不藏进 .qqbot 子目录) */
export function botplayEventsPath(dataRoot: string): string {
  return join(dataRoot, 'botplay-events.json');
}

function loadFile(dataRoot: string): BotplayEventConfig[] | undefined {
  try {
    const raw = readFileSync(botplayEventsPath(dataRoot), 'utf8');
    const o = JSON.parse(raw) as { events?: BotplayEventConfig[] } | BotplayEventConfig[];
    const arr = Array.isArray(o) ? o : (o && Array.isArray(o.events) ? o.events : undefined);
    return Array.isArray(arr) ? arr : undefined;
  } catch { return undefined; }
}

/**
 * 兜底: 旧位置 {dataRoot}/.qqbot/botplay-events.json 若存在则迁移到根目录
 * (2026-09-10 早期版本曾放 .qqbot 子目录; 主人要求放根目录后兼容一次迁移)。
 */
function migrateLegacyFile(dataRoot: string): boolean {
  try {
    const legacy = join(dataRoot, '.qqbot', 'botplay-events.json');
    if (!existsSync(legacy)) return false;
    const raw = readFileSync(legacy, 'utf8');
    const o = JSON.parse(raw) as { events?: BotplayEventConfig[] } | BotplayEventConfig[];
    const arr = Array.isArray(o) ? o : (o && Array.isArray(o.events) ? o.events : undefined);
    if (!Array.isArray(arr) || arr.length === 0) return false;
    saveBotplayEvents(dataRoot, arr);
    try { renameSync(legacy, legacy + '.migrated-' + Date.now()); } catch { /* 旧文件不删也行 */ }
    return true;
  } catch { return false; }
}

/**
 * 读取事件列表(现读文件, 支持热更)。
 * 文件不存在/损坏 → 尝试从 settings 旧数据迁移(eventsFromSettings)并落盘;
 * settings 也没有 → 返回 []。
 */
export function readBotplayEvents(
  dataRoot: string,
  eventsFromSettings: () => BotplayEventConfig[],
): BotplayEventConfig[] {
  const fromFile = loadFile(dataRoot);
  if (fromFile) return fromFile;
  // 旧位置迁移兜底(.qqbot 子目录 → 根目录)
  if (migrateLegacyFile(dataRoot)) {
    const migrated = loadFile(dataRoot);
    if (migrated) return migrated;
  }
  // 首次/文件丢失: 迁移 settings 旧数据(2026-09-10 前 botplayEvents 在 settings.yaml)
  try {
    const legacy = eventsFromSettings();
    if (Array.isArray(legacy) && legacy.length > 0) {
      saveBotplayEvents(dataRoot, legacy);
      return legacy;
    }
  } catch { /* 迁移失败不阻断 */ }
  return [];
}

/** 写入事件列表(原子写; 空数组也写, 表示清空) */
export function saveBotplayEvents(dataRoot: string, events: BotplayEventConfig[]): boolean {
  try {
    const file = botplayEventsPath(dataRoot);
    const dir = file.slice(0, Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/')));
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp-' + Date.now();
    writeFileSync(tmp, JSON.stringify({ version: 1, events }, null, 2), 'utf8');
    renameSync(tmp, file);
    return true;
  } catch { return false; }
}
