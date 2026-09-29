/**
 * local-embed.ts — 本地小模型语义嵌入(2026-09-13 主人定)
 *
 * 用途(全部零 token): ① 群聊价值评分(KNN 样例近邻) ② 表情包语义搜索 ③ notifyWhen 粗筛
 * 模型: bge-small-zh-v1.5 (ONNX q8 ≈ 23MB, 中文专训) —— 比 dsh 自带 e5-small(129MB) 小 5.5 倍、CPU 快 ~3×、中文更强
 * 依赖: 复用宿主已装的 @huggingface/transformers(v4) —— 本插件**不新增依赖**(插件部署在宿主 node_modules 内, 可直接解析)
 * 位置: 默认 `{~/.dsh}/models/bge-small-zh`(用户级共享, 跨工作区一份; 可用配置覆盖)
 * 降级: 模型缺失/加载失败/开关关闭 → 所有能力静默返回 undefined, 绝不影响主流程
 *
 * 用法注意(bge-zh 官方口径, 实测有效):
 *  - pooling 用 'cls' + normalize(不是默认 mean)
 *  - 查询侧加前缀「为这个句子生成表示以用于检索相关文章：」; 文档侧不加
 */
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createLexicalEmbedder } from './lexical-embed.js';
/** bge-zh 官方查询前缀(查询侧) */
const QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：';
/** 模型资产清单(任一缺失即不可用) */
const ASSETS = ['onnx/model_quantized.onnx', 'tokenizer.json', 'config.json'];
/** 默认模型目录(用户级): {DSH_HOME|~/.dsh}/models/bge-small-zh */
/**
 * 全局重置所有已缓存的 embedder（面板「🔄 重新检测」用）。
 * 场景：某次加载失败会把该实例标记为不可用；用户想"立刻再试一次"而不重启进程时调用它。
 * @returns 被重置的实例数
 */
export function resetAllEmbedders() {
    let n = 0;
    try {
        for (const e of embedders.values()) {
            try {
                e.reset?.();
                n++;
            }
            catch { /* 单个失败继续 */ }
        }
    }
    catch { /* ignore */ }
    return n;
}
export function defaultModelDir() {
    const dshHome = (process.env.DSH_HOME && process.env.DSH_HOME.trim()) || join(homedir(), '.dsh');
    return join(dshHome, 'models', 'bge-small-zh');
}
/** 检查模型资产是否齐全(纯本地, 不加载模型) */
export function checkModelAssets(modelDir) {
    const missing = [];
    let bytes = 0;
    for (const rel of ASSETS) {
        const p = join(modelDir, rel);
        if (!existsSync(p)) {
            missing.push(rel);
            continue;
        }
        try {
            bytes += statSync(p).size;
        }
        catch { /* 读不到大小不影响判定 */ }
    }
    return { ok: missing.length === 0, missing, bytes };
}
/** 程序兜底全局开关(桥侧 settings-host 同步; 面板勾选后无需重启) */
let lexicalFallbackWanted = false;
/** 设置程序兜底开关(桥侧 /api/qqbot-settings/local-model/status 同步) */
export function setLexicalFallback(v) { lexicalFallbackWanted = v === true; }
/** 读取程序兜底开关 */
export function isLexicalFallback() { return lexicalFallbackWanted; }
const embedders = new Map();
/**
 * 创建(或复用)本地嵌入器。同 modelDir 单例复用 —— 模型只加载一次。
 */
