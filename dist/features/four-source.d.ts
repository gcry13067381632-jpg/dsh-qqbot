import type { Logger } from '../types.js';
/**
 * **把握下限**（2026-09-14 主人要求"重新添加样本测试一下"之后，用 `m1/judge-eval.mjs` 实测定的）。
 *
 * 只有 margin 门槛是不够的：margin 大只说明"两组之间有个赢家"，不说明"这个赢家靠谱" ——
 * 实测把 141 字热情卖萌正文判「冷」（best 0.583 / margin 0.033，两条门槛都过）就是这么来的。
 * `best` 是**与最像的那条例句的相似度**：低于它 = 这个句式在库里根本没同类，
 * 属于"地图外"，此时给的标签是瞎猜 → 一律**弃权**（设计稿："不确定就不动分"）。
 *
 * 定标数据（41 条倾向 / 30 条情绪，见 m1/eval/）：
 *   · 倾向 best ≥ 0.44 → 真实误判案例 t-53（best 0.420 / margin 0.010，**双擦线**过关）
 *     被正确地**弃权**掉；再往上卡准确率不再涨，只多弃权 → 取 0.44。
 *     教训：擦线的判定比"判不出来"危险得多 —— 那条擦线判定白扣了她对主人的好感（−0.024）。
 *   · 情绪 best ≥ 0.45 → 已判定 28 条里对 26 条 = **92.9%**（弃权 6.7%）；
 *     卡到 0.50 反而掉到 92.3%（把对的也卡掉了）。
 * ⚠️ 改样本库后**必须复跑评测**再动这两个数，别凭感觉调。
 */
export declare const TENDENCY_MIN_BEST = 0.44;
/**
 * **英文**倾向判定的门槛，比中文更严（2026-09-14 主人拍板"1、2 都做"）。
 *
 * 起因：她有一轮**用英文思考**，通篇在"权衡要不要发图、最后决定克制一点"
 *   （"Should I respond? … to avoid over-doing, I'll respond with a short text … I could send 0"），
 *   英文库却判成『拒绝』(best 0.613 / margin 0.011) → 配上暖正文走了"让步"（+0.3）。
 *   那次歪打正着加了分，**但要是正文是冷的就成了"重罚"冤扣** —— 隐患必须堵。
 *
 * 两道防线：
 *   ① 补样本：英文任务档加了 8 条"犹豫 / 克制 / 决定简化"（治本；实测那条的 margin 从 0.011 → 0.001）；
 *   ② 加严门槛（本条）：英文库样本更少、也没像中文那样被反复校准。
 *      实测两条误判落在 best 0.617 / 0.645，而正常判定在 0.70+ → 取 **0.65**：
 *      把误判挡在门外，又不误伤正常判定。拿不准就**弃权、不动分**。
 * ⚠️ 等英文评测样本攒够了，这个数要重新定标。
 */
export declare const TENDENCY_MIN_BEST_EN = 0.65;
export declare const EMO_MIN_BEST = 0.45;
/**
 * 工具调用参数要不要参与「内心倾向」。
 *
 * 2026-09-14 上午：一度关掉（`false`），原因是 `reply_gate` 的 `{"reason":"…，需回应"}`
 *   被判成「拒绝」→ 配上正文冷 → 好感度扣在无辜群友头上（那次同时修了归因错位）。
 * 2026-09-14 晚：主人拍板**恢复**（`true`）—— 理由很硬：
 *   她**常用英文思考**，英文库弱（门槛高、容易弃权），而**工具参数里往往写着中文实意**
 *   （`list_stickers · 安心 放心 摸摸 没事`、"可俏皮接梗"、"先记一下这个待办"…），
 *   把这块丢了等于白白放弃最好的中文素材。
 * 配合下面的"剔除英文"（judgeTextOf）：**英文思考 + 中文工具参数 → 照样能用中文库判**。
 * ⚠️ 当初那个误判案例已进评测集（t-12），改样本库/门槛时它会报警。
 */
export declare const TENDENCY_INCLUDE_TOOL = true;
/** 剔掉英文单词，只留中文（拉丁字母序列连同紧邻空格一起去掉） */
export declare function stripEnglish(text: string): string;
/**
 * 判定用文本（2026-09-14 主人："可以弄一个剔除全部英文文本的做法？"）。
 *
 * 她的思考常中英混杂，甚至整段英文 —— 而英文库样本少、门槛严，动不动就弃权。
 * 但同一段里**中文部分往往带着实意**（"Let me respond warmly" 之外还有"人家接梗""回应一下"）。
 * 所以：**能拿出足够汉字就只拿中文去判**（走中文库，它才是被反复校准过的那条线）；
 * 汉字太少（纯英文思考）才退回原文，按语言走英文库 / 混合则跳过。
 */
export declare function judgeTextOf(inner: string): string;
/** 倾向标签：关键词优先（接梗 = 亲近），否则走 kNN + 把握门槛。
 *  **导出**是为了让评测脚本走同一套逻辑 —— 不然"评测跑 kNN 原始结果、线上跑关键词+门槛"两边对不上。 */
