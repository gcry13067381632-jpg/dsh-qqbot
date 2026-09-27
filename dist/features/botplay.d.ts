/**
 * botplay.ts — botplay 互动事件装配器(2026-09-08, Phase1 MVP)
 *
 * 设计定稿见工作区 参考文档/botplay互动事件装配器_设计完整稿.md(唯一权威):
 * 一句话本质 = 自定义 bot 互动事件: ①bot(非LLM)发出什么交互卡片 →
 * ②用户点哪个按钮 → ③这件事要不要/怎么影响 LLM, 全部可配置。
 *
 * 本文件职责(参照 qq-approval.ts / qq-user-questions.ts 的注册表范式):
 *   - BotplayController: 发卡(trigger) + interaction 回调结算(handleInteraction)
 *     + append 三档(no_append / append_silent / append_wake)
 *   - 事件配置从 live config(config.botplayEvents, settings 同源热更)现读;
 *     dock「🎮 互动事件」装配器编辑后保存即热更, 无需重启。
 *   - /botplay 命令经 triggerBotplay() 模块级注册表触发(仿 outbound-mode-switch)。
 *
 * Phase1 MVP 范围: schema 最小集(id/name/buttons[label,botAction.reply_text,
 * llmEffect.mode]/maxClicks/expireSec); perm 默认 all, triggerer 推荐;
 * 行为类型 reply_text 落地, jump_url/callback 预留。
 */
import type { ReplyTarget } from '@tencent-connect/qqbot-nodejs';
import type { QQBotSender } from '../transport/outbound-buffer.js';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';
import type { BotplayButtonConfig, BotplayEventConfig } from '../config.js';
export interface BotplayTriggerResult {
    ok: boolean;
    msg: string;
}
/**
 * 构造事件卡片 keyboard(官方 msg_type=2 + keyboard)。
 * QQ 限制: rows ≤5 行 × 5 按钮/行; 默认每行1个(竖排, 字宽不截断),
 * 事件 buttonsPerRow(1~5)可设每行多个(Phase2)。
 * permission: 按事件 perm 决定 —— all→type2所有人 / triggerer→type0 指定触发者 /
 * owner→type0 主人白名单 / users→type0 指定 openid。
 * 按钮 action.type 按 botAction 区分(Phase2):
 *   reply_text/callback/command → 1 回调按钮(点击回后台, data=bp:card:btn)
 *   jump_url                      → 0 跳转按钮(data=http(s) 链接, 点击直接跳不走回调)
 */
