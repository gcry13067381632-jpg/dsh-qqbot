/**
 * value-score.ts — 群聊价值评分(本地小模型 KNN, 2026-09-13 主人定)
 *
 * 目的(零 token): 判断"这条群消息值不值得唤醒 AI 开口"。
 * 方法(实测 90~100%): 样例近邻加权投票(KNN) —— 而非"描述句 zero-shot"(实测仅 65%, 分数全挤在 0.5 附近)。
 * 三种模式(config.localModel.valueGate):
 *   off   = 不评分(省 CPU)
 *   log   = 只记录分数(默认, 观察期: 不改变任何行为)
 *   block = 低分不唤醒 AI(消息仍 append 进上下文, 不丢)
 */
import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Logger } from '../types.js';
import { createLocalEmbedder } from './local-embed.js';
import { loadValueSamples, valueSamplesPath, type ValueSample } from './value-sample.js';

/** 近邻数(实测 k=5 及加权版在独立测试集上 10/10) */
const K = 5;
/** 相似度加权指数: 把近邻的相似度差距拉开(实测区分度更好) */
const WEIGHT_POW = 8;

export interface ScoreNeighbor {
  m: string;
  y: 0 | 1;
  s: number;
}

export interface ScoreResult {
  /** 0~1: 近邻加权投票中"值得回应"的占比 */
  score: number;
  /** score >= minScore */
  worth: boolean;
  /** 最近邻居的最高相似度(0~1): 越低说明"地图上没有同类样本", 判断越不可靠 */
  confidence: number;
  /** 低置信(confidence < 0.5): 新话题/没见过的类型 —— block 模式下**不应据此拦截**(宁可多花 token 也别漏) */
  lowConfidence: boolean;
  /** top3 近邻(排查/解释用) */
  top: ScoreNeighbor[];
}

export interface ValueScorer {
  /** 打分; 不可用/失败 → undefined(调用方按"未知"处理, 不拦截) */
  score(text: string): Promise<ScoreResult | undefined>;
  /** 样例向量是否已就绪 */
  ready(): boolean;
  /** 后台预热(加载模型 + 预计算样例向量), 不阻塞 */
  warmup(): void;
}

const scorers = new Map<string, ValueScorer>();

/** 取值分器(同参数单例复用: 模型与样例向量只算一次) */
export function createValueScorer(opts: {
  dataRoot: string;
  modelDir?: string;
  minScore?: number;
  logger?: Logger;
}): ValueScorer {
  const cacheKey = `${opts.dataRoot}|${opts.modelDir ?? ''}|${opts.minScore ?? ''}`;
  const cached = scorers.get(cacheKey);
  if (cached) return cached;

  const minScore = typeof opts.minScore === 'number' ? opts.minScore : 0.5;
  const embedder = createLocalEmbedder({ modelDir: opts.modelDir, logger: opts.logger });
  let samples: ValueSample[] = [];
  let vecs: number[][] = [];
  let initing: Promise<boolean> | undefined;
  let inited = false;
  /** 已加载样例文件的 mtime(0=文件不存在, 用内置默认) —— 变化时自动重载: 改样例无需重启/无需改代码 */
  let loadedMtime = -1;

  function samplesMtime(): number {
    try { return statSync(valueSamplesPath(opts.dataRoot)).mtimeMs; } catch { return 0; }
  }

  async function init(): Promise<boolean> {
    const mt = samplesMtime();
    if (inited && mt === loadedMtime) return true;   // 样例未变 → 用缓存
    if (initing) return initing;
    initing = (async (): Promise<boolean> => {
      try {
        samples = loadValueSamples(opts.dataRoot);
        if (samples.length === 0) return false;
        const v = await embedder.embedPassages(samples.map((s) => s.m));
        if (!v || v.length !== samples.length) return false;
        vecs = v;
        inited = true;
        loadedMtime = mt;
        opts.logger?.info(`[im-qqbot] 价值评分就绪: ${samples.length} 条样例`);
        return true;
      } catch (e) {
        opts.logger?.warn(`[im-qqbot] 价值评分初始化失败: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      } finally {
        initing = undefined;
      }
    })();
    return initing;
  }

  function dot(a: number[], b: number[]): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
    return s;
  }

  const scorer: ValueScorer = {
    ready: () => inited,
    warmup: () => { void init(); },
    async score(text: string): Promise<ScoreResult | undefined> {
      const t = String(text || '').trim();
      if (!t) return undefined;
      if (!(await init())) return undefined;
      const qv = await embedder.embedQuery(t);
      if (!qv) return undefined;
      const scored: ScoreNeighbor[] = samples
        .map((s, i) => ({ m: s.m, y: s.y, s: dot(qv, vecs[i] ?? []) }))
        .sort((a, b) => b.s - a.s);
      const top = scored.slice(0, K);
      let w1 = 0;
      let w0 = 0;
      for (const n of top) {
        const w = Math.max(0, n.s) ** WEIGHT_POW;
        if (n.y === 1) w1 += w;
        else w0 += w;
      }
      const total = w1 + w0;
      const score = total > 0 ? w1 / total : 0;
      // 置信度 = 最近邻居的相似度(低于 0.5 视为"地图上没这类样本", 判断不可靠)
      const confidence = top[0]?.s ?? 0;
      return { score, worth: score >= minScore, confidence, lowConfidence: confidence < 0.5, top: top.slice(0, 3) };
    },
  };
  scorers.set(cacheKey, scorer);
  return scorer;
}

/** 追加一条评分记录(观察期用): {dataRoot}/.qqbot/value-scores.jsonl —— 一行一条, 可直接翻 */
export function appendScoreLog(dataRoot: string, rec: Record<string, unknown>): void {
  try {
    const p = join(dataRoot, '.qqbot', 'value-scores.jsonl');
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, `${JSON.stringify({ ts: Date.now(), ...rec })}\n`, 'utf8');
  } catch { /* 记录失败不影响主流程 */ }
}