export function createLocalEmbedder(opts = {}) {
    const modelDir = (opts.modelDir ?? '').trim() || defaultModelDir();
    const cached = embedders.get(modelDir);
    if (cached)
        return cached;
    const logger = opts.logger;
    let extractor;
    /** 程序兜底嵌入器(模型不可用且开关打开时启用) */
    let lexical;
    // ⚠️ 2026-09-27 修（主人反馈"智能回复失效、评分窗口只剩图片"）：
    //   原来是 `let failed = false` —— **一次加载失败就永久关闭**，之后 load() 永远直接返回 false，
    //   所有评分静默变成 undefined（只有"无分也记录"的图片条目还留在 value-scores.jsonl 里，
    //   看起来就像"模型坏了、文字消息完全不评分"）。实测 22:49:33 之后一条有分数的记录都没有。
    //   现在改成 `failedAt`（时间戳）：退避期结束后**允许重新尝试**，并提供 reset() 供面板"重新检测"强制重载。
    let failedAt = 0; // 0 = 从未失败
    let failureReason = '';
    let loading;
    let dims;
    let loadMs;
    /** 失败后的退避窗口：这段时间内不重复尝试（避免每条消息都触发一次加载风暴） */
    const RETRY_BACKOFF_MS = 60_000;
    async function load() {
        if (extractor)
            return true;
        if (lexical && (lexicalFallbackWanted || opts.lexicalFallback === true))
            return true; // 程序兜底已生效
        if (lexical)
            lexical = undefined; // 开关关掉 → 回到模型优先
        if (failedAt) {
            const waited = Date.now() - failedAt;
            if (waited < RETRY_BACKOFF_MS)
                return false; // 退避中
            // 退避结束 → 允许再试一次（清掉失败标记，让下面的加载流程跑起来）
            failedAt = 0;
            failureReason = '';
            logger?.info('[im-qqbot] 智能回复：退避结束，重新尝试加载本地小模型…');
        }
        if (loading)
            return loading;
        loading = (async () => {
            const t0 = Date.now();
            try {
                const assets = checkModelAssets(modelDir);
                if (!assets.ok)
                    throw new Error(`模型文件缺失(${assets.missing.join(', ')}) —— 请在面板「单会话设置」里下载或指定目录`);
                const mod = (await import('@huggingface/transformers'));
                if (!mod?.pipeline)
                    throw new Error('@huggingface/transformers 不可用');
                mod.env.allowRemoteModels = false; // 全离线, 不上传任何内容
                mod.env.localModelPath = dirname(modelDir); // 与 dsh 同款: 指到父目录
                const name = basename(modelDir);
                extractor = (await mod.pipeline('feature-extraction', name, { dtype: 'q8' }));
                loadMs = Date.now() - t0;
                logger?.info(`[im-qqbot] 智能回复(本地小模型)就绪: ${name} (${loadMs}ms)`);
                return true;
            }
            catch (e) {
                failedAt = Date.now();
                failureReason = e instanceof Error ? e.message : String(e);
                logger?.warn(`[im-qqbot] 智能回复不可用(本地小模型 ${modelDir}): ${failureReason}`);
                // 程序兜底(2026-09-30): 小模型不可用(如安卓缺 onnxruntime-node 的 android 原生绑定)时,
                // 改用零依赖的字符 n-gram 向量 —— 价值评分/语义搜索在无模型环境下仍可用(仅字面相似)
                if (lexicalFallbackWanted || opts.lexicalFallback === true) {
                    lexical = createLexicalEmbedder({ dims: 512 });
                    dims = lexical.dims;
                    loadMs = Date.now() - t0;
                    logger?.info(`[im-qqbot] 智能回复: 本地小模型不可用(${failureReason}) → 已启用程序兜底(字符 n-gram, ${lexical.dims} 维, 仅字面相似; 门槛建议先用「只记录」观察)`);
                    return true;
                }
                return false;
            }
            finally {
                loading = undefined;
            }
        })();
        return loading;
    }
    async function run(texts, isQuery) {
        if (opts.enabled === false || texts.length === 0)
            return undefined;
        if (!(await load()))
            return undefined;
        if (!extractor && lexical) {
            try {
                return texts.map((t) => lexical.embedOne(t));
            }
            catch (e) {
                logger?.warn(`[im-qqbot] 智能回复(程序兜底)失败: ${e instanceof Error ? e.message : String(e)}`);
                return undefined;
            }
        }
        try {
            const input = texts.map((t) => (isQuery ? QUERY_PREFIX + t : t));
            // bge-zh: CLS pooling + 归一化(点积即余弦)
            const out = await extractor(input, { pooling: 'cls', normalize: true });
            const arr = out.tolist();
            if (dims === undefined && Array.isArray(arr[0]))
                dims = arr[0].length;
            return arr;
        }
        catch (e) {
            logger?.warn(`[im-qqbot] 智能回复推理失败: ${e instanceof Error ? e.message : String(e)}`);
            return undefined;
        }
    }
    /** 强制重置：清掉失败标记与已加载实例，下次用到时重新加载（面板「重新检测」调用） */
    function reset() {
        failedAt = 0;
        failureReason = '';
        extractor = undefined;
        lexical = undefined;
        loading = undefined;
        dims = undefined;
        loadMs = undefined;
        logger?.info('[im-qqbot] 智能回复：已重置本地小模型状态，下次使用会重新加载');
    }
    const embedder = {
        modelDir,
        reset,
        status() {
            const assets = checkModelAssets(modelDir);
            if (lexical)
                return { available: true, modelDir, dims, loadMs, mode: 'lexical', reason: '程序兜底(字符 n-gram; 仅字面相似)' };
            if (failedAt) {
                const left = Math.max(0, RETRY_BACKOFF_MS - (Date.now() - failedAt));
                return {
                    available: false, modelDir, dims, loadMs,
                    reason: failureReason + (left > 0 ? '（' + Math.ceil(left / 1000) + ' 秒后自动重试；也可点「重新检测」立即重载）' : ''),
                };
            }
            if (extractor)
                return { available: true, modelDir, dims, loadMs, mode: 'model' };
            if (!assets.ok) {
                return { available: false, modelDir, reason: `模型文件缺失(${assets.missing.join(', ')})` };
            }
            return { available: true, modelDir, reason: '待加载(首次使用时加载)' };
        },
        available() {
            if (opts.enabled === false)
                return false;
            if (lexical)
                return true;
            if (failedAt && Date.now() - failedAt < RETRY_BACKOFF_MS)
                return false;
            return extractor !== undefined || checkModelAssets(modelDir).ok;
        },
        embedQuery: (text) => run([text], true).then((r) => r?.[0]),
        embedPassages: (texts) => run(texts, false),
        warmup() {
            if (opts.enabled === false)
                return;
            void load();
        },
    };
    embedders.set(modelDir, embedder);
    return embedder;
}
//# sourceMappingURL=local-embed.js.map