export declare function tendencyLabel(r: {
    label: string;
    best: number;
    margin: number;
    lang?: string;
} | undefined, text: string): string | undefined;
/** 情绪侧同样要过把握门槛（不然低把握的"冷"也会去扣好感度）—— 导出给入站侧一起用 */
export declare function confidentEmo(r: {
    label: string;
    best: number;
    margin: number;
} | undefined): string | undefined;
export interface TurnSignalEntry {
    scope?: string;
    peerId?: string;
    turn?: number;
    step?: number;
    /** 思考字数（原文里现成的，直接用，省一次统计） */
    thinkChars?: number;
    /** 模型上报的思考 token */
    thinkTokens?: number;
    /** 正文本次发出的字数 */
    replyChars?: number;
    /** 从工具调用参数里抽出的**中文内心话**字数（未发给群友看的部分） */
    toolChars?: number;
    /** 好感度台账键（`person:<openid>`；给了才更新好感度） */
    attitudeKey?: string;
    /** 好感度台账里记的名字 */
    attitudeName?: string;
    /** 群友这一轮的语气（暖/冷/中性）—— 好感度"对比放大"用（不领情 / 想讨好） */
    userEmo?: string;
}
export interface TurnSignalText {
    /** 本回合的思考原文（可为空：纯工具步没有思考块） */
    think?: string;
    /**
     * 本回合**工具调用参数里的中文**（未给群友看 → 按主人口径也算内心活动）。
     *
     * 2026-09-14 主人定："**工具里的判断也是思考里的判断，没有给群友看到的都算是内心活动**"。
     * 起因：另一只（姐姐型）很多轮**没有 reasoning 块**，但它的 `reply_gate` 参数里写着
     * 「面包乙调侃我傲娇，可俏皮接梗」——那就是它的内心，白白丢了可惜。
     * ⚠️ 它与 reasoning **合并后一起判倾向**（同一份内心），记录里仍分开记字数便于观察。
     */
    tool?: string;
    /** 本回合真正发给群友的正文（text 块拼接） */
    reply?: string;
    modelDir?: string;
    logger?: Logger;
}
/**
 * 从工具调用的 arguments(JSON 字符串)里抽出"中文内心话"。
 *
 * 只收**基本全是中文**的字符串（汉字 ≥4 且 汉字/(汉字+拉丁数字) ≥ 0.8）——
 *   这样链接、路径、代码、字段名会被自动挡掉，留下的就是"她在说话"的那部分。
 * 解析失败/没有符合的 → 空串（调用方照常走）。
 */
export declare function extractInnerText(rawArgs: string): string;
/**
 * 记一回合的四源标量（异步：要跑本地小模型；调用方 `void` 掉，别阻塞发消息）。
 *
 * 不抛错：任何一步失败都只是"这一行少几个字段"，绝不影响回复。
 *
 * ⚠️ 三次校准（都是对着实测数据定的）：
 *   ① **空回合不记**（2026-09-13）：纯工具步 / 她选择"静默"的回合思考与正文都是空的，
 *      记进去只有一行噪声（实测 15 行里 10 行是空的）。
 *   ② **思考侧不判情绪**（2026-09-13）：实测 5 条有思考的样本里 4 条被判成"骂"，
 *      而原文是"群友在讨论游戏，与我无关"这种中性叙述 —— 暖/冷库本来就不适合判她的内心。
 *   ③ **正文侧不判倾向**（2026-09-14 主人拍板："倾向本来就是标的思考，正文就是看情绪的"）：
 *      实测正文侧的"拒绝"全是噪声 —— 连一份**统计报告**（通篇"拒绝"二字）都被判成"拒绝"档，
 *      因为小模型判的是**字面像不像**、不是**意图**。分工定死：
 *        · 思考 → 倾向（亲近 / 拒绝 / 任务）—— 判的是"她心里怎么想"
 *        · 正文 → 情绪（夸 / 骂 / 中性）—— 判的是"她话说出来是什么味道"
 *      这也正是 §11 的分工：语言情绪库判对方/正文，倾向库判她自己/内心；
 *      而"内心拒绝 + 正文仍照顾 = 让步"要靠**两侧分开**才读得出来。
 */
export declare function noteTurnSignals(dataRoot: string, entry: TurnSignalEntry, text?: TurnSignalText): Promise<void>;
/**
 * 好感度（A 值）**按回合结算**（2026-09-14 修）。
 *
 * 由出站在 `turn/end` 时调用一次，传入**整个回合**拼起来的思考与正文：
 *   · 内心 = 本回合全部 step 的 reasoning 拼接（默认不含工具参数，见 TENDENCY_INCLUDE_TOOL）
 *   · 表面 = 本回合全部 step 真正发出去的正文拼接
 * 这样"内心拒绝 + 正文仍照顾 = 让步"才读得出来 —— 拆成单步读，前半段只有内心没有正文，
 * 必然落进"重罚"分支（这正是当时把无辜群友扣 −0.12 的一半原因）。
 *
 * 键（`person:<openid>`）与出站时记下的"这一轮在跟谁说话"一致；没有对象就跳过。
 */
export declare function applyTurnAttitude(dataRoot: string, entry: TurnSignalEntry, text?: TurnSignalText): Promise<void>;
//# sourceMappingURL=four-source.d.ts.map