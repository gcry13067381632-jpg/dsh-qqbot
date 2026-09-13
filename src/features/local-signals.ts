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
  /** 记忆强度 0~1（2026-09-13 主人定：按记忆曲线遗忘；每次互动=一次复习 → 回满） */
  strength?: number;
  /** 复习次数（= 有效互动次数; 用来抬高遗忘下限、拉长遗忘时间常数） */
  reviews?: number;
  /** 上次复习（= 上次互动）时间戳 */
  lastReview?: number;
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
    // 记忆曲线(2026-09-13 主人定): 每次互动算一次**复习** → 强度回满, 复习次数 +1
    cur.reviews = (cur.reviews ?? 0) + 1;
    cur.strength = 1;
    cur.lastReview = now;
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
 *
 * ⚠️ 2026-09-13 修(群友"亚瑟"读码抓到): 互动分原用 20×log10(1+msgs)/log10(101) 是**发散**的
 *   (实测 msgs=1000 → 29.9 分、10 万 → 49.9 分、10 亿 → 89.8 分; 注释写"100 条≈20 分"容易被当成上限)。
 *   现改**饱和式**(希尔/米氏形式): 20×msgs/(msgs+40) —— **40 条 = 拿一半分, 上限 20**, 刷不出高分。
 */
/**
 * 记忆强度（0~1）—— 2026-09-13 主人定：**按记忆曲线遗忘**，不是"只升不降"的功劳榜。
 *
 * 模型（艾宾浩斯式）：
 *   S = floor + (1 - floor) × exp(-Δt / τ)
 *   · τ（遗忘时间常数）随**复习次数**拉长 —— 这是"间隔效应"：越熟忘得越慢
 *        τ = 2 天 × (1 + reviews/20)      （复习 20 次 ≈ 4 天一半，复习 100 次 ≈ 12 天一半）
 *   · floor（**遗忘下限**）随复习次数**抬高** —— 主人要求"下限可以不断抬高"：
 *        floor = min(0.6, 0.15 × log10(1 + reviews))   （老熟人久别重逢也不会掉回陌生）
 *   · 每次互动 = 一次复习 → S 回满 1
 *
 * ⚠️ 只做**遗忘**，不做惩罚：分数不会因为"说错话"被扣。
 *    "降低好感度"是另一套机制（负面事件），暂不实现（主人 2026-09-13 明确区分）。
 */
export function memoryStrength(e: AffinityEntry, now = Date.now()): number {
  const reviews = Math.max(0, e.reviews ?? e.msgs ?? 0);
  const lastReview = e.lastReview ?? e.lastAt ?? now;
  const floor = Math.min(0.6, 0.15 * Math.log10(1 + reviews));
  const tauDays = 2 * (1 + reviews / 20);
  const dtDays = Math.max(0, (now - lastReview) / 86400_000);
  const s = floor + (1 - floor) * Math.exp(-dtDays / tauDays);
  return Math.max(0, Math.min(1, s));
}

/** 档位（滞回：进档门槛高于退档，防止抖动） */
export function memoryTier(strength: number, prevTier?: string): '陌生人' | '眼熟' | '熟人' {
  const enterHot = 0.7;
  const keepHot = 0.55;
  const enterWarm = 0.4;
  const keepWarm = 0.28;
  if (prevTier === '熟人') return strength >= keepHot ? '熟人' : strength >= keepWarm ? '眼熟' : '陌生人';
  if (prevTier === '眼熟') return strength >= enterHot ? '熟人' : strength >= keepWarm ? '眼熟' : '陌生人';
  return strength >= enterHot ? '熟人' : strength >= enterWarm ? '眼熟' : '陌生人';
}

/** 0~100 分（= 记忆强度 × 100；面板与排序沿用它，语义已从"功劳榜"改为"记忆强度"） */
export function affinityScore(e: AffinityEntry, now = Date.now()): number {
  return Math.round(memoryStrength(e, now) * 100);
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
