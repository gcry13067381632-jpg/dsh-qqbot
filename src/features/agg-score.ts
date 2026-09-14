/**
 * agg-score.ts — 聚合窗口的「综合评分」（2026-09-14 主人定：加权平均）
 *
 * 背景：消息聚合 / 冷却批派发时，一个窗口里会攒着好几条不同人说的话
 *   （`mwState.history` + 当前那条）。旧口径是**取最高分那条**。
 *
 * 旧口径的两个毛病：
 *   ① 一句话能钓走整轮 —— 4 条闲聊 + 1 条高分，眼里就只剩那条；
 *   ② 计分的那条和归因的那条常常不是同一个发言人 ——
 *      当天实测把「大肥鱼怎么不插话了」（路人甲说的）算到「愤怒的小鸟」头上，还扣了他 0.12。
 *
 * 新口径：**每条先算自己的有效分**（价值分 + 它自己那个人的好感偏移），
 *   再按「价值越高 / 好感越高 / 被点名」加权求平均：
 *
 *     权     = max(0.01, 价值分) × clamp(1 + 好感占比, 0.2, 2) × (被点名 ? 2 : 1)
 *     综合分 = Σ(权 × 有效分) / Σ(权)
 *
 *   · 高分那条**仍然主导**（它的权平方级大），但不再独占；
 *   · 好感高的群友说话分量重（占比 +1 → ×2，占比 −1 → ×0.2，不会被抹成 0）；
 *   · 被点名 ×2 —— 点名是明确的"我要你答"，不该被平均值稀释掉。
 *
 * ⚠️ **归属不跟着平均值走**：综合分只决定"要不要理"，
 *   "该记在谁头上"取**权重最大的那条（主角）** —— 否则会平均出一个不存在的人。
 *
 * 回滚：把调用方的 `AGG_SCORE_MODE` 改回 `'max'`（本文件的纯函数留着不碍事）。
 */

/** 聚合窗口综合评分的口径开关（放在这里，和算法一起回滚） */
export const AGG_SCORE_MODE: 'max' | 'weighted' = 'weighted';
/** 被点名的消息额外分量 */
export const AGG_MENTION_BOOST = 2;
/** 好感度权重上下限：好感占比 −1~+1 映射到 0.2~2 */
export const AGG_ATT_MIN = 0.2;
export const AGG_ATT_MAX = 2;

export interface AggCandidate {
  /** 这条消息的文本（已清洗） */
  text: string;
  /** 价值分（0~1，本地小模型给的） */
  score: number;
  /** 说话人的好感占比（−1~+1，0 = 中立/新人） */
  ratio: number;
  /** 说话人的好感偏移（加在分数上的那点，±0.10） */
  offset: number;
  /** 是否被点名（@ 了她） */
  mention?: boolean;
  /** 昵称（只用于日志明细） */
  name?: string;
  /** 好感档位（只用于日志） */
  tier?: string;
}

export interface AggPart {
  /** 昵称 */
  n: string;
  /** 价值分 */
  s: number;
  /** 好感占比 */
  r: number;
  /** 权重 */
  w: number;
}

export interface AggResult {
  /** 综合分（已含各条自己的好感偏移）—— 判定"要不要理"用的就是它 */
  score: number;
  /** 明细，进日志（事后能照着复算一遍） */
  parts: AggPart[];
  /** 主角下标（权重最大的那条）—— 归因（熟识度/好感度/语气）跟着它 */
  topIndex: number;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/**
 * 加权平均。空池 / 全零权 → undefined（调用方回退到单条口径）。
 * 纯函数：没有 IO、没有随机，方便单测（见 agg-score.test.ts）。
 */
export function weightedAggregate(pool: ReadonlyArray<AggCandidate>): AggResult | undefined {
  if (pool.length === 0) return undefined;
  let sumW = 0;
  let sumWS = 0;
  let topW = -1;
  let topIndex = 0;
  const parts: AggPart[] = [];
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i]!;
    const attW = Math.max(AGG_ATT_MIN, Math.min(AGG_ATT_MAX, 1 + p.ratio));
    const w = Math.max(0.01, p.score) * attW * (p.mention === true ? AGG_MENTION_BOOST : 1);
    sumW += w;
    sumWS += w * (p.score + p.offset);
    parts.push({ n: p.name || `#${i + 1}`, s: round3(p.score), r: round3(p.ratio), w: round3(w) });
    if (w > topW) {
      topW = w;
      topIndex = i;
    }
  }
  if (sumW <= 0) return undefined;
  return { score: sumWS / sumW, parts, topIndex };
}
