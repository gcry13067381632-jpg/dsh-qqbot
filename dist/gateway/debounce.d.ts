/**
 * debounce.ts — 延迟聚合回复(2026-09-05 新增; 与"群冷却"融合的终版)
 *
 * 要解决的问题: 用户连发 N 句, AI 只回第一句 / 上下文顺序倒置。
 *
 * 链路位置: 插在群冷却中间件**之前**(middleware-setup 第6.6步)。所有群消息(普通/@)与私聊
 * 先聚合进 per-peer 窗口(peerKey = group:<groupOpenid> | c2c:<senderId>), 冷却中间件收不到被吞的消息。
 *
 * 窗口/触发: 有新消息(按 QQ 服务器时间戳更新)就重置计时; 静默 X 秒 或 攒满 Y 条 → 尝试派发。
 *
 * 派发判定(与群冷却融合):
 *  - 窗口含 @: @ 无视冷却, 随时整批派发(只多等 debounce 静默)。
 *  - 群普通(无@): 距上次普通派发不足 freeIntervalSec → 窗口保留继续攒, 冷却结束再整批
 *    按服务器时间序一次综合回(两次"批派发"仍 ≥60s, 防刷屏语义保留; 冷却是 60s 级的、聚合是 3s 级的, 不再打架)。
 *  - 私聊: 无冷却, 直接派发。
 *
 * 派发内容(防倒序): 以 store(mediaHistoryBuffer 记录的全量, 含被吞消息)为权威,
 * 与窗口合并去重后按服务器时间戳升序: current = 时间序最后一条; 窗口内更早的 @ 消息在 history 里补
 * " (@you)" 标注(与 current 同款 @ 事实标注, 回不回由 AI 按守则判, 插件不注入回复指令);
 * 其余按序进 [Chat history]。私聊无 store → 窗口文本按序拼接+合并附件成合成消息直连。
 *
 * 斜杠命令(以 / 开头)不聚合直放行: 保 /approve /bot-stop 等命令的即时性。
 * debounce.enabled=false 或 @ 秒回(mentionDelayed=false) → 直放行, 交回下方群冷却中间件与既有链路。
 *
 * 配置: config.behavior.debounce { enabled, silenceSec, maxMsgs, mentionDelayed } + behavior.freeIntervalSec, 每次现读(live 热更)。
 * ⚠️ 本地手改功能: 同步纪律同 middleware-setup.ts 内群冷却中间件(改完保持 src 与部署 dist 一致)。
 */
import type { Middleware } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.js';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';
export declare function markTurnAborted(sessionId: string): void;
export declare function injectSynthetic(scope: 'group' | 'c2c', peerId: string, text: string, opts?: {
    senderId?: string;
    senderName?: string;
    wasMentioned?: boolean;
}, owner?: unknown): boolean;
export declare function debounceLayer(config: ImQQBotConfig, manager: SessionManager, logger: Logger, cooldownAt: Map<string, number>): Middleware;
//# sourceMappingURL=debounce.d.ts.map