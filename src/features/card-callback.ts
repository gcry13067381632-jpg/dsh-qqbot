/**
 * card-callback.ts — 自定义卡片按钮回调（dock「📝 卡片」编辑器发出的卡）
 *
 * ⚠️ 2026-09-10 主人要求：卡片编辑器的按钮要能写「回文本 / 跳链接 / 执行命令」三种动作。
 *   现状：编辑器发的卡是"裸"卡片，没有 botplay 事件挂靠 → 点击回调没人处理
 *   （botplay 的 handleInteraction 要求 findEvent 命中，否则直接回"事件已被删除"）。
 *   这里补一条**独立于 botplay 的兜底链路**：
 *     host(settings-host.js) 发卡时把按钮动作写入 `{dataRoot}/.qqbot/card-callbacks.json`，
 *     按钮 data 编码为 `bpk:<cardId>:<buttonId>`（bp: 前缀归 botplay，bpk: 归本模块，互不干扰）；
 *     点击 → INTERACTION_CREATE(type=11) → bootstrap 分发兜底 → 查表执行：
 *       · action=text → 直接回该文本(sendMarkdown)
 *       · action=cmd  → 走命令执行器(与 botplay 指令型按钮同一套 buildCommandList)
 *       · action=url  → 官方 type=0 跳转按钮不会走到回调；真收到就提示手动打开
 *   分工：presetSwitcher / approval / question / botplay 依次先处理，本模块只在**没人消费时**兜底。
 *
 * ⚠️ 文件格式是 host 与 dist 两侧的约定，改格式必须同步 settings-host.js 的
 *   `writeCardCallbacks` / `buildCardKeyboardFromPairs`。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 卡片按钮 data 前缀（区别于 botplay 的 `bp:` 与目录卡的 `bpc:`） */
export const CARD_BTN_PREFIX = 'bpk:';

/** 最多保留的卡片条数（超出丢最旧的；卡片本身有过期时间兜底） */
const MAX_CARDS = 200;

/** 按钮动作类型 */
export type CardButtonAction = 'text' | 'cmd' | 'url';

export interface CardCallbackButton {
  /** 卡片内按钮短 id（b1/b2…），与 cardId 拼成 data */
  id: string;
  label: string;
  action: CardButtonAction;
  /** text=要回的文本；cmd=指令名(不带 /)；url=跳转地址 */
  payload: string;
}

export interface CardCallbackCard {
  cardId: string;
  buttons: CardCallbackButton[];
  createdAt: number;
  expireAt: number;
  /** 发到哪(仅诊断用) */
  scope?: 'group' | 'c2c';
  targetId?: string;
}

interface CardCallbackFile {
  version: number;
  cards: CardCallbackCard[];
}

export function cardCallbacksPath(dataRoot: string): string {
  return join(dataRoot, '.qqbot', 'card-callbacks.json');
}

function readFile(dataRoot: string): CardCallbackFile {
  const p = cardCallbacksPath(dataRoot);
  try {
    if (!existsSync(p)) return { version: 1, cards: [] };
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<CardCallbackFile>;
    const cards = Array.isArray(raw?.cards) ? raw.cards : [];
    return { version: 1, cards: cards.filter((c): c is CardCallbackCard => !!c && typeof c.cardId === 'string') };
  } catch {
    return { version: 1, cards: [] };
  }
}

/** 追加一张卡片（顺带清理过期项、按上限截断）；host 侧发卡时也会写同一文件 */
export function appendCardCallback(dataRoot: string, card: CardCallbackCard): void {
  const p = cardCallbacksPath(dataRoot);
  try {
    mkdirSync(dirname(p), { recursive: true });
    const f = readFile(dataRoot);
    const now = Date.now();
    // 同 cardId 覆盖(重发同一张卡)；过期项清掉
    const kept = f.cards.filter((c) => c.cardId !== card.cardId && (c.expireAt || 0) > now);
    kept.push(card);
    const trimmed = kept.slice(-MAX_CARDS);
    writeFileSync(p, JSON.stringify({ version: 1, cards: trimmed }, null, 1), 'utf8');
  } catch {
    /* 写失败只影响按钮回调, 不阻断发卡 */
  }
}

