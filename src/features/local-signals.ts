/**
 * local-signals.ts — 本地小模型算出来的两类"软信号"（2026-09-13 主人定, **观察期只记录不生效**）
 *
 * ① **相关度 (relevance)** —— 给价值闸门补上"当下语境"这一维:
 *      · `relReply` = 当前消息 ↔ **她上一条发言** 的余弦（高 = 有人在接她的话）
 *      · `relHist`  = 当前消息 ↔ 群里最近 5 条 的**最大**余弦（高 = 正接着群里的话题）
 *      现在的样例库分只看"这句话像不像该回", 不看语境 —— 于是"测试"这类闲聊能被抬到 0.738。
 *      ⚠️ 只记录进 `value-scores.jsonl`(relReply/relHist/final), **不参与判定** ——
 *      先跑一两天看分布, 再决定权重与阈值(与"log → block"同一套路)。
 *
 * ② **好感度 (affinity)** —— 每人一条台账, 记「互动 / 被点名 / 接话」三项客观计数,
 *      熟度分数**读的时候现算**(公式透明可解释), 同样**只统计不生效**。
 *      存储: `{dataRoot}/.qqbot/affinity.json`
 *
 * 全部本机嵌入, **零 token、不上传**。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLocalEmbedder } from './local-embed.js';
import { lastBotReplyOf } from './bot-reply-memo.js';
import type { Logger } from '../types.js';

// ─────────────────────────── ① 相关度 ───────────────────────────

export interface RelResult {
  /** 当前消息 ↔ 她上一条发言 的余弦(0~1) */
  relReply?: number;
  /** 当前消息 ↔ 群里最近 5 条 的最大余弦(0~1) */
  relHist?: number;
}

/** 历史条目向量缓存(同一条消息只嵌一次): key = `${gid}|${messageId}` */
const embCache = new Map<string, number[]>();
const EMB_CACHE_MAX = 300;

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * 算相关度。模型不可用/文本为空 → undefined（调用方照常记录其它字段）。
 * @param history 群历史缓冲（`mwState.history`），只取最后 5 条有效文本
 */
