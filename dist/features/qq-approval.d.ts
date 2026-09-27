/**
 * qq-approval.ts — QQ 远程审批: 把 dsh 的权限申请变成 QQ 消息, 由任务发起者在 QQ 里放行/拒绝
 *
 * 思路来源(必须注明):
 *   - wang-22-code/dsh-qqbot-bridge 的 src/approval.ts(QqApprovalController 设计)
 *     https://github.com/wang-22-code/dsh-qqbot-bridge(README「QQ 权限审批」)
 *   - 宿主机制为 dsh 标准事件 ctx.on('approval/request', (request, next) => …),
 *     官方 dsh-acp、dsh-web 审批弹窗同款接线(请求带 request.agent / request.callId,
 *     处理器返回 'allowed-once' | 'rejected' | 'cancelled', 或调用 next() 走宿主默认)。
 *
 * 本实现按本项目结构重写(非拷贝):
 *   - 发送走本项目 sender.sendMarkdown(自带 markdown→text→wakeup 降级链与撤回记录);
 *   - 会话定位用本项目 SessionManager.findByAgent(带 agent.id 兜底);
 *   - 入站拦截挂在本项目 gateway 的 bot.on('message') 最先(消费后不再进 agent)。
 *
 * 流程: 宿主 approval/request → 向"发起者所在会话"推 QQ 审批提示(一次性 CODE)
 *       → 入站 /approve|/deny CODE(或 允许/拒绝 CODE)被拦截
 *       → 校验"发起者本人 + 同会话" → 结算 allow-once / rejected。
 * 边界: CODE 一次性; approvalTimeoutMs 超时自动拒绝; agent 取消/宿主退出自动取消;
 *       只授权当前这一次操作; 群聊里其他成员看到 CODE 也无法批准(senderId 校验)。
 */
import type { ReplyTarget } from '@tencent-connect/qqbot-nodejs';
import type { QQBotSender } from '../transport/outbound-buffer.js';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
/** dsh 宿主 approval/request 事件的请求形状(与本项目实际用到的字段) */
export interface ApprovalRequestLike {
    agent: unknown;
    toolName?: string;
    reason?: string;
    callId?: string;
    signal?: AbortSignal;
}
/** 入站消息的最小只读形状(与 transport/inbound.ts 的 msg 同形) */
interface ApprovableMessage {
    kind?: string;
    senderId?: string;
    content?: string;
    groupOpenid?: string;
    messageId?: string;
    [key: string]: unknown;
}
/** Web 浮层看到的待办条目(去敏: 不含 agent 引用) */
export interface WebPendingApproval {
    code: string;
    toolName: string;
    reason: string;
    deadlineAt: number;
    /** 发起者描述(群=群名/私聊=昵称, 尽力而为) */
    ownerHint: string;
}
export interface ParsedApprovalCommand {
    outcome: 'allowed-once' | 'rejected';
    code: string;
}
/** 只解析显式审批命令; 普通聊天消息原样放行给 agent */
export declare function parseApprovalCommand(content: string): ParsedApprovalCommand | null;
/** 构造审批卡片按钮 keyboard(仅主人可点) */
export declare function approvalKeyboard(code: string): unknown;
/** 从 keyboard 回调数据解析动作; 非审批按钮返回 null */
export declare function parseApprovalButton(data: string | undefined): {
    act: 'allow' | 'deny';
    code: string;
} | null;
/** QQ 载体的一次性审批 answerer(dsh approval/request → QQ 按钮卡片 → interaction 回调结算) */
export declare class QqApprovalController {
    private readonly manager;
    private readonly sender;
    private readonly logger;
    /** 超时(ms)提供器: 每次 request 现读, 支持 Web 设置热改生效 */
    private readonly timeoutMsProvider;
    private readonly pending;
    constructor(manager: SessionManager, sender: QQBotSender, logger: Logger, 
    /** 超时(ms)提供器: 每次 request 现读, 支持 Web 设置热改生效 */
    timeoutMsProvider: () => number);
    /** 宿主 approval/request 处理器: 定位发起者会话并发 QQ 审批提示 */
    request(req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>;
    /**
     * 入站拦截(挂在 bot.on('message') 最前): 命中 /approve|/deny CODE 则结算并消费消息。
     * @returns true = 消息已被审批逻辑消费(调用方不要再派发给 agent)
     */
    handleInbound(msg: ApprovableMessage, replyTarget: ReplyTarget): Promise<boolean>;
    /**
     * 按钮回调结算(bot.on('interaction') 转发过来; type=11 消息按钮)。
     * 命中审批按钮 → 校验发起者本人 → settle + 回执。
     * @returns true = 已被审批消费(调用方无需其它处理)
     */
    handleInteraction(event: unknown, replyTarget: ReplyTarget): Promise<boolean>;
    /** settle + 留痕注入 + QQ 回执(按钮与文本两条路共用) */
    private settleWithReceipt;
    /** 结算: 清定时器/中止监听/pending 项并 resolve */
    private settle;
    /** Web 浮层拉取待办列表(去敏) */
    listPendingForWeb(): WebPendingApproval[];
    /** Web 浮层点按钮: 按 code 结算(与 QQ 按钮/文本码共用 pending, 先到先得) */
    decideByWeb(code: string, act: 'allow' | 'deny'): {
        ok: boolean;
        msg: string;
    };
    dispose(): void;
}
type ApprovalDispatch = (req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>;
/**
 * 生成挂在插件 apply ctx 的审批监听(ACP 模式): 非本 bot agent / 未启用 → next() 快速放行。
 * ⚠️ 2026-09-11 多实例修复: 原实现读模块级单例 dispatch(被多实例互相覆盖 → 审批串到别的实例的
 * controller)。改为 handler 参数=每实例闭包捕获自己的 manager/controller(ownership 判断在各实例
 * 自己的 handler 里)。无参调用保留单实例兜底(读注册表唯一项)。
 */
export declare function makeApprovalListener(handler?: ApprovalDispatch): (req: unknown, next: () => Promise<string>) => Promise<string>;
/** bootstrap 注册实际处理器(按实例 ns; 传 undefined 可卸载) */
export declare function setApprovalDispatch(ns: string, fn: ApprovalDispatch | undefined): void;
export declare function registerApprovalController(ns: string, c: QqApprovalController | undefined): void;
/** 汇总所有实例的待办(web 浮层拉取) */
export declare function listAllPendingWeb(): Array<WebPendingApproval & {
    ns: string;
}>;
/** 跨实例结算: 返回 {ok, ns?, msg} */
export declare function decideByWebAny(code: string, act: 'allow' | 'deny'): {
    ok: boolean;
    ns?: string;
    msg: string;
};
export {};
//# sourceMappingURL=qq-approval.d.ts.map