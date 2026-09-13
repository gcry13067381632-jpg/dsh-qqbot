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
import type { Logger } from '../types.js';

/** bge-zh 官方查询前缀(查询侧) */
const QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：';

/** 模型资产清单(任一缺失即不可用) */
const ASSETS = ['onnx/model_quantized.onnx', 'tokenizer.json', 'config.json'] as const;

/** 默认模型目录(用户级): {DSH_HOME|~/.dsh}/models/bge-small-zh */
export function defaultModelDir(): string {
  const dshHome = (process.env.DSH_HOME && process.env.DSH_HOME.trim()) || join(homedir(), '.dsh');
  return join(dshHome, 'models', 'bge-small-zh');
}

/** 检查模型资产是否齐全(纯本地, 不加载模型) */
export function checkModelAssets(modelDir: string): { ok: boolean; missing: string[]; bytes: number } {
  const missing: string[] = [];
  let bytes = 0;
  for (const rel of ASSETS) {
    const p = join(modelDir, rel);
    if (!existsSync(p)) {
      missing.push(rel);
      continue;
    }
    try { bytes += statSync(p).size; } catch { /* 读不到大小不影响判定 */ }
  }
  return { ok: missing.length === 0, missing, bytes };
}

export interface EmbedderStatus {
  /** 是否可用(已加载成功 or 资产齐全但未加载) */
  available: boolean;
  /** 模型目录 */
  modelDir: string;
  /** 不可用原因 */
  reason?: string;
  /** 向量维度(加载后可知) */
  dims?: number;
  /** 加载耗时 ms */
  loadMs?: number;
}

export interface LocalEmbedder {
  readonly modelDir: string;
  /** 当前状态(不触发加载) */
  status(): EmbedderStatus;
  /** 是否可用 */
  available(): boolean;
  /** 查询侧嵌入(带 bge 前缀)。不可用/失败 → undefined */
  embedQuery(text: string): Promise<number[] | undefined>;
  /** 文档侧嵌入(不带前缀)，批量。不可用/失败 → undefined */
  embedPassages(texts: string[]): Promise<number[][] | undefined>;
  /** 后台预热(不阻塞, 失败静默) */
  warmup(): void;
}

interface TransformersLike {
  pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<unknown>;
  env: Record<string, unknown>;
}

type ExtractorFn = (input: string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;

const embedders = new Map<string, LocalEmbedder>();

/**
 * 创建(或复用)本地嵌入器。同 modelDir 单例复用 —— 模型只加载一次。
 */
export function createLocalEmbedder(opts: { modelDir?: string; logger?: Logger; enabled?: boolean } = {}): LocalEmbedder {
  const modelDir = (opts.modelDir ?? '').trim() || defaultModelDir();
  const cached = embedders.get(modelDir);
  if (cached) return cached;

  const logger = opts.logger;
  let extractor: ExtractorFn | undefined;
  let failed = false;
  let failureReason = '';
  let loading: Promise<boolean> | undefined;
  let dims: number | undefined;
  let loadMs: number | undefined;

  async function load(): Promise<boolean> {
    if (extractor) return true;
    if (failed) return false;
    if (loading) return loading;
    loading = (async (): Promise<boolean> => {
      const t0 = Date.now();
      try {
        const assets = checkModelAssets(modelDir);
        if (!assets.ok) throw new Error(`模型文件缺失(${assets.missing.join(', ')}) —— 请在面板「单会话设置」里下载或指定目录`);
        const mod = (await import('@huggingface/transformers' as string)) as unknown as TransformersLike;
        if (!mod?.pipeline) throw new Error('@huggingface/transformers 不可用');
        mod.env.allowRemoteModels = false;              // 全离线, 不上传任何内容
        mod.env.localModelPath = dirname(modelDir);     // 与 dsh 同款: 指到父目录
        const name = basename(modelDir);
        extractor = (await mod.pipeline('feature-extraction', name, { dtype: 'q8' })) as ExtractorFn;
        loadMs = Date.now() - t0;
        logger?.info(`[im-qqbot] 本地小模型就绪: ${name} (${loadMs}ms)`);
        return true;
      } catch (e) {
        failed = true;
        failureReason = e instanceof Error ? e.message : String(e);
        logger?.warn(`[im-qqbot] 本地小模型不可用(${modelDir}): ${failureReason}`);
        return false;
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  }

  async function run(texts: string[], isQuery: boolean): Promise<number[][] | undefined> {
    if (opts.enabled === false || texts.length === 0) return undefined;
    if (!(await load())) return undefined;
    try {
      const input = texts.map((t) => (isQuery ? QUERY_PREFIX + t : t));
      // bge-zh: CLS pooling + 归一化(点积即余弦)
      const out = await extractor!(input, { pooling: 'cls', normalize: true });
      const arr = out.tolist();
      if (dims === undefined && Array.isArray(arr[0])) dims = arr[0].length;
      return arr;
    } catch (e) {
      logger?.warn(`[im-qqbot] 本地小模型推理失败: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  }

  const embedder: LocalEmbedder = {
    modelDir,
    status(): EmbedderStatus {
      const assets = checkModelAssets(modelDir);
      if (failed) return { available: false, modelDir, reason: failureReason, dims, loadMs };
      if (extractor) return { available: true, modelDir, dims, loadMs };
      if (!assets.ok) {
        return { available: false, modelDir, reason: `模型文件缺失(${assets.missing.join(', ')})` };
      }
      return { available: true, modelDir, reason: '待加载(首次使用时加载)' };
    },
    available(): boolean {
      if (opts.enabled === false || failed) return false;
      return extractor !== undefined || checkModelAssets(modelDir).ok;
    },
    embedQuery: (text) => run([text], true).then((r) => r?.[0]),
    embedPassages: (texts) => run(texts, false),
    warmup(): void {
      if (opts.enabled === false) return;
      void load();
    },
  };
  embedders.set(modelDir, embedder);
  return embedder;
}
