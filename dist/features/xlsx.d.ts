/**
 * xlsx.ts — 最小 XLSX 生成器（零依赖，2026-09-14 主人要"一键导出 Excel 分享"）
 *
 * 为什么不引库：插件要走 npm 让别人也能装，**不能为了一个导出功能拖进 exceljs/xlsx**
 *   （几十 MB 依赖、还要过 audit）。而 xlsx 本质就是"几个 XML 塞进一个 zip"，
 *   zip 又可以用 **store 模式**（不压缩）手写 —— 那就自己写，几十行的事。
 *
 * 支持：多个工作表 / 表头加粗 / 列宽 / 数字与文本单元格 / 中文与 emoji（UTF-8）。
 * 不支持（也用不上）：公式、样式表、共享字符串（用 inlineStr，省一层表）。
 *
 * ⚠️ 传进来的字符串会做 XML 转义 + 剔除控制字符（Excel 遇到非法字符会判定文件损坏）。
 */
export interface SheetSpec {
    /** 工作表名（Excel 限制 31 字符，这里自动截断） */
    name: string;
    /** 第一行按**表头**渲染（加粗） */
    rows: Array<Array<string | number | undefined | null>>;
    /** 各列宽度（字符数），缺省 14 */
    widths?: number[];
    /** 表头是否加粗（默认 true） */
    header?: boolean;
}
/**
 * 生成 xlsx 二进制。`sheets` 有几张就写几张。
 * 返回 Buffer（调用方可直接当 HTTP 响应体写出去）。
 */
export declare function buildXlsx(sheets: SheetSpec[]): Buffer;
//# sourceMappingURL=xlsx.d.ts.map