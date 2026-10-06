/**
 * 配置诊断日志。**每次插件启动（每个实例）调用一次即可**。
 *
 * @param opts.enabled - 总开关；不传 = 保持当前值（默认 false）
 * @param opts.maxBytes - 单文件上限字节数（默认 2 MB）
 * @param opts.home - 输出根目录（默认 `DSH_HOME` 或 `~/.dsh`）
 */
export declare function configureDiag(opts: {
    enabled?: boolean;
    maxBytes?: number;
    home?: string;
}): void;
/** 诊断日志现在是开着的吗？ */
export declare function diagEnabled(): boolean;
/** 某个诊断文件的绝对路径（**不看开关**，面板展示用） */
export declare function diagPathFor(name: string): string;
/**
 * 写一行诊断日志（**全插件唯一入口**）。
 *
 * - 开关关着 ⇒ 立刻返回，**零 I/O**。
 * - 写失败（磁盘满/被占用）⇒ 静默吞掉，**绝不抛**。
 *
 * @param name - 日志名（不含 `.log`），如 `qqbot-ext-diag` / `botplay-diag`
 * @param line - 内容（会自动补时间戳与换行）
 */
export declare function diagWrite(name: string, line: string): void;
/** 诊断状态（面板/端点展示：开关、上限、各文件当前大小） */
export declare function diagStatus(): {
    enabled: boolean;
    maxBytes: number;
    root: string;
    files: Array<{
        name: string;
        path: string;
        bytes: number;
    }>;
};
/**
 * 给「排查完就删」的调用方一条清理捷径（只删我们自己的诊断日志）。
 * @param names - 要删的日志名（不含 `.log`）；不传 = 删 sizes 里已知的全部
 */
export declare function diagClean(names?: string[]): number;
//# sourceMappingURL=diag.d.ts.map