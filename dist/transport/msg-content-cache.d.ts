/** 台账里存的一条：被引用消息的文本 + 图片本地路径 */
export interface MsgContent {
    /** 文本（截断） */
    t?: string;
    /** 图片**本地路径**（入站时由 image-path-cache 解析得到；AI 能直接读） */
    imgs?: string[];
}
/**
 * 记一条：这条消息（msgIdx）的文本与图片本地路径。
 * 之后有人**引用它**时，就能靠 `refKey = msgIdx` 回查到"被引用的到底是哪张图"。
 */
export declare function rememberMsgContent(dataRoot: string, peerKey: string, msgIdx: string, rec: MsgContent): void;
/** 回查：这条被引用消息（msgIdx）我们记过什么 */
export declare function lookupMsgContent(dataRoot: string, peerKey: string, msgIdx: string): MsgContent | undefined;
//# sourceMappingURL=msg-content-cache.d.ts.map