/** 按 cardId 查卡（过期返回 undefined） */
export function findCardCallback(dataRoot: string, cardId: string): CardCallbackCard | undefined {
  const c = readFile(dataRoot).cards.find((x) => x.cardId === cardId);
  if (!c) return undefined;
  if (c.expireAt && Date.now() > c.expireAt) return undefined;
  return c;
}

/** 从 interaction 的 button_data 解析 cardId + buttonId；非本模块按钮返回 null */
export function parseCardButtonData(data: string | undefined): { cardId: string; buttonId: string } | null {
  if (!data || !data.startsWith(CARD_BTN_PREFIX)) return null;
  const rest = data.slice(CARD_BTN_PREFIX.length);
  const idx = rest.indexOf(':');
  if (idx <= 0 || idx >= rest.length - 1) return null;
  return { cardId: rest.slice(0, idx), buttonId: rest.slice(idx + 1) };
}

/** 命令执行器签名（与 botplay 指令型按钮一致：给命令名与回复目标，返回要发的文本） */
export type CardCommandExecutor = (cmdName: string, target: unknown) => Promise<string>;

export interface CardCallbackDeps {
  dataRoot: string;
  /** 发文本(群/私聊通用; 由 bootstrap 注入真实 sender) */
  sendText: (target: unknown, text: string) => Promise<void>;
  /** 执行斜杠命令(不带 /)；未注入时指令按钮只提示不可用 */
  commandExecutor?: CardCommandExecutor;
  logger?: { info?(m: string, ...a: unknown[]): void; warn?(m: string, ...a: unknown[]): void };
}

/**
 * 卡片按钮回调处理器：bootstrap 的 interaction 分发链**最后一环**。
 * @returns true = 已消费（调用方无需其它处理）
 */
export function createCardCallbackController(deps: CardCallbackDeps): {
  handleInteraction(event: unknown, target: unknown): Promise<boolean>;
} {
  const { dataRoot, sendText, commandExecutor, logger } = deps;
  return {
    async handleInteraction(event: unknown, target: unknown): Promise<boolean> {
      const e = event as { data?: { type?: number; resolved?: { button_data?: string } } };
      if (e?.data?.type !== 11) return false;
      const parsed = parseCardButtonData(e.data.resolved?.button_data);
      if (!parsed) return false;
      const card = findCardCallback(dataRoot, parsed.cardId);
      if (!card) {
        // 不是本模块发的卡 / 已过期 → 不消费, 让别的处理器或默认提示接手
        return false;
      }
      const btn = card.buttons.find((b) => b.id === parsed.buttonId);
      if (!btn) return false;

      try {
        if (btn.action === 'text') {
          const text = String(btn.payload ?? '').trim();
          if (text) await sendText(target, text);
          return true;
        }
        if (btn.action === 'cmd') {
          const cmdName = String(btn.payload ?? '').trim().replace(/^\//, '');
          if (!cmdName) return true;
          if (!commandExecutor) {
            await sendText(target, '指令执行器未就绪, 请稍后再试~');
            return true;
          }
          const out = await commandExecutor(cmdName, target);
          if (out && out.trim()) await sendText(target, out);
          return true;
        }
        if (btn.action === 'url') {
          // 官方 type=0 跳转按钮点击时客户端直接跳, 正常不会走到回调; 降级时给个提示
          const url = String(btn.payload ?? '').trim();
          await sendText(target, url ? `跳转按钮: ${url}(如未自动跳转请手动打开)` : '该按钮是跳转按钮, 请在支持跳转的客户端点击');
          return true;
        }
      } catch (err) {
        logger?.warn?.(`[card-callback] 处理失败 card=${parsed.cardId} btn=${parsed.buttonId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return false;
    },
  };
}
