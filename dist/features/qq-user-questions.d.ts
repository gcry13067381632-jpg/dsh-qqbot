/**
 * qq-user-questions.ts — QQ 远程提问: 把 AI 的 ask_user_question 变成 QQ 按钮卡片
 *
 * 机制(与 QQ 远程审批同款): 宿主 ctx 上 `user-questions/request` 是 Agent 作用域的
 * waterfall 事件(dsh-user-questions/lib: UserQuestionService.ask → waterfall 派发)。
 * Web UI 答案器在宿主引导期注册(dsh-client-ui-user-questions), 会在浏览器连着且
 * agent 有 GUI 会话时先 claim —— 所以本监听必须 { prepend: true } 抢在它前面。
 *
 * 形状(@deepseek-ai/dsh-user-questions/types):
 *   request = { questions: [{ id, question, detail?, header?, options?:[{label,...}], multiSelect? }], agent?, signal? }
 *   answer   = { answers: [{ id, selected: string[], custom? }] }
 *
 * 2026-09-11 增强(主人需求, 本轮新增):
 *   ① 按钮 label 带字母前缀(A. / B. / …), 卡片正文列出**全部**选项字母表;
 *   ② **文字选项兜底**: 待答期间直接回文字也算回答 ——
 *        回 `A` / `2`            → 选第 1 / 第 2 个选项(字母与序号都认);
 *        回 `A,C` / `1 3` / `选 1 3` → 多选;
 *        回选项原文(与某个 label 完全一致) → 选它;
 *        回**其它任意文字**       → 作为自由回答(custom)透传给 AI(answers[].custom);
 *   ③ 多问题(questions > 1): 依次发卡, 回答时可用 `#2 B` 指定第 2 问;
 *   ④ 选项超过按钮上限(QQ 卡片最多 5 行 → 5 个可点按钮)时, 卡片正文照样列全, 靠文字兜底补齐;
 *   ⑤ 按钮卡片发送失败时不再放弃提问 —— 退化成纯文字选项清单, pending 保留(文字兜底能收答案)。
 *
 * 2026-09-24 增强(主人需求: 卡片要能"指定 openid 或昵称匹配"):
 *   卡片可点人既认 `<@32位openid>`、也认 **`<@群友昵称>`** —— 昵称会用本地群成员台账
 *   (`{dataRoot}/表情包/group-members.jsonl`, 在群里发过言/申请过入群的人)解析成 openid;
 *   没写 `<@...>` 标注、但 question/header 文本里唯一命中某位成员昵称时同样按点名处理。
 *   解析不到就沿用老逻辑(最近被 @ 的人 → 消息发送者壳 → 会话发起者)。
 */
