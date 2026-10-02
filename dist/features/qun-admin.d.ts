export interface QunCookie {
    uin: string;
    skey: string;
    p_skey?: string;
    at?: number;
}
/** QQ 登录令牌算法（ptqrtoken） */
export declare function hash33(s: string): number;
/** 业务接口签名（bkn） */
export declare function getBkn(skey: string): number;
export declare function qunCookieFile(dataRoot: string): string;
export declare function loadQunCookie(dataRoot: string): QunCookie | null;
export declare function saveQunCookie(dataRoot: string, c: QunCookie): void;
export declare function clearQunCookie(dataRoot: string): void;
/**
 * 第一步：拿到二维码 PNG（存盘），返回路径给上层发出去。
 * 之后用 qunLoginPoll 轮询扫码结果。
 */
export declare function qunLoginStart(dataRoot: string): Promise<{
    ok: boolean;
    msg: string;
    qrPath?: string;
}>;
/**
 * 第二步：轮询扫码结果（最多等 budgetMs，默认 20 秒一轮，避免工具调用卡太久）。
 * 返回 done=true 表示已登录并写好了凭据。
 */
export declare function qunLoginPoll(dataRoot: string, budgetMs?: number): Promise<{
    ok: boolean;
    done: boolean;
    msg: string;
}>;
export declare function qunLoginPending(dataRoot: string): boolean;
export interface QunGroup {
    gc: string;
    gn: string;
    role: '我创建' | '我管理';
}
export declare function qunGroups(dataRoot: string): Promise<QunGroup[]>;
/** 群号直通；群名做模糊匹配（多个命中就报错让人用群号） */
export declare function qunResolveGc(dataRoot: string, gcOrName: string): Promise<{
    ok: true;
    gc: string;
    gn: string;
} | {
    ok: false;
    msg: string;
}>;
export interface QunMember {
    uin: string;
    nick: string;
    role?: number;
}
/**
 * 查群成员。
 * keyword 给 uin → 服务端精确查（快且准）；给昵称 → 先试服务端 key，不行再全量分页本地过滤。
 * 返回 count 是群总人数（服务端给的）。
 */
export declare function qunMembers(dataRoot: string, gc: string, keyword?: string): Promise<{
    ok: boolean;
    count?: number;
    members: QunMember[];
    note?: string;
}>;
/** 按 uin 精确存在性判断（踢完验证用，也最快） */
export declare function qunHasMember(dataRoot: string, gc: string, uin: string): Promise<boolean>;
/** 踢人（可多个）。返回逐条结果。 */
export declare function qunKick(dataRoot: string, gc: string, uins: string[]): Promise<Array<{
    uin: string;
    ec: number;
    msg: string;
}>>;
//# sourceMappingURL=qun-admin.d.ts.map