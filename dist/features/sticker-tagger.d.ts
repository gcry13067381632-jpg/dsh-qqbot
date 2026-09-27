import type { Logger } from '../types.js';
/**
 * 对本地图片自动打标。visionCli 为空时自动探测本机 modlens(仅作一个候选实现);
 * 探测不到/失败 → null(图保持"待整理", 由 agent 视觉工具补——引擎与具体插件解耦)。
 */
export declare function autoTagImage(localPath: string, visionCli: string, logger?: Logger): Promise<{
    tags: string[];
    desc: string;
} | null>;
//# sourceMappingURL=sticker-tagger.d.ts.map