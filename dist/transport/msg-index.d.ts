/** 每个 peer 台账上限(超出丢最旧) */
export declare const MSG_INDEX_MAX = 500;
export interface MsgIndexEntry {
    /** 短消息号(索引), 如 0913a */
    i: string;
    /** 完整 QQ msg_id(ROBOT1.0_…) */
    id: string;
    /** 登记时间 ISO(排查用) */
    t: string;
    /** 发送者 openid(排查用) */
    s?: string;
    /** 发送者昵称(排查用) */
    n?: string;
}
/** peer 文件夹名(scope + 目标 openid; openid 本身是十六进制安全, 兜底清洗特殊字符) */
export declare function msgIndexPeerKey(scope: string, targetId: string): string;
/** 台账文件路径: {dataRoot}/.qqbot/msg-index/{peer}/refs.json */
export declare function msgIndexFile(dataRoot: string, scope: string, targetId: string): string;
/**
 * 登记一条入站消息, 返回短消息号(空 msgId → 返回 '')。
 * 同一 msg_id 重复登记 → 复用原短号(防重试/多中间件重复触发)。
 */
export declare function registerMsgIndex(dataRoot: string, scope: string, targetId: string, msgId: string, meta?: {
    senderId?: string;
    senderName?: string;
}): string;
/** 按短消息号查完整 msg_id(大小写不敏感); 查不到返回 undefined */
export declare function resolveMsgIndex(dataRoot: string, scope: string, targetId: string, index: string): string | undefined;
//# sourceMappingURL=msg-index.d.ts.map