export declare function botplayKeyboard(cardId: string, buttons: BotplayButtonConfig[], perm: NonNullable<BotplayEventConfig['perm']>, ownerIds: string[], triggererId?: string, buttonsPerRow?: number): {
    content: {
        rows: unknown[];
    };
};
/** 从 interaction button_data 解析 cardId + buttonId; 非 botplay 按钮返回 null */
export declare function parseBotplayButton(data: string | undefined): {
    cardId: string;
    buttonId: string;
} | null;
export declare function parseCatalogButton(data: string | undefined): {
    page: number;
    key: string;
} | null;
export declare class BotplayController {
    private readonly manager;
    private readonly sender;
    private readonly logger;
    /** live 事件配置 getter(config.botplayEvents, 每次现读支持热更) */
    private readonly eventsGetter;
    /** 主人 openid 白名单 getter(config.groupAdmin.owners; perm=owner 用) */
    private readonly ownersGetter;
    /** 台账 dataDir getter(表情包目录; 点击人昵称反查, 与 dock 禁言面板同源) */
    private readonly ledgerDataDirGetter;
    private readonly cards;
    constructor(manager: SessionManager, sender: QQBotSender, logger: Logger, 
    /** live 事件配置 getter(config.botplayEvents, 每次现读支持热更) */
    eventsGetter: () => BotplayEventConfig[], 
    /** 主人 openid 白名单 getter(config.groupAdmin.owners; perm=owner 用) */
    ownersGetter: () => string[], 
    /** 台账 dataDir getter(表情包目录; 点击人昵称反查, 与 dock 禁言面板同源) */
    ledgerDataDirGetter: () => string);
    /** 指令型按钮执行器(bootstrap 注入: 执行斜杠命令并返回文本) */
    private commandExecutor;
    setCommandExecutor(fn: ((cmdName: string, target: ReplyTarget) => Promise<string>) | undefined): void;
    /** 列出所有事件(公开, dock/命令共用) */
    listEvents(): BotplayEventConfig[];
    /** 按事件 id 精确查(live 现读) */
    findEvent(eventId: string): BotplayEventConfig | undefined;
    /**
     * 触发发卡(/botplay 事件名)。定位会话用命令上下文所在 scope/peerId,
     * 归属人 = 触发者本人 openid(group=c2c 同 senderId)。
     */
    trigger(target: ReplyTarget, eventId: string, triggererId: string): Promise<BotplayTriggerResult>;
    /** 发送事件目录卡(/botplay 无参 或 目录卡翻页; 点事件名按钮 → handleInteraction 直接触发) */
    sendCatalog(target: ReplyTarget, page?: number): Promise<BotplayTriggerResult>;
    /**
     * interaction 回调结算(bootstrap interaction 分发转发; type=11 消息按钮)。
     * 流程: 解析 bp:<cardId>:<buttonId> → 查卡(过期/点满) → 查事件配置(live)
     * → 校验按钮存在与点击人权限 → 执行 botAction → 按 llmEffect.mode append/唤醒。
     * @returns true = 已被 botplay 消费(调用方无需其它处理)
     */
    handleInteraction(event: unknown, replyTarget: ReplyTarget): Promise<boolean>;
    /**
     * 点击人可读标签(与 dock 禁言面板/审批同源的昵称反查):
     *   ①群成员台账 group-members.jsonl(gid:mid → name, 由 chat-ledger 中间件持续记录)
     *   ②私聊台账 known-chats.jsonl(c2c:id → name)
     *   ③会话最近 user/message 消息壳 [昵称 (openid)] 兜底
     *   ④全 miss 回落 openid。
     */
    private clickerLabel;
    /** 权限判定: all 放行 / triggerer=触发者本人 / owner=主人白名单 / users=指定 openid */
    private checkPerm;
    /**
     * append 三档落点: 往该 peer 的会话写上下文/唤醒 AI。
     * ⚠️ 会话不在内存(重启后未恢复/被 idle 回收)→ getOrCreate 恢复/重建(不触发回合),
     *    保证 append/injectToPeer 有 record 可挂 —— 这是"点击没反应"的常见根因。
     */
    private applyEffect;
    private safeReply;
    /** 清理全部活动卡(dispose 用) */
    clear(): void;
    /** 扫掉过期卡(Phase2: 定期/触发时调用, 防内存积压) */
    sweepExpired(): number;
    /** 活动卡数量(诊断用) */
    get cardCount(): number;
}
export declare function registerBotplayController(ns: string, c: BotplayController | undefined): void;
/** /botplay 命令触发入口: bootstrap 注册实现(带 sender/manager)。
 *  ⚠️ 2026-09-11 多实例修复: 原模块级单例会被多个实例互相覆盖(和 outbound writer 同款 bug,
 *  实测 /botplay 在 某实例会话执行却发卡到别的实例的群 86976C...)。改为按 ns 注册表。 */
type TriggerFn = (target: ReplyTarget, eventId: string, triggererId: string) => Promise<BotplayTriggerResult>;
export declare function setBotplayTriggerImpl(ns: string, fn: TriggerFn | undefined): void;
export declare function triggerBotplay(ns: string, target: ReplyTarget, eventId: string, triggererId: string): Promise<BotplayTriggerResult>;
/** 事件目录卡入口: bootstrap 注册实现(带 sender/manager); /botplay 无参调用 */
type CatalogFn = (target: ReplyTarget, page: number) => Promise<BotplayTriggerResult>;
export declare function setBotplayCatalogImpl(ns: string, fn: CatalogFn | undefined): void;
export declare function botplayCatalog(ns: string, target: ReplyTarget, page?: number): Promise<BotplayTriggerResult>;
/** 取某 ns 的事件列表(dock 装配器读; settings value 里其实已有, 此出口备用) */
export declare function listBotplayEventsAny(): Array<BotplayEventConfig & {
    ns: string;
}>;
/**
 * 取指定实例的事件列表(命令层 /botplay 用)。
 * ⚠️ 2026-09-10 修复: 事件存储自 M4.3 起已迁到 {dataRoot}/botplay-events.json, 但命令层仍在读
 *    config.botplayEvents(settings 层, 迁移后已被清空) → /botplay 永远报"还没有装配任何互动事件"。
 *    控制器 listEvents() 是现读文件的(支持热更), 这里直接复用其数据源, 单一真相源。
 * 控制器未注册(插件未就绪)时返回 undefined, 调用方回退 config.botplayEvents。
 */
export declare function listBotplayEventsOfNs(ns: string): BotplayEventConfig[] | undefined;
/** 会话定位 → ReplyTarget(命令层用; senderId 即触发者) */
export declare function resolveCommandTarget(cmdCtx: {
    message?: {
        kind?: string;
        groupOpenid?: string;
        senderId?: string;
        messageId?: string;
    };
}): {
    target: ReplyTarget;
    triggererId: string;
};
export {};
//# sourceMappingURL=botplay.d.ts.map