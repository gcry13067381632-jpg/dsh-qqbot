import type { Logger } from '../types.js';
/** 默认模型目录(用户级): {DSH_HOME|~/.dsh}/models/bge-small-zh */
/**
 * 全局重置所有已缓存的 embedder（面板「🔄 重新检测」用）。
 * 场景：某次加载失败会把该实例标记为不可用；用户想"立刻再试一次"而不重启进程时调用它。
 * @returns 被重置的实例数
 */
export declare function resetAllEmbedders(): number;
export declare function defaultModelDir(): string;
/** 检查模型资产是否齐全(纯本地, 不加载模型) */
export declare function checkModelAssets(modelDir: string): {
    ok: boolean;
    missing: string[];
    bytes: number;
};
export interface EmbedderStatus {
    /** 是否可用(已加载成功 or 资产齐全但未加载) */
    available: boolean;
    /** 模型目录 */
    modelDir: string;
    /** 不可用原因 */
    reason?: string;
    /** 实际生效的模式(2026-09-30): model=本地小模型 / lexical=程序兜底 */
    mode?: 'model' | 'lexical';
    /** 向量维度(加载后可知) */
    dims?: number;
    /** 加载耗时 ms */
    loadMs?: number;
}
export interface LocalEmbedder {
    /** 强制重置加载状态（失败退避 / 已加载实例都清掉），下次用到时重新加载 */
    reset?: () => void;
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
/** 设置程序兜底开关(桥侧 /api/qqbot-settings/local-model/status 同步) */
export declare function setLexicalFallback(v: boolean): void;
/** 读取程序兜底开关 */
export declare function isLexicalFallback(): boolean;
/**
 * 创建(或复用)本地嵌入器。同 modelDir 单例复用 —— 模型只加载一次。
 */
export declare function createLocalEmbedder(opts?: {
    modelDir?: string;
    logger?: Logger;
    enabled?: boolean;
    lexicalFallback?: boolean;
}): LocalEmbedder;
//# sourceMappingURL=local-embed.d.ts.map