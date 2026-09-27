/**
 * tendency-samples.ts — 倾向例句库（亲近 / 拒绝 / 任务，中英双语）
 *
 * 用途：本地小模型（bge-small-zh）只做相似度 —— 把「大模型的思考文本」与这三组例句比，
 *   判她心里对眼前这件事是**亲近**（想为对方多做点）、**拒绝**（这事不做 / 守线 / 回绝）
 *   还是**任务**（流程与职责判断）。
 * ⚠️ 语言必须对得上：中文思考配 zh 例库，英文配 en 例库；跨语言不比（中文模型嵌不了英文）。
 * ⚠️ 只是**弱信号**：观察期只记录，不参与行为；绝不用它冷落人。
 *
 * 档位定名史（免得后人改回去）：
 *   · 2026-09-13 初版叫「疏离」，例句偏"说话简洁/克制" → 把"没叫我我静默"整片误判成疏离；
 *   · 2026-09-13 晚校准：疏离只留"对人的冷淡"，静默类挪进「任务」（主人："静默确实是任务，我设计的"）；
 *   · 2026-09-14 主人定案：第三档改名「**拒绝**」—— 它装的不是"对人冷淡"，
 *     而是"**对内容/请求说不、同时守着礼貌与分寸**"（实测样本：9-12 拒绝"萝莉向"请求那几轮）。
 */
export type TendencyLabel = '亲近' | '拒绝' | '任务';
export declare const TENDENCY_SAMPLES: Record<TendencyLabel, {
    zh: readonly string[];
    en: readonly string[];
}>;
export declare const TENDENCY_LABELS: readonly TendencyLabel[];
//# sourceMappingURL=tendency-samples.d.ts.map