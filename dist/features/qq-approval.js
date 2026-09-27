import { appendFileSync } from 'node:fs';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
/** 只解析显式审批命令; 普通聊天消息原样放行给 agent */
export function parseApprovalCommand(content) {
    const normalized = content.trim();
    const match = normalized.match(/^\/(approve|allow|deny|reject)\s+([A-Z0-9]{6})$/i)
        ?? normalized.match(/^(允许|同意|拒绝|不同意)\s+([A-Z0-9]{6})$/i);
    if (!match)
        return null;
    const action = match[1].toLowerCase();
    return {
        outcome: ['approve', 'allow', '允许', '同意'].includes(action) ? 'allowed-once' : 'rejected',
        code: match[2].toUpperCase(),
    };
}
/** 面板/卡片按钮动作负载: {v:'approval', code, act:'allow'|'deny'} */
const BTN_PREFIX = 'ap:';
/** 构造审批卡片按钮 keyboard(仅主人可点) */
export function approvalKeyboard(code) {
    const btn = (label, act, style) => ({
        id: `${BTN_PREFIX}${act}:${code}`,
        render_data: { label, visited_label: label + ' ✓', style },
        action: {
            type: 1,
            permission: { type: 0 }, // 0=指定用户可操作; 具体主人 id 在发送端按 record 注入(见 request)
            data: `${BTN_PREFIX}${act}:${code}`,
            unsupport_tips: '请回复 /approve 或 /deny + 验证码',
        },
    });
    return {
        content: {
            rows: [
                { buttons: [btn('✅ 允许本次', 'allow', 1)] },
                { buttons: [btn('❌ 拒绝', 'deny', 0)] },
            ],
        },
    };
}
/** 从 keyboard 回调数据解析动作; 非审批按钮返回 null */
export function parseApprovalButton(data) {
    if (!data || !data.startsWith(BTN_PREFIX))
        return null;
    const rest = data.slice(BTN_PREFIX.length);
    const m = /^(allow|deny):([A-Z0-9]{6})$/.exec(rest);
    if (!m)
        return null;
    return { act: m[1], code: m[2].toUpperCase() };
}
/** QQ 载体的一次性审批 answerer(dsh approval/request → QQ 按钮卡片 → interaction 回调结算) */
export class QqApprovalController {
    manager;
    sender;
    logger;
    timeoutMsProvider;
    pending = new Map();
    constructor(manager, sender, logger, 
    /** 超时(ms)提供器: 每次 request 现读, 支持 Web 设置热改生效 */
    timeoutMsProvider) {
        this.manager = manager;
        this.sender = sender;
        this.logger = logger;
        this.timeoutMsProvider = timeoutMsProvider;
    }
    /** 宿主 approval/request 处理器: 定位发起者会话并发 QQ 审批提示 */
    async request(req, next) {
        const record = this.manager.findByAgent(req.agent);
        if (!record)
            return next();
        if (req.signal?.aborted)
            return 'cancelled';
        const timeoutMs = Math.max(1000, this.timeoutMsProvider() || 120000);
        const reason = String(req.reason ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);
        const tool = String(req.toolName ?? req.callId ?? '未知工具');
        const deadlineAt = Date.now() + timeoutMs;
        // 一次性 6 位大写码(与 parseApprovalCommand 正则一致)
        let code = '';
        do {
            code = Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
        } while (this.pending.has(code));
        const outcome = new Promise((resolve) => {
            const timer = setTimeout(() => this.settle(code, 'rejected'), timeoutMs);
            const pending = {
                record, toolName: tool, reason, deadlineAt, resolve, timer, signal: req.signal,
            };
            if (req.signal) {
                pending.onAbort = () => this.settle(code, 'cancelled');
                req.signal.addEventListener('abort', pending.onAbort, { once: true });
            }
            this.pending.set(code, pending);
        });
        const seconds = Math.ceil(timeoutMs / 1000);
        const prompt = [
            '⚠️ **DSH 权限申请**',
            `工具：${tool}`,
            reason ? `原因：${reason}` : '',
            '',
            `仅本次有效，${seconds} 秒后自动拒绝。`,
            '',
            `🔑 验证码：\`${code}\``,
            '（点上方按钮最快; 按钮不可用时回复 `/approve ' + code + '` 或 `/deny ' + code + '`）',
        ].filter(Boolean).join('\n');
        try {
            // ① 按钮卡片优先: 按钮仅发起者本人可点(permission.specify_user_ids = 发起者 openid)
            const kb = approvalKeyboard(code);
            // ⚠️ 2026-09-28 修：原来只把【发起者本人】放进可点名单，导致"别人发起审批时主人点不动"。
            //   现在 = 发起者 + 主人白名单(config.groupAdmin.owners)。私聊场景仍不设限制（本就只有双方）。
            const ownerExtra = this.manager.adminOwners();
            const ownerIds = record.scope === 'group'
                ? Array.from(new Set([record.senderId, ...ownerExtra].filter((x) => typeof x === 'string' && x.length > 0)))
                : [];
            const kbRows = kb;
            for (const row of kbRows.content.rows) {
                for (const b of row.buttons) {
                    if (ownerIds.length > 0)
                        b.action.permission.specify_user_ids = ownerIds;
                }
            }
            const sent = await this.sender.sendMarkdownWithKeyboard(record.replyTarget, prompt, kb);
            if (sent !== undefined || ownerIds.length > 0) {
                // 有 keyboard 支持或明确成功 → 按钮模式
                this.logger.info(`QQ approval requested (button): code=${code} tool=${tool}`);
            }
        }
        catch (err) {
            // ② 按钮不可用(未开通/被拒) → 降级纯文本码
            this.logger.warn(`QQ approval button failed, fallback text: ${err instanceof Error ? err.message : String(err)}`);
            try {
                const textPrompt = [
                    '⚠️ **DSH 权限申请**',
                    `工具：${tool}`,
                    reason ? `原因：${reason}` : '',
                    '',
                    `允许本次操作：\`/approve ${code}\``,
                    `拒绝本次操作：\`/deny ${code}\``,
                    `仅本次有效，${seconds} 秒后自动拒绝。`,
                ].filter(Boolean).join('\n');
                await this.sender.sendMarkdown(record.replyTarget, textPrompt);
            }
            catch (err2) {
                // QQ 通道彻底不可用(按钮+文本都失败): 不再挂起 —— 清理本通道 pending 并 next() 交还宿主,
                // 让宿主 Web 审批/其它 answerer 接管, 审批不会因 QQ 失败而无人应答(双保险)。
                this.logger.error(`QQ approval prompt failed: ${err2 instanceof Error ? err2.message : String(err2)} (code=${code}, 已交还宿主 Web 兜底)`);
                const pend2 = this.pending.get(code);
                if (pend2) {
                    this.pending.delete(code);
                    clearTimeout(pend2.timer);
                    if (pend2.signal && pend2.onAbort) {
                        try {
                            pend2.signal.removeEventListener('abort', pend2.onAbort);
                        }
                        catch { /* 忽略 */ }
                    }
                }
                return next();
            }
        }
        return outcome;
    }
    /**
     * 入站拦截(挂在 bot.on('message') 最前): 命中 /approve|/deny CODE 则结算并消费消息。
     * @returns true = 消息已被审批逻辑消费(调用方不要再派发给 agent)
     */
    async handleInbound(msg, replyTarget) {
        const command = parseApprovalCommand(msg.content ?? '');
        if (!command)
            return false;
        const pending = this.pending.get(command.code);
        if (!pending) {
            try {
                await this.sender.sendMarkdown(replyTarget, '该权限申请不存在或已过期。');
            }
            catch { /* ignore */ }
            return true;
        }
        // 双校验: 必须是"任务发起者本人"且"同一会话"(群聊里其他成员看到 CODE 也不能批)
        const rec = pending.record;
        const sameSender = msg.senderId === rec.senderId;
        const samePeer = rec.scope === 'c2c'
            ? msg.kind === 'c2c' && msg.senderId === rec.peerId
            : msg.kind === 'group' && msg.groupOpenid === rec.peerId;
        if (!sameSender || !samePeer) {
            try {
                await this.sender.sendMarkdown(replyTarget, '你无权处理这项权限申请。');
            }
            catch { /* ignore */ }
            return true;
        }
        this.settleWithReceipt(command.code, command.outcome, pending, replyTarget);
        return true;
    }
    /**
     * 按钮回调结算(bot.on('interaction') 转发过来; type=11 消息按钮)。
     * 命中审批按钮 → 校验发起者本人 → settle + 回执。
     * @returns true = 已被审批消费(调用方无需其它处理)
     */
    async handleInteraction(event, replyTarget) {
        const e = event;
        if (e?.data?.type !== 11)
            return false;
        const parsed = parseApprovalButton(e.data.resolved?.button_data);
        if (!parsed)
            return false;
        const pending = this.pending.get(parsed.code);
        if (!pending) {
            try {
                await this.sender.sendMarkdown(replyTarget, '该权限申请不存在或已过期。');
            }
            catch { /* ignore */ }
            return true;
        }
        // 校验发起者本人: c2c 看 user_openid; group 看 group_member_openid
        const presserId = e.group_member_openid ?? e.user_openid ?? '';
        if (!presserId || presserId !== pending.record.senderId) {
            try {
                await this.sender.sendMarkdown(replyTarget, '你无权处理这项权限申请。');
            }
            catch { /* ignore */ }
            return true;
        }
        this.settleWithReceipt(parsed.code, parsed.act === 'allow' ? 'allowed-once' : 'rejected', pending, replyTarget);
        return true;
    }
    /** settle + 留痕注入 + QQ 回执(按钮与文本两条路共用) */
    settleWithReceipt(code, outcome, pending, replyTarget) {
        this.settle(code, outcome);
        // 留痕(不打扰, 正经注入): agent.inject 注入 plugin/notice —— 不唤醒、排队下个 step
        const toolName = pending.toolName || '';
        try {
            const agent = pending.record.agent;
            if (agent && typeof agent.inject === 'function') {
                const allowed = outcome === 'allowed-once';
                agent.inject(createUserMessage({
                    content: [{
                            type: 'text',
                            text: `主人已在 QQ ${allowed ? '批准' : '拒绝'}一次工具权限申请${toolName ? `(工具: ${toolName})` : ''}。`,
                        }],
                    source: {
                        // ⚠️ 2026-09-28 修：原为 `kind: 'plugin'` —— dsh 会话格式 V4 明确拒绝该值
                        //    （dsh-session-format-v3-to-v4/lib/index.js:126：
                        //      `value["kind"] === "plugin"` → 抛 "format v4 message requires a producer-owned source kind"），
                        //    表现为"主人点批准/拒绝后本轮运行失败"。
                        //    官方对第三方插件的默认 producer kind 是 `plugin:<插件名>`（见同文件 producerKind()）。
                        //    这里改为自有的 producer kind，并把已淘汰的 `plugin` 字段去掉。
                        kind: 'plugin:qqbot-approval',
                        form: 'notice',
                        summary: `主人${allowed ? '批准' : '拒绝'}了工具${toolName || ''}的权限申请`,
                    },
                }));
            }
        }
        catch { /* 注入失败不影响裁决 */ }
        try {
            void this.sender.sendMarkdown(replyTarget, outcome === 'allowed-once' ? '✅ 已允许本次操作。' : '❌ 已拒绝本次操作。');
        }
        catch { /* ignore */ }
    }
    /** 结算: 清定时器/中止监听/pending 项并 resolve */
    settle(code, outcome) {
        const pending = this.pending.get(code);
        if (!pending)
            return;
        this.pending.delete(code);
        clearTimeout(pending.timer);
        if (pending.signal && pending.onAbort) {
            try {
                pending.signal.removeEventListener('abort', pending.onAbort);
            }
            catch { /* ignore */ }
        }
        pending.resolve(outcome);
    }
    /** Web 浮层拉取待办列表(去敏) */
    listPendingForWeb() {
        const out = [];
        for (const [code, p] of this.pending) {
            out.push({
                code,
                toolName: p.toolName ?? '',
                reason: p.reason ?? '',
                deadlineAt: p.deadlineAt,
                ownerHint: p.record.scope === 'group'
                    ? `群 ${String(p.record.peerId ?? '').slice(0, 12)}`
                    : `私聊 ${String(p.record.senderId ?? '').slice(0, 12)}`,
            });
        }
        return out.sort((a, b) => a.deadlineAt - b.deadlineAt);
    }
    /** Web 浮层点按钮: 按 code 结算(与 QQ 按钮/文本码共用 pending, 先到先得) */
    decideByWeb(code, act) {
        const pending = this.pending.get(code);
        if (!pending)
            return { ok: false, msg: '该申请不存在或已过期' };
        this.settleWithReceipt(code, act === 'allow' ? 'allowed-once' : 'rejected', pending, pending.record.replyTarget);
        return { ok: true, msg: act === 'allow' ? '已允许本次操作' : '已拒绝本次操作' };
    }
    dispose() {
        for (const code of [...this.pending.keys()])
            this.settle(code, 'cancelled');
    }
}
/**
 * 生成挂在插件 apply ctx 的审批监听(ACP 模式): 非本 bot agent / 未启用 → next() 快速放行。
 * ⚠️ 2026-09-11 多实例修复: 原实现读模块级单例 dispatch(被多实例互相覆盖 → 审批串到别的实例的
 * controller)。改为 handler 参数=每实例闭包捕获自己的 manager/controller(ownership 判断在各实例
 * 自己的 handler 里)。无参调用保留单实例兜底(读注册表唯一项)。
 */
