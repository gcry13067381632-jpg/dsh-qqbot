import type { BotplayEventConfig } from '../config.js';
/** 事件配置文件路径: {dataRoot}/botplay-events.json(2026-09-10 M4.3 主人定:
 *  存工作目录根, 和「表情包」等平级, 不藏进 .qqbot 子目录) */
export declare function botplayEventsPath(dataRoot: string): string;
/**
 * 读取事件列表(现读文件, 支持热更)。
 * 文件不存在/损坏 → 尝试从 settings 旧数据迁移(eventsFromSettings)并落盘;
 * settings 也没有 → 返回 []。
 */
export declare function readBotplayEvents(dataRoot: string, eventsFromSettings: () => BotplayEventConfig[]): BotplayEventConfig[];
/** 写入事件列表(原子写; 空数组也写, 表示清空) */
export declare function saveBotplayEvents(dataRoot: string, events: BotplayEventConfig[]): boolean;
//# sourceMappingURL=botplay-store.d.ts.map