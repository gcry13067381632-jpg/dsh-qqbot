import type { Context } from '@deepseek-ai/cordis';
import { type ImQQBotConfig } from './config.js';
export declare const name = "im-qqbot";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<ImQQBotConfig>;
export type { ImQQBotConfig } from './config.js';
export declare function apply(ctx: Context, config: ImQQBotConfig): Promise<void>;
export declare function getSettingsService(): unknown;
//# sourceMappingURL=index.d.ts.map