import type { Context } from '@deepseek-ai/cordis';
import type { SessionManager } from './session/session-manager.js';
import type { QQBotSender } from './transport/outbound-buffer.js';
/** qqChannel service 形状：由 dsh-qqbot 在 QQ 会话 ctx 上 provide */
export interface QQChannel {
    manager: SessionManager;
    sender: QQBotSender;
}
export declare const name = "qqbot-channel-tools";
export declare const inject: string[];
export declare function setChannelBridge(b: QQChannel | undefined): void;
/** 装载本插件时把 qqChannel 一并注入(由 dsh-qqbot setup 提供) */
export declare function apply(ctx: Context): Promise<void>;
/**
 * host 面板用(2026-09-13 主人要的「让ai写」按钮):
 * **照抄定时任务的做法** —— 伪造一条消息直接调 handleInbound 唤醒该群/私聊的 AI 回合
 * (见 features/scheduler.ts fireTask: 与 SDK 消息同形, messageId 空 → 出站自动走主动推送;
 *  senderName 用中性名、不打假 (@you), 防污染主人交互记忆)。
 *
 * 为什么不复用高层轮子: wakeSessionAgent 要先配"群组管理器会话"; injectSynthetic 是塞聚合窗口(要等人停口);
 *  而面板按钮要的是**立刻触发** —— 与"定时任务到点必须触发回合"同理, 直调 handleInbound 最贴合。
 *
 * host 半边(settings-host.js) 通过 import('@zaofan/dsh-qqbot/channel-tools') 调用(manager 只在插件侧)。
 */
export declare function askAiToWriteSamples(ns: string, scope: 'group' | 'c2c', peerId: string): Promise<{
    ok: boolean;
    msg: string;
}>;
//# sourceMappingURL=channel-tools.d.ts.map