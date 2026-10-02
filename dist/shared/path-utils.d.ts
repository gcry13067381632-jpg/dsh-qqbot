export declare function normalizeUserPath(input: unknown, opts?: {
    base?: string;
}): string;
/** 该路径在本机是否可用（存在 + 可写）；不可用时返回原因，可用返回 '' */
export declare function pathProblem(p: string): string;
//# sourceMappingURL=path-utils.d.ts.map