export async function computeRelevance(opts: {
  gid: string;
  currentText: string;
  history: Array<{ messageId?: string; content?: string }> | undefined;
  modelDir?: string;
  logger?: Logger;
}): Promise<RelResult | undefined> {
  const cur = String(opts.currentText || '').trim();
  if (!cur || !opts.gid) return undefined;
  try {
    const embedder = createLocalEmbedder({ modelDir: opts.modelDir, logger: opts.logger });
    if (!embedder.available()) return undefined;
    const qv = await embedder.embedQuery(cur);
    if (!qv || qv.length === 0) return undefined;

    const out: RelResult = {};

    // ① 她上一条发言
    const last = lastBotReplyOf(opts.gid);
    if (last?.text) {
      const v = await embedder.embedPassages([last.text]);
      if (v?.[0]) out.relReply = round3(cosine(qv, v[0]));
    }

    // ② 群里最近 5 条(带缓存: 同一条消息不重复嵌)
    const recent = (opts.history ?? [])
      .map((h) => ({ id: String(h.messageId || ''), text: String(h.content || '').trim() }))
      .filter((h) => h.text)
      .slice(-5);
    if (recent.length > 0) {
      const miss: string[] = [];
      for (const h of recent) {
        const key = `${opts.gid}|${h.id || h.text.slice(0, 40)}`;
        if (!embCache.has(key)) miss.push(h.text);
      }
      if (miss.length > 0) {
        const vecs = await embedder.embedPassages(miss);
        if (vecs) {
          let mi = 0;
          for (const h of recent) {
            const key = `${opts.gid}|${h.id || h.text.slice(0, 40)}`;
            if (embCache.has(key)) continue;
            const v = vecs[mi];
            mi += 1;
            if (v) {
              embCache.set(key, v);
              if (embCache.size > EMB_CACHE_MAX) {
                const first = embCache.keys().next().value;
                if (first) embCache.delete(first);
              }
            }
          }
        }
      }
      let best = -1;
      for (const h of recent) {
        const v = embCache.get(`${opts.gid}|${h.id || h.text.slice(0, 40)}`);
        if (!v) continue;
        const c = cosine(qv, v);
        if (c > best) best = c;
      }
      if (best >= 0) out.relHist = round3(best);
    }
    return out;
  } catch (err) {
    opts.logger?.debug(`[相关度] 计算失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

// ─────────────────────────── ② 好感度 ───────────────────────────

export interface AffinityEntry {
  /** 最近一次看到的昵称 */
  name?: string;
  /** 消息数 */
  msgs: number;
  /** 被 @ 次数 */
  mentions: number;
  /** "接她的话"次数(相关度 ≥ 0.6 视为在接话) */
  replies: number;
  firstAt: number;
  lastAt: number;
}

interface AffinityFile {
  /** key = `${scope}:${peerId}` → 台账 */
  map: Record<string, AffinityEntry>;
}

const affCache = new Map<string, AffinityFile>();

function affPath(dataRoot: string): string {
  return join(dataRoot, '.qqbot', 'affinity.json');
}

function loadAff(dataRoot: string): AffinityFile {
  const hit = affCache.get(dataRoot);
  if (hit) return hit;
  let data: AffinityFile = { map: {} };
  try {
    const raw = JSON.parse(readFileSync(affPath(dataRoot), 'utf8')) as AffinityFile;
    if (raw && typeof raw === 'object' && raw.map && typeof raw.map === 'object') data = { map: raw.map };
  } catch { /* 首次/损坏 → 空台账 */ }
  affCache.set(dataRoot, data);
  return data;
}

function saveAff(dataRoot: string, data: AffinityFile): void {
  try {
    const p = affPath(dataRoot);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(data, null, 1), 'utf8');
  } catch { /* 记不上不影响主链 */ }
}

/** 记一次互动（每条群消息调一次; 只统计, 不生效） */
export function touchAffinity(
  dataRoot: string,
  key: string,
  opts: { name?: string; mention?: boolean; reply?: boolean } = {},
): void {
  if (!dataRoot || !key) return;
  try {
    const data = loadAff(dataRoot);
    const now = Date.now();
    const cur: AffinityEntry = data.map[key] ?? { msgs: 0, mentions: 0, replies: 0, firstAt: now, lastAt: now };
    cur.msgs += 1;
    if (opts.mention) cur.mentions += 1;
    if (opts.reply) cur.replies += 1;
    if (opts.name) cur.name = String(opts.name).slice(0, 40);
    cur.lastAt = now;
    data.map[key] = cur;
    saveAff(dataRoot, data);
  } catch { /* ignore */ }
}

/**
 * 熟度分数(0~100) —— 读的时候现算, 公式保持透明可解释:
 *   互动分 = 20×log10(1+msgs)/log10(101)   (100 条 ≈ 20 分)
 *   点名分 = min(20, mentions×2)
 *   接话分 = min(30, replies×3)
 *   新鲜度 = 1 小时内 +10 / 1 天内 +5 / 更久 0
 */
export function affinityScore(e: AffinityEntry, now = Date.now()): number {
  const msgs = 20 * (Math.log10(1 + e.msgs) / Math.log10(101));
  const mentions = Math.min(20, e.mentions * 2);
  const replies = Math.min(30, e.replies * 3);
  const age = now - e.lastAt;
  const fresh = age < 3600_000 ? 10 : age < 86400_000 ? 5 : 0;
  return Math.round(Math.min(100, msgs + mentions + replies + fresh));
}

/** 按熟度排序（面板/工具用） */
export function topAffinity(
  dataRoot: string,
  limit = 10,
): Array<{ key: string; name?: string; score: number; msgs: number; mentions: number; replies: number; lastAt: number }> {
  const data = loadAff(dataRoot);
  const now = Date.now();
  return Object.entries(data.map)
    .map(([key, e]) => ({ key, name: e.name, score: affinityScore(e, now), msgs: e.msgs, mentions: e.mentions, replies: e.replies, lastAt: e.lastAt }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
