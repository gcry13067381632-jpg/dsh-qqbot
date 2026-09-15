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
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLocalEmbedder } from './local-embed.js';
import { lastBotReplyOf } from './bot-reply-memo.js';
import { EMO_LABELS, EMO_SAMPLES, type EmoLabel } from './emo-samples.js';
import { TENDENCY_LABELS, TENDENCY_SAMPLES, type TendencyLabel } from './tendency-samples.js';
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
  /** 上次复习的**日期**(YYYY-MM-DD): 同一天多次互动只算一次复习（2026-09-13 主人定: 每天就几次复习） */
  lastReviewDay?: string;
}

interface AffinityFile {
  /** key = `${scope}:${peerId}` → 台账 */
  map: Record<string, AffinityEntry>;
}

const affCache = new Map<string, { file: AffinityFile; mtime: number }>();

function affPath(dataRoot: string): string {
  return join(dataRoot, '.qqbot', 'affinity.json');
}

function loadAff(dataRoot: string): AffinityFile {
  // ⚠️ 2026-09-14：缓存要认 mtime —— 文件被外部改了（手工调数据/换工具改）就重读，
  //   否则运行中的进程一直用旧值（上午踩过：清了旧键，旧键又被缓存写回"复活"）。
  let mtime = 0;
  try { mtime = statSync(affPath(dataRoot)).mtimeMs; } catch { mtime = 0; }
  const hit = affCache.get(dataRoot);
  if (hit && mtime !== 0 && hit.mtime === mtime) return hit.file;
  let data: AffinityFile = { map: {} };
  try {
    const raw = JSON.parse(readFileSync(affPath(dataRoot), 'utf8')) as AffinityFile;
    if (raw && typeof raw === 'object' && raw.map && typeof raw.map === 'object') {
      // 2026-09-14 迁移：**只认"按人"键（person:）**。
      //   旧版曾按「群」记（一整个群算成一个人，名字取最后一个发言人）→ 面板上同一个人会显示好几次
      //   （实测同一个人出现 3 次：person: + 两代 group: 键并存）。
      //   在这里丢弃旧格式键：读进来就干净；下一次 saveAff 会把文件一并写干净 —— 不用手工清文件
      //   （手工清没用：进程内存里的缓存会随后把旧键写回去）。
      const map: Record<string, AffinityEntry> = {};
      for (const [k, v] of Object.entries(raw.map)) {
        if (k.startsWith('person:')) map[k] = v as AffinityEntry;
      }
      data = { map };
    }
  } catch { /* 首次/损坏 → 空台账 */ }
  affCache.set(dataRoot, { file: data, mtime });
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
    // 记忆曲线(2026-09-13 主人定; 经主人两次纠正后定稿):
    //   **复习 = 当天第一次出现**(一天最多算一次) —— 刷屏不会多算, 复习次数≈"来过几天"。
    //   强度每次互动都回满(衰减从最后一次互动算起); 曲线本体在 memoryStrength() 里。
    // ⚠️ 2026-09-14 修：原来用 `toISOString()` = **UTC 日期** —— 北京时间早上 8 点前仍算"昨天"，
    //   于是"今天来过没有"会在早上 8 点整莫名翻页（同一天被切成两段 → reviews 虚高/漏算）。
    //   改成**本地日期**（YYYY-MM-DD）。
    const day = localDayKey(now);
    if ((cur.lastReviewDay ?? '') !== day) {
      cur.reviews = (cur.reviews ?? 0) + 1;
      cur.lastReviewDay = day;
    }
    cur.strength = 1; // 刚有互动 → 强度回满
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
 * 模型（艾宾浩斯式；**公式以下方代码为准**，这里只讲形状，免得注释又比代码旧）：
 *   S = floor + max(top - floor, 0) × exp(-Δt / τ)
 *   · top （熟悉度上限）：以"来过天数"为主、被点名/接话为辅，对数饱和（刷屏涨不动）
 *   · floor（遗忘下限）：随复习次数抬高（上限 0.6）—— 老熟人久别重逢也掉不回陌生
 *   · τ  （遗忘时间常数）：随复习次数拉长 —— 间隔效应，越熟忘得越慢
 *   · Δt：距**上次复习**（上次互动）的天数；每次互动 = 一次复习 → 强度回满
 *
 * ⚠️ 只做**遗忘**，不做惩罚：分数不会因为"说错话"被扣。
 *    "降低好感度"是另一套机制（负面事件），暂不实现（主人 2026-09-13 明确区分）。
 * ⚠️ 2026-09-13：这段注释曾抄着**旧版公式**（τ=2天×(1+reviews/20)、fam 系数 0.40）与代码不符，
 *    现改为只描述形状；具体系数与定标过程见 memoryStrength 函数体。
 */
/**
 * 有效"来过天数"(算分与显示共用同一口径, 2026-09-13 修):
 *   · 老台账没有 lastReviewDay → 按认识天数估
 *   · **硬约束: 来过天数不可能超过认识天数**(发 85 条也不等于来过 85 天)
 */
/** 本地日期键（YYYY-MM-DD）—— 别用 `toISOString()`：那是 UTC，北京时间早 8 点会莫名翻页 */
function localDayKey(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 本地"自然日序号"（同一天相同；用来数"跨了几个自然日"） */
function localDayIndex(ts: number): number {
  const d = new Date(ts);
  return Math.floor((ts - d.getTimezoneOffset() * 60_000) / 86400_000);
}

export function effectiveReviews(e: AffinityEntry, now = Date.now()): number {
  // ⚠️ 2026-09-14 修（主人问"我应该算来过两天了吧"）：
  //   原来 daysKnown 按 **24 小时整倍** 算（floor(Δt/86400_000)+1）—— 昨晚 20:47 首次来、
  //   今早 08:50 再来，明明跨了两个自然日，却只算 1 天 → reviews=2 被硬约束压回 1，
  //   面板就显示"来过 1 天"。改成按**自然日**算。
  const daysKnown = Math.max(1, localDayIndex(now) - localDayIndex(e.firstAt ?? now) + 1);
  const raw = e.lastReviewDay ? (e.reviews ?? 1) : Math.min(e.msgs ?? 1, daysKnown);
  return Math.max(1, Math.min(raw, daysKnown));
}

export function memoryStrength(e: AffinityEntry, now = Date.now()): number {
  // ⚠️ 2026-09-13 修(主人:"怎么来过涨这么多, 我们才写插件没多久"):
  //   原来拿 msgs 当复习次数兜底 → 发 85 条就显示"来过 85 天"(认识才一天, 物理不可能)。
  //   现在加**硬约束: 来过天数不可能超过认识天数**; 老台账(没有 lastReviewDay 字段)按认识天数估算。
  const reviews = effectiveReviews(e, now);
  const lastReview = e.lastReview ?? e.lastAt ?? now;
  // ⚠️ 2026-09-13 修(主人实测"怎么全是 100"): 原来"刚聊过 = 强度 1 = 满分", 人人 100 没区分度。
  //   现在分两层: **熟悉度 fam**(累积决定上限) + **遗忘**(时间衰减, 下限随复习抬高)。
  //     fam   = min(1, 0.40×log10(1+reviews) + 0.10)   1 天≈0.22 / 7 天≈0.46(眼熟) / 45 天≈0.77(熟人) / 100 天≈0.90
  //     floor = min(0.6, 0.15×log10(1+reviews))        复习越多, 忘到底也留得越多(老熟人不回陌生)
  //     τ     = 2 天 ×(1 + reviews/20)                  间隔效应: 越熟忘得越慢
  //   S = floor + (fam - floor) × exp(-Δt/τ)  —— 刚聊完≈fam(新人就是低), 久不聊沉到 floor
  // ⚠️ 2026-09-13 主人定标:「45 天熟人就够了」—— 系数按此校准(来过 45 天 ≈ 0.77 → 过 0.7 门槛)
  //    来过 1 天≈0.22(陌生) / 7 天≈0.46(眼熟) / 45 天≈0.77(熟人) / 100 天≈0.90
  // ⚠️ 2026-09-13 主人两次校准后定稿("说一句话不可能就有 22% 熟识" + "45 天熟人就够了"):
  //   来过天数为主 + 被点名/接话为辅(质量信号), 基础 0.02 ——
  //     新人 1 天说 1 句 ≈ 0.09; 7 天 ≈ 0.27; 45 天 ≈ 0.52; 45 天+常被点名接话 → 0.70+(熟人); 100 天 ≈ 0.63
  const fam = Math.min(1,
    0.28 * Math.log10(1 + reviews)
    + 0.15 * Math.log10(1 + Math.max(0, e.mentions ?? 0))
    + 0.15 * Math.log10(1 + Math.max(0, e.replies ?? 0))
    + 0.02);
  const floor = Math.min(0.6, 0.15 * Math.log10(1 + reviews));
  const top = Math.max(fam, floor);
  const tauDays = 3 * (1 + reviews / 10); // 来过 10 天 → 时间常数 6 天; 来过 50 天 → 18 天
  const dtDays = Math.max(0, (now - lastReview) / 86400_000);
  const s = floor + (top - floor) * Math.exp(-dtDays / tauDays);
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

/** 取某人的台账条目（好感度聚合要用它的熟识度算阻尼与范围） */
export function getAffinityEntry(dataRoot: string, key: string): AffinityEntry | undefined {
  return loadAff(dataRoot).map[key];
}

/** 按熟度排序（面板/工具用） */
export function topAffinity(
  dataRoot: string,
  limit = 10,
): Array<{ key: string; name?: string; score: number; tier: string; reviews: number; msgs: number; mentions: number; replies: number; lastAt: number }> {
  const data = loadAff(dataRoot);
  const now = Date.now();
  return Object.entries(data.map)
    .map(([key, e]) => ({ key, name: e.name, score: affinityScore(e, now), tier: memoryTier(memoryStrength(e, now)), reviews: effectiveReviews(e, now), msgs: e.msgs, mentions: e.mentions, replies: e.replies, lastAt: e.lastAt }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ─────────── ③ 情绪粗分类（夸 / 骂 / 中性, 2026-09-13 主人给的例句库） ───────────
/**
 * 用**同一个本地小模型**判"这句话是夸、骂还是中性":
 *   把三组例句各嵌一次(缓存), 新文本嵌入后跟每组求平均相似度, 取最高的那组。
 * ⚠️ 只做**弱信号**: 反讽/互怼/引用会误判 → 观察期只记录, 不参与行为。
 */
/**
 * 判定打分方式（2026-09-14 主人要求"重新添加样本测试一下"之后的实测结论）。
 *
 *   · `centroid` = 每组例句取**平均向量**（原做法）
 *   · `knn`      = 每组取**最相似的 K 条**，平均相似度（现做法）
 *
 * 为什么换：质心会把一组的几十条例句揉成"平均意思"，样本越杂越糊 ——
 *   实测把"没点名我，静默"判成「拒绝」、把 141 字热情卖萌正文判成「冷」、
 *   把工具参数里的「…需回应」判成「拒绝」（这三条都在 m1/eval 里钉成回归样本）。
 *   kNN 不做平均，直接看"这句话最像组里的哪几句"，边界句不再被离群样本拖走。
 *
 * 回滚：把它改回 `'centroid'` 即可（其余代码一行不用动）。
 * 复跑：`node m1/judge-eval.mjs --kind tendency|emo`（改样本/改门槛后都跑一遍）。
 */
export const CLASSIFY_SCORE_MODE: 'knn' | 'centroid' = 'knn';
/** 每类取最相似的 K 条平均（k=3：覆盖同类不同说法，又不至于被单个离群样本带跑） */
const KNN_K = 3;

const emoCentroidCache = new Map<string, { vecs: number[][] }>();
/** 倾向例库的向量缓存 —— ⚠️ 键必须带语言前缀(zh/en 两套库, 不能混) */
const tendencyCentroidCache = new Map<string, { vecs: number[][] }>();

export interface EmoResult {
  label: EmoLabel;
  /** 最高组得分 */
  best: number;
  /** 与第二名的差(越大越有把握) */
  margin: number;
  /** 三组原始得分, 便于观察 */
  scores: Record<string, number>;
}

/**
 * 通用「例句库」打分（模式见 CLASSIFY_SCORE_MODE）。
 * 每组例句各嵌一次并**全部缓存**（knn 模式需要原向量，不能只存质心），文本嵌入后与每组比。
 * 返回每组得分; 模型不可用或嵌入失败 → undefined。
 * ⚠️ 缓存键必须带前缀/语言(emo 一套, ten:zh / ten:en 各一套), 否则向量会互相污染。
 */
async function centroidScores(
  text: string,
  groups: ReadonlyArray<{ label: string; samples: readonly string[] }>,
  cache: Map<string, { vecs: number[][] }>,
  cachePrefix: string,
  opts: { modelDir?: string; logger?: Logger },
): Promise<Record<string, number> | undefined> {
  try {
    const embedder = createLocalEmbedder({ modelDir: opts.modelDir, logger: opts.logger });
    if (!embedder.available()) return undefined;
    const qv = await embedder.embedQuery(text);
    if (!qv || qv.length === 0) return undefined;
    const scores: Record<string, number> = {};
    for (const { label, samples } of groups) {
      const key = `${cachePrefix}:${label}`;
      let c = cache.get(key);
      if (!c) {
        const vs = await embedder.embedPassages([...samples]);
        if (!vs || vs.length === 0) continue;
        c = { vecs: vs.map((v) => [...v]) };
        cache.set(key, c);
      }
      if (c.vecs.length === 0) continue;
      if (CLASSIFY_SCORE_MODE === 'knn') {
        // 每类取最像的 K 条平均 —— 边界句能靠"最像的那一句"救回来
        const sims = c.vecs
          .map((v) => cosine(qv, v))
          .sort((a, b) => b - a)
          .slice(0, KNN_K);
        scores[label] = sims.reduce((a, b) => a + b, 0) / sims.length;
      } else {
        const dim = c.vecs[0]!.length;
        const vec = new Array<number>(dim).fill(0);
        for (const v of c.vecs) for (let i = 0; i < dim; i++) vec[i] = (vec[i] ?? 0) + (v[i] ?? 0) / c.vecs.length;
        scores[label] = cosine(qv, vec);
      }
    }
    return Object.keys(scores).length > 0 ? scores : undefined;
  } catch (err) {
    opts.logger?.debug(`[例句打分] 失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** 取最高组 + 与第二名的差(统一三位小数, 便于事后核对) */
function rankOf(scores: Record<string, number>): { label: string; best: number; margin: number } | undefined {
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const best = ranked[0];
  if (best === undefined) return undefined;
  const second = ranked[1];
  return { label: best[0], best: round3(best[1]), margin: round3(best[1] - (second ? second[1] : 0)) };
}

export async function classifyEmo(
  text: string,
  opts: { modelDir?: string; logger?: Logger } = {},
): Promise<EmoResult | undefined> {
  const s = String(text || '').trim();
  if (!s) return undefined;
  const groups = EMO_LABELS.map((l) => ({ label: String(l), samples: EMO_SAMPLES[l] }));
  const scores = await centroidScores(s, groups, emoCentroidCache, 'emo', opts);
  if (scores === undefined) return undefined;
  const top = rankOf(scores);
  if (top === undefined) return undefined;
  return { label: top.label as EmoLabel, best: top.best, margin: top.margin, scores };
}

// ─────────── ④ 倾向粗分类（亲近 / 拒绝 / 任务 —— 判的是"她自己"） ───────────
/**
 * 用途(设计稿 §11): **语言情绪库判对方, 倾向库判她自己** ——
 *   她对某个人的态度不长在情绪词上, 而藏在**选择**里(接不接梗、给不给台阶、愿不愿多花力气),
 *   所以拿 `tendency-samples.ts` 的亲近/拒绝/任务三组例句做质心比对。
 *
 * ⚠️ 语言必须对得上: 中文思考配 zh 库、英文配 en 库; **中英混杂跳过不判**(跨语言比不了, 宁可空着)。
 * ⚠️ 弱信号: 观察期只记录, 不参与行为; 绝不用它冷落谁。
 */
export interface TendencyResult {
  label: TendencyLabel;
  best: number;
  margin: number;
  scores: Record<string, number>;
  /** 判定所用语言(zh / en) */
  lang: 'zh' | 'en';
}

/**
 * 按 CJK 占比判语言: ≥0.6 判中文 / ≤0.25 判英文 / 中间=中英混杂 → undefined(跳过不判)。
 * 只数"汉字"与"拉丁字母", 标点、数字、空格、表情都不参与。
 * 阈值放宽的理由: 她的思考常夹英文术语("先 reply 他"), 只要中文为主仍按中文库判;
 * 真·对半开才跳过 —— 小模型的英文语义质量差, 判了不如空着(设计稿: 不确定就不动分)。
 */
export function detectScript(text: string): 'zh' | 'en' | undefined {
  let cjk = 0;
  let latin = 0;
  for (const ch of String(text || '')) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x4e00 && c <= 0x9fff) cjk += 1;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin += 1;
  }
  const total = cjk + latin;
  if (total < 3) return undefined;
  const r = cjk / total;
  if (r >= 0.6) return 'zh';
  if (r <= 0.25) return 'en';
  return undefined;
}

export async function classifyTendency(
  text: string,
  opts: { modelDir?: string; logger?: Logger } = {},
): Promise<TendencyResult | undefined> {
  const s = String(text || '').trim();
  if (!s) return undefined;
  const lang = detectScript(s);
  if (lang === undefined) return undefined;
  const groups = TENDENCY_LABELS.map((l) => ({ label: String(l), samples: TENDENCY_SAMPLES[l][lang] }));
  // 思考可能上千字, 取前 800 字(判断通常落在开头; 也避开模型 512 token 窗口的尾部丢失)
  const scores = await centroidScores(s.slice(0, 800), groups, tendencyCentroidCache, `ten:${lang}`, opts);
  if (scores === undefined) return undefined;
  const top = rankOf(scores);
  if (top === undefined) return undefined;
  return { label: top.label as TendencyLabel, best: top.best, margin: top.margin, scores, lang };
}
