import type { Logger } from '../types.js';
/**
 * 打分文本的 mention 归一化（2026-09-15 主人实测后加）。
 *
 * 症状：样例带 `@bot …` 前缀、入站文本带 `<@openid> …` →
 *   两者的**最大共同特征**变成"这条 @ 了她"，语义被前缀淹没：
 *   实测「<@xx> 不知道」拿到 **1.00**（近邻全是 `@bot …`：这个bug你修一下 / 继续找 / 大不大），
 *   而它其实只是群里一句"不知道"。
 *
 * 做法：**样例与查询都过这个函数** → 相似度只反映正文；
 *   "是否被点名"改由独立特征承担（gate 的 `!mentioned` 放行、加权里的 AGG_MENTION_BOOST、
 *   以及"@了别人"时的 OTHER_MENTION_PENALTY）。
 */
export declare function stripMentionForScore(raw: string): string;
/**
 * 这条消息 **@ 了别人**（不是她）→ 判定分扣一点。
 *
 * ⚠️ 2026-09-15 主人**修正过一次语义**："不是没人@她的时候降低评分, 是有人@别人的时候降低评分"。
 *   人家第一版做成了"没被 @ 就扣分"——那是错的：**没被 @ 恰恰是她该主动接话的常态**（群里没人点她，她才会自己挑话插），
 *   扣分等于把她变成"等点名才说话"。
 *   真正的信号是"这句话 @ 的是谁"：@ 了别人 = 这轮对话的方向是那个人，她基本不该插嘴。
 *   （@ 的是她自己时走另一条路：`!mentioned` 的拦截豁免 → 必回。）
 *
 * 为什么用**减法**而不是乘法：门槛附近的高分要更保守（0.90 想越 0.89 的线得真够格），
 *   而本来就很低的分再乘系数没有意义（都是拦）。0.06 ≈ 让"@别人"这条多要 6 分。
 * 只影响判定分（effScore），**不改**模型原始分（日志里 score/scoreAdj 分开记，能复盘）。
 */
export declare const OTHER_MENTION_PENALTY = 0.06;
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
/** 取值分器(同参数单例复用: 模型与样例向量只算一次) */
export declare function createValueScorer(opts: {
    dataRoot: string;
    modelDir?: string;
    minScore?: number;
    logger?: Logger;
}): ValueScorer;
/** 追加一条评分记录(观察期用): {dataRoot}/.qqbot/value-scores.jsonl —— 一行一条, 可直接翻 */
export declare function appendScoreLog(dataRoot: string, rec: Record<string, unknown>): void;
//# sourceMappingURL=value-score.d.ts.map