import type { Logger } from '../types.js';
export interface AttitudeEvent {
    /** 内心倾向（亲近 / 拒绝 / 任务）—— 来自"内心活动"（reasoning + 工具中文） */
    thinkTen?: string;
    /** 正文情绪（暖 / 冷 / 中性） */
    replyEmo?: string;
    /** 正文长度（字） */
    replyChars?: number;
    /**
     * **群友这一轮的语气**（暖 / 冷 / 中性）—— 主人 2026-09-14 定的「对比放大」：
     *   · 对方**夸**（暖）她还**掉**好感 → **不领情** → 扣得更多（×1.5）
     *   · 对方**骂**（冷）她还**涨**好感 → **想讨好** → 加得更大（×1.5）
     *   · 同向（暖×加 / 冷×减）→ 顺手也放大一点（×1.2，初值）
     * 主人原话："如果 ai 减好感，对应的群友说话是夸的，那么说明不领情，好感扣的更多；
     *   如果 ai 加好感，但群友说话是骂的，说明 ai 想讨好，加好感度的幅度更大，以此类推。"
     */
    userEmo?: string;
}
export interface DeltaBreakdown {
    /** 本回合事件分（已含 EVENT_SCALE） */
    delta: number;
    /** 人可读的拆解，便于面板/日志解释"这次为什么涨跌" */
    parts: string[];
    /**
     * 同一批拆解的**结构化代号**（2026-09-14 主人"文字太多，改成分列+图标"）。
     * 面板按代号渲染图标标签，`parts` 全文退居悬浮提示 —— 免得一行塞满中文。
     *   near / refuse / yield / harsh   ｜ 加成: amp:cold-praise / amp:flatter / amp:both-warm / amp:both-cold
     */
    codes: string[];
}
/** 人话档位（面板要显示它；按**占范围的比例**分，因为范围随熟识度变，看比例才公平） */
export type AttitudeTier = '很亲近' | '亲近' | '中立' | '冷淡' | '疏远';
/** 算档位：a = 好感度，f = 熟识度 0~1 */
export declare function attitudeTier(a: number, f: number): AttitudeTier;
/**
 * 分数偏移（**按好感度数值连续算**，2026-09-14 定稿：偏移加在分数上）。
 *
 *   偏移 = +0.1 × 占比            （占比 = 好感度 ÷ 它的范围，−1 ~ +1）
 *   · 越亲近（占比正）→ 偏移越正 → 他那句话在人家眼里更值钱 → 更容易接话
 *   · 越冷淡（占比负）→ 偏移越负 → 那句话没那么值 → 更难被叫醒（少主动）
 *   · **死区 ±5%**：占比太小（刚认识、A 在 0 附近晃）就不偏移，免得噪声乱跳
 *   · 幅度封顶 ±0.10（不翻盘；红线不变：负档只是少主动，绝不冷落 / 阴阳）
 *
 * ⚠️ 2026-09-14 修符号：主人看到「好感 −1.129（冷淡）却 [+0.06] 加分」，问
 * "我好感度是负数，为什么分数是加的" —— 对的，那时候是**门槛版**的公式直接搬过来的，
 * 符号没跟着翻：门槛 +0.06（更难）换算成加分会变成 −0.06，写成 −0.1×ratio 就成了
 * 冷淡反而加分、更容易被叫醒，完全反了。现在按语义直写：正占比加分、负占比减分。
 *
 * 与档位的关系：**档位名仍保留，但只用于面板显示** —— 它不再是偏移的依据，
 * 所以不会出现"占比 19.9% 和 20.0% 偏移一样、跨过 20% 却突然跳一档"的台阶感。
 */
export declare function scoreOffsetByRatio(ratio: number): number;
/** 按**档位**算的旧版偏移（离散），仅供对照/回退；实际生效的是 `scoreOffsetByRatio` */
export declare function thresholdOffset(tier: AttitudeTier): number;
/**
 * 一步到位：给某人算「好感度档位 + 分数偏移」。
 * 没有好感度记录 → 中立 / 偏移 0（新人不受影响）。
 */
export declare function attitudeGateFor(dataRoot: string, key: string): {
    tier: AttitudeTier;
    offset: number;
    a: number;
    ratio: number;
};
/**
 * 门槛偏移的**总开关**（纪律：一次一档 + 可一键回滚）。
 *   关掉 = 回到"门槛只按会话设"的老行为，好感度不再影响叫醒判定。
 */
export declare const ATTITUDE_GATE_ENABLED = true;
/** 好感度范围 R(F) = 1 + 2F：陌生人 ±1，45 天熟人 ≈ ±2.5 */
export declare function attitudeRange(f: number): number;
/** 阻尼 k(F) = 1/(1+3F)：同样一件事，陌生人变 1.0，老熟人只变 0.25 */
export declare function attitudeDamping(f: number): number;
/**
 * 本回合事件分（纯函数：便于测试，也便于面板解释）。
 *
 * **定案口径（2026-09-14 主人）：扣不扣看内心，不看表面。**
 *   表面（正文）只在"内心拒绝"时参与 —— 用来区分**让步**与**重罚**；
 *   内心是亲近/任务时，表面再冷也**不扣**（那只是语气，不是态度）。
 */
export declare function computeDelta(ev: AttitudeEvent): DeltaBreakdown;
export interface AttitudeEntry {
    /** 最近一次看到的昵称 */
    name?: string;
    /** 好感度 A 值（−R(F) ~ +R(F)） */
    a: number;
    /** 累计参与计算的事件数 */
    events: number;
    firstAt?: number;
    lastAt?: number;
    /** 最近一次的 Δ */
    lastDelta?: number;
    /** 最近一次的拆解（人可读） */
    lastWhy?: string;
    /** 最近一次拆解的结构化代号（面板图标用；老数据没有 → 面板回退显示 lastWhy） */
    lastCodes?: string[];
    /** 最近若干条事件（{ts,d,why}） */
    recent?: Array<{
        ts: number;
        d: number;
        why: string;
    }>;
}
/**
 * 记一次事件、更新该人的好感度。返回更新后的条目（失败返回 undefined）。
 *
 * @param key   建议用 `person:<openid>`（与熟识度台账同键，方便两列对齐）
 * @param ev    本回合的内心倾向 / 正文情绪 / 正文长度
 */
export declare function applyAttitudeEvent(dataRoot: string, key: string, ev: AttitudeEvent & {
    name?: string;
}, logger?: Logger): AttitudeEntry | undefined;
/** 按好感度排序（面板用） */
export declare function topAttitude(dataRoot: string, limit?: number): Array<{
    key: string;
    name?: string;
    a: number;
    events: number;
    lastAt?: number;
    lastWhy?: string;
}>;
/** 单查 */
export declare function attitudeOf(dataRoot: string, key: string): AttitudeEntry | undefined;
/** 入站时调用（每收到一条群友消息）；emo = 这条消息的语气（暖/冷/中性），供"对比放大"用 */
export declare function noteLastSender(sessionKey: string, id: string, name?: string, emo?: string): void;
/** 出站时调用：取"本轮在跟谁说话"（10 分钟内有效，过期视为无） */
export declare function getLastSender(sessionKey: string): {
    id: string;
    name?: string;
    emo?: string;
} | undefined;
//# sourceMappingURL=attitude.d.ts.map