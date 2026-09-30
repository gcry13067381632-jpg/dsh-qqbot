/**
 * lexical-embed.ts — 零依赖「程序兜底」文本向量 (2026-09-30)
 *
 * 为什么需要它：本地小模型走 `@huggingface/transformers`(v4) + `onnxruntime-node`，
 * 而该原生后端只发布 darwin / linux / win32 预编译 —— **没有 android**。
 * 实测安卓上 `import('@huggingface/transformers')` 依次死在：
 *   ① 宿主未装该包 → ERR_MODULE_NOT_FOUND；
 *   ② v4 入口硬依赖 sharp → 安卓无预编译；
 *   ③ onnxruntime-node 缺 `bin/napi-v6/android/arm64/onnxruntime_binding.node`（且不会回落 WASM）。
 * 于是手机版必然「模型资产齐全但跑不起来」。
 *
 * 本模块用 **字符 n-gram + 哈希桶 + 亚线性 TF + L2 归一化** 给出一份「字面相似度」向量：
 * 纯 CPU、微秒级、零依赖、维度与 bge-small-zh 对齐(dims 默认 512)，让
 * ① 群聊价值评分(KNN) ② 表情包语义搜索 ③ notifyWhen 粗筛 在无模型环境下仍然可用。
 *
 * ⚠️ 与 bge-small 的**语义**能力不同：它只衡量字面重合 —— 「开心」vs「高兴」这类同义改写
 *    分数会偏低，门槛(valueMinScore)需按新分布重标；默认 0.5 对字面相似度偏严，
 *    建议先用默认档 `log` 观察 value-scores.jsonl 再收紧。
 */
/** 向量维度(与 bge-small-zh-v1.5 对齐，便于同一套 KNN 代码直接复用) */
export declare const LEXICAL_DIMS = 512;
/** 文本 → L2 归一化后的稠密向量(点积即余弦) */
export declare function lexicalVector(text: string, dims?: number): number[];
/** 兜底嵌入器接口(与 local-embed 的嵌入器对齐) */
export interface LexicalEmbedder {
    name: string;
    dims: number;
    reason: string;
    available(): boolean;
    embedOne(text: string): number[];
    embedQuery(text: string): Promise<number[]>;
    embedPassages(texts: string[]): Promise<number[][]>;
    reset(): void;
}
/**
 * 创建词面兜底嵌入器 —— 接口与 local-embed 的嵌入器一致，可直接替换。
 */
export declare function createLexicalEmbedder(opts?: {
    dims?: number;
}): LexicalEmbedder;
//# sourceMappingURL=lexical-embed.d.ts.map