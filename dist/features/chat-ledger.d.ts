import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
export interface KnownChatLine {
    ts: number;
    scope: 'group' | 'c2c';
    id: string;
    name?: string;
}
/** 群成员行(本地兜底名单: 官方成员列表未开放, 用"见过的发言者"近似) */
export interface KnownGroupMember {
    ts: number;
    gid: string;
    mid: string;
    name?: string;
}
/** 台账文件路径(与图库同 dataDir, host 侧可经 sticker store 推导) */
export declare function ledgerPath(dataDir: string): string;
/** 群成员台账路径(同 dataDir) */
export declare function groupMembersPath(dataDir: string): string;
/** 由 dsh-qqbot 侧写入(中间件); host 侧只读聚合 */
export declare function appendLedger(dataDir: string, line: KnownChatLine): void;
/** 由 dsh-qqbot 侧写入一条"群成员发言"(中间件); host 侧读聚合出可禁言名单 */
export declare function appendGroupMember(dataDir: string, line: KnownGroupMember): void;
/** 读某群的本地成员清单(聚合: 每成员保留最近昵称/最近时间/发言次数, 按最近发言倒序) */
export declare function readGroupMembers(dataDir: string, gid?: string): Array<{
    gid: string;
    mid: string;
    name?: string;
    lastSeen: number;
    count: number;
}>;
/** host 侧读台账文件(不存在/坏行容错), 返回按 ts 升序的行 */
export declare function readLedger(dataDir: string): KnownChatLine[];
/**
 * 聚合"最近聊过的对象"(供下拉): 每对象保留最近 ts/最近昵称 + 消息数。
 * c2c 优先展示昵称; group 无群名, name=该群最近发言者昵称。
 */
export declare function aggregateKnownChats(lines: KnownChatLine[], limit?: number): Array<{
    scope: 'group' | 'c2c';
    id: string;
    name?: string;
    lastSeen: number;
    count: number;
}>;
/** 台账文件大小(给 host 状态用; 不存在返回 0) */
export declare function ledgerSize(dataDir: string): number;
/**
 * 移除某群某成员的本地记录(成员已退群/禁言无效时调用, 保持本地名单干净)。
 * 重写文件剔除该 gid+mid 的所有行; 文件不存在/无匹配则不动。
 */
export declare function removeGroupMember(dataDir: string, gid: string, mid: string): void;
/** mid → 昵称（查群成员台账；查不到返回 undefined） */
export declare function lookupGroupMemberName(dataDir: string, gid: string, mid: string): string | undefined;
/**
 * 把正文里 @ **别人**的 `<@openid>` 换成 `@昵称`。
 *
 * 2026-10-01 主人实测：「别人 @ 别人怎么没转换成昵称，依然是 id」——
 *   群消息里 @ 别人时 content 带 32 位 openid，原样喂给 AI 谁也看不出 @ 的是谁（而且吃 token）。
 *   · 昵称查**群成员台账**（在群里发过言的人都有）；查不到退化成 `@` + id 前 6 位（与 dock 侧 chatDisplayClean 同口径）。
 *   · **省 token**：`<@07B470BDA5052489D2D0532C2CC2A2EB>`(35 字符) → `@难崩`(3 字符)。
 *   · @**我自己**的标记早被 `replaceBotMention` 换成了 `@bot`，这里不会再碰到。
 *   · 只在群聊（有 gid）生效；查不到台账就不动（宁可留 id 也别瞎猜）。
 */
export declare function resolveMentionNames(text: string, dataDir: string, gid?: string): string;
/** 中间件: 记录见过的群/私聊 + 群内发言成员(放 mentionGate 之前, 未@消息也流经) */
export declare function chatLedgerRecorder(dataDir: string): (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;
//# sourceMappingURL=chat-ledger.d.ts.map