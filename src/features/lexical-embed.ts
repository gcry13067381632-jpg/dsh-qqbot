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
export const LEXICAL_DIMS = 512;
/** 特征权重：单字 / 双字 / 三字(中文以双字为主力) */
const W1 = 0.35;
const W2 = 1;
const W3 = 0.5;
/** FNV-1a 32 位哈希(稳定、无依赖、跨进程一致 —— 样例向量落盘后仍可比) */
function fnv1a(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
/** 归一化：小写、去空白与标点，只留字母/数字/汉字 */
function normalize(text: string): string {
    return String(text ?? '').toLowerCase().replace(/[\s]+/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}
/** 把一个特征词按符号哈希累加进桶(符号哈希可让碰撞相互抵消，减少偏置) */
function addFeature(v: Float64Array, feat: string, weight: number, dims: number): void {
    const h = fnv1a(feat);
    const idx = h % dims;
    const sign = ((h >>> 8) & 1) === 1 ? 1 : -1;
    v[idx] += sign * weight;
}
/** 文本 → L2 归一化后的稠密向量(点积即余弦) */
export function lexicalVector(text: string, dims: number = LEXICAL_DIMS): number[] {
    const d = Number.isFinite(dims) && dims > 0 ? Math.floor(dims) : LEXICAL_DIMS;
    const s = normalize(text);
    const acc = new Float64Array(d);
    for (let i = 0; i < s.length; i++) {
        addFeature(acc, s[i], W1, d);
        if (i + 1 < s.length)
            addFeature(acc, s.slice(i, i + 2), W2, d);
        if (i + 2 < s.length)
            addFeature(acc, s.slice(i, i + 3), W3, d);
    }
    let sum = 0;
    for (let i = 0; i < d; i++) {
        const a = acc[i];
        const t = a === 0 ? 0 : Math.sign(a) * (1 + Math.log(1 + Math.abs(a))); // 亚线性 TF
        acc[i] = t;
        sum += t * t;
    }
    const norm = Math.sqrt(sum) || 1;
    const out = new Array<number>(d);
    for (let i = 0; i < d; i++)
        out[i] = acc[i] / norm;
    return out;
}
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
export function createLexicalEmbedder(opts: { dims?: number } = {}): LexicalEmbedder {
    const dims = Number.isFinite(opts.dims) && (opts.dims as number) > 0 ? Math.floor(opts.dims as number) : LEXICAL_DIMS;
    return {
        name: 'lexical-char-ngram',
        dims,
        reason: '程序兜底(字符 n-gram + TF, 衡量字面相似; 非语义)',
        available: () => true,
        embedOne: (text: string) => lexicalVector(text, dims),
        embedQuery: async (text: string) => lexicalVector(text, dims),
        embedPassages: async (texts: string[]) => (texts || []).map((t) => lexicalVector(t, dims)),
        reset() { /* 无状态，无需重置 */ },
    };
}