import type { ReplyTarget } from '@tencent-connect/qqbot-nodejs';
import type { QQBotSender } from '../transport/outbound-buffer.js';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';
interface PendingItem {
    qid: string;
    question: string;
    header: string;
    detail: string;
    opts: Array<{
        label: string;
    }>;
    /** 发起者 openid(群=member_openid, c2c=user_openid); 回调/文字兜底都校验, 防止别人代答 */
    ownerId: string;
    /**
     * 抢答许可(2026-09-30 主人定): 卡片上多一个「🙋 我来回答」按钮，
     * **所有人都能点**，点一次即把回答权**转移**给点的人（`ownerId` 被改写），
     * 之后原 owner 与其他人再点都会被拒。
     * 用途：机器人把问题问错人 / 被问的人不在 / 想让"谁先看到谁答"的场景。
     */
    claimable?: boolean;
    /** 是否已被抢走（抢到后置 true，第二个人再点会被明确拒绝） */
    claimed?: boolean;
    /** 抢答成功者 openid（仅用于回执文案「已被 XXX 抢到」） */
    claimedBy?: string;
    /** 是否多选(宿主给的 multiSelect) */
    multiSelect: boolean;
    /** 会话键 `scope:peerId`: 文字兜底据此判断"这条消息是不是在回答本问题" */
    peerKey: string;
    /** 同批问题共享的组(多问题时按组收集全部答案后统一 resolve) */
    group: PendingGroup;
    /** 本问题在该批中的序号(1 起; 文字兜底用 `#2 B` 指定) */
    index: number;
    /** 该批问题总数 */
    total: number;
    deadlineAt: number;
}
/** 一批提问(一次 ask_user_question 的全部问题) —— 全部答完/超时后统一 resolve 宿主 */
interface PendingGroup {
    /** 该批问题的 qid 顺序(resolve 时按此顺序出答案) */
    qids: string[];
    /** qid → 已收答案 */
    answers: Map<string, {
        selected: string[];
        custom?: string;
    }>;
    resolve: (ans: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
    /** 该批占用的 pending key(收尾清理用) */
    keys: string[];
    signal?: AbortSignal;
    onAbort?: () => void;
}
/** Web 浮层看到的待办提问(去敏) */
export interface WebPendingQuestion {
    /** 唯一键 = qid:token(web 结算回传用) */
    key: string;
    question: string;
    header: string;
    detail: string;
    options: Array<{
        label: string;
    }>;
    deadlineAt: number;
}
/** 昵称 → openid 的解析器(群聊用; 数据源=本地群成员台账) */
export interface QuestionOwnerResolver {
    /** 昵称 → openid(命中才返回; 同名取最近发言者, 包含匹配要求唯一) */
    byName(name: string): string | null;
    /** 整段文本里唯一命中的成员昵称 → openid(没有任何 <@...> 标注时兜底用) */
    byText(text: string): string | null;
}
/** 文字兜底的解析结果: 命中选项(可能多选) 或 自由文本 */
export type ParsedQuestionAnswer = {
    kind: 'option';
    indices: number[];
    labels: string[];
} | {
    kind: 'custom';
    text: string;
};
/**
 * 把一条**文字回复**解析成对某问题的答案(2026-09-11 主人定的文字兜底):
 *   - 先去口语前缀(`选`/`选择`/`选：` 等);
 *   - 用 `,`/`，`/空格/`、`/`;` 切 token;
 *   - token 命中规则: ①单个字母 A-Z → 第 N 个选项 ②纯数字 1-26 → 第 N 个选项
 *     ③与该问题某个选项 label 完全相同(去空白/忽略大小写) → 那个选项;
 *   - 所有 token 都命中 → option(非多选时只取第一个);
 *   - 否则(含"自定义:xxx"这类) → custom, 原文透传给 AI。
 * @returns null = 这条不该当成答案(空文本)
 */
export declare function parseQuestionAnswer(raw: string, item: Pick<PendingItem, 'opts' | 'multiSelect'>): ParsedQuestionAnswer | null;
export declare class QqUserQuestionsController {
    private readonly manager;
    private readonly sender;
    private readonly logger;
    private readonly timeoutMsProvider;
    private readonly pending;
    constructor(manager: SessionManager, sender: QQBotSender, logger: Logger, timeoutMsProvider: () => number);
    /**
     * 群成员昵称 → openid 解析器(2026-09-24 主人需求: 提问卡片支持"昵称匹配"指定收件人)。
     * 数据源 = 本地群成员台账 `{dataRoot}/表情包/group-members.jsonl`(在群里发过言/申请过入群的人);
     * 群聊之外、或台账里查不到 → 返回 undefined, 调用方按老逻辑回落(会话发起者)。
     * ⚠️ 从没发过言的人查不到(官方群成员列表接口未开放) —— 那种情况请照旧写 <@32位openid>。
     */
    private ownerResolverFor;
    /**
     * 宿主 user-questions/request 处理器。只 claim"会话可定位 + 每个问题都带选项"的场景;
     * 其余(无会话/无选项/选项过多/问题过多) → next() 交回宿主(Web UI 或原样)。
     * 多问题时依次发卡, 回答用 `#2 B` 指定; 全部答完或超时后一起回给宿主。
     */
    request(req: {
        questions?: Array<Record<string, unknown>>;
        agent?: unknown;
        signal?: AbortSignal;
    }, next: () => Promise<unknown>): Promise<unknown>;
    /**
     * 入站文字兜底(2026-09-11 主人需求): 待答提问期间, 发起者发来的文字也算回答 ——
     *   命中选项(字母/序号/选项原文, 支持多选) → 选中结算;
     *   其它文字 → 作为自由回答(custom)透传给 AI。
     * 非本会话/非发起者/斜杠命令 → 不消费(交回正常入站链)。
     * @returns true = 消息已被提问逻辑消费(调用方不要再派发给 agent)
     */
    handleInbound(msg: {
        kind?: string;
        senderId?: string;
        content?: string;
        groupOpenid?: string;
    }, replyTarget: ReplyTarget): Promise<boolean>;
    /**
     * 斜杠命令兜底入口(`/答` / `/ans`, 2026-09-11 主人定): 与 handleInbound 同一套解析与结算,
     * 但**不依赖消息在链上的位置** —— 命令层在 @门控之后、延迟聚合之上就执行完并 ctx.stop。
     * 为什么必须有它: 裸文字作答在群里被 mentionGate 拦下, 私聊/群消息又被 debounce 聚合层
     * 直接吞进 agent(那一层自己调 transport.handleInbound, 绕过 message 处理器), 实测无效;
     * 而以 `/` 开头的消息被 debounce 直放行(见 gateway/debounce.ts), 命令层随即处理。
     * @returns ok=false 时 msg 是给用户看的提示(命令层原样回执)
     */
    answerByText(args: {
        scope: 'c2c' | 'group';
        peerId: string;
        senderId?: string;
        text: string;
    }): {
        ok: boolean;
        msg: string;
    };
    /** interaction 回调: data = q:<qid>:<token>:<idx> → 按选项 label 组 answer; 仅发起者本人可答 */
    handleInteraction(event: unknown, replyTarget: ReplyTarget): Promise<boolean>;
    /** 回执(QQ 直发, 失败不影响结算) */
    private receipt;
    /** 结算单个问题: 写进组, 该批全部答完 → 一次交回宿主 */
    private settleAnswer;
    /**
     * 该批提问收尾: 清定时器/监听 + 清理未答项的 pending + 按 qid 顺序组装宿主 answer。
     * 超时/取消时未答的问题给空答案(selected: []) —— 与宿主原语义一致。
     */
    private finishGroup;
    /** Web 浮层拉取待办问题列表 */
    listPendingForWeb(): WebPendingQuestion[];
    /** Web 浮层点选项: key + 选项下标 → 与 QQ 按钮同源结算(先到先得) */
    decideByWeb(key: string, optIdx: number): {
        ok: boolean;
        msg: string;
    };
    dispose(): void;
}
export declare function registerQuestionController(ns: string, c: QqUserQuestionsController | undefined): void;
/** 汇总所有实例的待办提问 */
export declare function listAllPendingQuestionsWeb(): Array<WebPendingQuestion & {
    ns: string;
}>;
/** 跨实例结算提问 */
export declare function decideQuestionByWebAny(key: string, optIdx: number): {
    ok: boolean;
    ns?: string;
    msg: string;
};
/**
 * 斜杠命令(`/答` / `/ans`)的结算入口: 按实例 ns 找到提问控制器 → 把文字当答案结算(2026-09-11 主人定)。
 * 命令层在 @门控之后、延迟聚合之上执行, 是**唯一可靠**的用户文字作答通道
 * (裸文字在群里被 mentionGate 拦、私聊被 debounce 聚合层直接吞进 agent, 实测无效)。
 */
export declare function answerPendingQuestionByText(args: {
    ns?: string;
    scope: 'c2c' | 'group';
    peerId: string;
    senderId?: string;
    text: string;
}): {
    ok: boolean;
    msg: string;
};
export {};
//# sourceMappingURL=qq-user-questions.d.ts.map