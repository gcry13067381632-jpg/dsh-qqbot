import { type EmoLabel } from './emo-samples.js';
import { type TendencyLabel } from './tendency-samples.js';
import type { Logger } from '../types.js';
export interface RelResult {
    /** 当前消息 ↔ 她上一条发言 的余弦(0~1) */
    relReply?: number;
    /** 当前消息 ↔ 群里最近 5 条 的最大余弦(0~1) */
    relHist?: number;
}
/**
 * 算相关度。模型不可用/文本为空 → undefined（调用方照常记录其它字段）。
 * @param history 群历史缓冲（`mwState.history`），只取最后 5 条有效文本
 */
export declare function computeRelevance(opts: {
    gid: string;
    currentText: string;
    history: Array<{
        messageId?: string;
        content?: string;
    }> | undefined;
    modelDir?: string;
    logger?: Logger;
}): Promise<RelResult | undefined>;
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
/** 记一次互动（每条群消息调一次; 只统计, 不生效） */
export declare function touchAffinity(dataRoot: string, key: string, opts?: {
    name?: string;
    mention?: boolean;
    reply?: boolean;
}): void;
export declare function effectiveReviews(e: AffinityEntry, now?: number): number;
export declare function memoryStrength(e: AffinityEntry, now?: number): number;
/** 档位（滞回：进档门槛高于退档，防止抖动） */
export declare function memoryTier(strength: number, prevTier?: string): '陌生人' | '眼熟' | '熟人';
/** 0~100 分（= 记忆强度 × 100；面板与排序沿用它，语义已从"功劳榜"改为"记忆强度"） */
export declare function affinityScore(e: AffinityEntry, now?: number): number;
/** 取某人的台账条目（好感度聚合要用它的熟识度算阻尼与范围） */
export declare function getAffinityEntry(dataRoot: string, key: string): AffinityEntry | undefined;
/** 按熟度排序（面板/工具用） */
export declare function topAffinity(dataRoot: string, limit?: number): Array<{
    key: string;
    name?: string;
    score: number;
    tier: string;
    reviews: number;
    msgs: number;
    mentions: number;
    replies: number;
    lastAt: number;
}>;
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
export declare const CLASSIFY_SCORE_MODE: 'knn' | 'centroid';
export interface EmoResult {
    label: EmoLabel;
    /** 最高组得分 */
    best: number;
    /** 与第二名的差(越大越有把握) */
    margin: number;
    /** 三组原始得分, 便于观察 */
    scores: Record<string, number>;
}
export declare function classifyEmo(text: string, opts?: {
    modelDir?: string;
    logger?: Logger;
}): Promise<EmoResult | undefined>;
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
export declare function detectScript(text: string): 'zh' | 'en' | undefined;
export declare function classifyTendency(text: string, opts?: {
    modelDir?: string;
    logger?: Logger;
}): Promise<TendencyResult | undefined>;
//# sourceMappingURL=local-signals.d.ts.map