export function makeApprovalListener(handler) {
    return ((req, next) => {
        diagApprov('listener fired');
        if (handler)
            return handler(req, next);
        const only = approvalDispatches.values().next().value;
        if (!only)
            return next();
        return only(req, next);
    });
}
/** 按 ns 的 dispatch 注册表(2026-09-11: 原单例 setApprovalDispatch 废弃为按 ns 注册, 兼容旧调用) */
const approvalDispatches = new Map();
/** bootstrap 注册实际处理器(按实例 ns; 传 undefined 可卸载) */
export function setApprovalDispatch(ns, fn) {
    if (fn)
        approvalDispatches.set(ns, fn);
    else
        approvalDispatches.delete(ns);
}
/** 审批诊断落盘(排查 QQ 通道未接管): ~/.dsh/qq-approval-diag.log */
const DIAG_FILE = (typeof process !== 'undefined' ? ((process.env.USERPROFILE || process.env.HOME || '') + '/.dsh/qq-approval-diag.log') : '').replace(/\\/g, '/');
function diagApprov(line) {
    try {
        appendFileSync(DIAG_FILE, '[' + new Date().toISOString() + '] ' + line + '\n');
    }
    catch { /* 忽略 */ }
}
// ── 按实例(ns)注册的审批控制器注册表 —— Web 审批浮层(settings-host 同源路由)经此读写 ──
const approvalControllers = new Map();
export function registerApprovalController(ns, c) {
    if (c)
        approvalControllers.set(ns, c);
    else
        approvalControllers.delete(ns);
}
/** 汇总所有实例的待办(web 浮层拉取) */
export function listAllPendingWeb() {
    const out = [];
    for (const [ns, c] of approvalControllers) {
        for (const p of c.listPendingForWeb())
            out.push({ ns, ...p });
    }
    return out.sort((a, b) => a.deadlineAt - b.deadlineAt);
}
/** 跨实例结算: 返回 {ok, ns?, msg} */
export function decideByWebAny(code, act) {
    for (const [ns, c] of approvalControllers) {
        const r = c.decideByWeb(code, act);
        if (r.ok)
            return { ok: true, ns, msg: r.msg };
    }
    return { ok: false, msg: '该申请不存在或已过期' };
}
//# sourceMappingURL=qq-approval.js.map