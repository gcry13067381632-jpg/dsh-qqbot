/**
 * thinking-log.ts — 思考留档(观察期, 2026-09-13)
 *
 * 背景: 《好感度系统设计》§11 要走「四源对比」, 其中一源是大模型的思考(reasoning)。
 * 主人定的第一件事是**先把思考读进来并留档**, 供人工标注 50 条, 再定这条支路的生死。
 *
 * 取值来源(2026-09-13 实测): dsh 会话事件 `assistant/message` 的 data.message.content[]
 *   里 `{ type:'reasoning', text:'思考全文' }` —— 与宿主 @deepseek-ai/dsh-llm 的
 *   StreamChunk `reasoning-delta` 同源(插件侧走块级全文, 免累积、免误当正文发出去)。
 *   ⚠️ 还有空壳块 `{type:'reasoning', thinkingSignature:'reasoning_content'}` 无 text → 一律判空跳过。
 *
 * 红线(设计稿 §9 / §11):
 *   · 思考是她**隐私内部状态** —— 只写本地文件, **不进面板、不进 QQ、不参与任何行为判定**;
 *   · 与 value-scores.jsonl 分开存, 便于单独删除/停用;
 *   · 条数有上限, 超出滚动保留最新, 不无限膨胀。
 *
 * 数据位置: {dataRoot}/.qqbot/thinking-log.jsonl(一行一条 JSON)
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 留档上限(行): 超出后滚动保留最新 —— 观察期足够人工取样, 又不让文件无界增长 */
const MAX_LINES = 400;
/** 单条思考落盘的字数上限(截断; 标注 50 条够用, 避免文件膨胀) */
const MAX_TEXT_CHARS = 1500;
/** 每写这么多条整理一次(不必每条都读全文件) */
const COMPACT_EVERY = 25;

let sinceCompact = 0;

export interface ThinkingEntry {
  /** 会话范围: group / c2c */
  scope?: string;
  /** 群 openid 或私聊 openid */
  peerId?: string;
  /** dsh 回合号 */
  turn?: number;
  /** 回合内步号(与正文同格才可配对) */
  step?: number;
  /** 模型上报的思考 token 数(usage.reasoningTokens, 有则记) */
  tokens?: number;
  /** 思考全文 */
  text: string;
}

/** 滚动整理: 行数超上限时重写成"最后 MAX_LINES 条" */
function compact(path: string): void {
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '');
    if (lines.length <= MAX_LINES) return;
    writeFileSync(path, `${lines.slice(-MAX_LINES).join('\n')}\n`, 'utf8');
  } catch { /* 整理失败不影响主流程 */ }
}

/**
 * 留一条思考。
 *
 * 只写文件, 不做任何判定 —— 调用方(出站路由)在**任何模式**下都该照记(包括 silent 潜水),
 * 因为"照常思考"本来就是 silent 的定义。
 */
export function noteThinking(dataRoot: string, entry: ThinkingEntry): void {
  try {
    const raw = String(entry.text ?? '');
    if (raw.trim() === '') return;

    const dir = join(dataRoot, '.qqbot');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'thinking-log.jsonl');

    const rec = {
      ts: Date.now(),
      scope: entry.scope,
      peer: entry.peerId,
      turn: entry.turn,
      step: entry.step,
      chars: raw.length,
      tokens: entry.tokens,
      text: raw.replace(/\r/g, '').slice(0, MAX_TEXT_CHARS),
    };
    appendFileSync(path, `${JSON.stringify(rec)}\n`, 'utf8');

    if (++sinceCompact >= COMPACT_EVERY) {
      sinceCompact = 0;
      compact(path);
    }
  } catch { /* 留档失败绝不影响回复主流程 */ }
}
