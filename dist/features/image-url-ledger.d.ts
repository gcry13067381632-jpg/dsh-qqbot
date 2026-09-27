/** 台账文件名（放在表情包目录里，跟图库同生共死） */
export declare const IMAGE_URL_LEDGER = "image-url-ledger.jsonl";
/** 台账绝对路径 */
export declare function ledgerFileOfStickerDir(stickerDir: string): string;
/** 图库文件名 → id（`1456cfc6a256.jpg` → `1456cfc6a256`） */
export declare function stickerIdOfFile(file: string): string;
/**
 * 从图片文件路径推回表情包目录:
 * `…\表情包\lib\candidate\1456cfc6a256.jpg` → `…\表情包`
 * （找不到 `lib` 段就退回上一级，宁可错也别抛异常）
 */
export declare function stickerDirFromImagePath(imgPath: string): string;
/** 记录一条「id → QQ 链接」（追加写，失败静默；不影响主链） */
export declare function recordImageUrl(stickerDir: string, id: string, url: string): void;
/** 按「图库 id」或「图片文件路径」查 QQ 链接（查不到返回 undefined） */
export declare function lookupImageUrl(stickerDir: string, idOrPath: string): string | undefined;
/** 直接给图片文件路径也能查（内部自己推表情包目录） */
export declare function lookupImageUrlByPath(imgPath: string): string | undefined;
/** QQ 链接 → 图库 id（查不到返回 undefined; 反向索引按 mtime/size 缓存） */
export declare function lookupStickerIdByUrl(stickerDir: string, url: string): string | undefined;
//# sourceMappingURL=image-url-ledger.d.ts.map