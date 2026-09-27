/**
 * self-disclosure.ts — 「群友自述」检测（2026-09-14 主人定：按关键词命中）
 *
 * 用途：给小传补上**主动留意**那一步 —— 群里有人说了**关于他自己的事实**（身份/喜好/经历），
 *   就给她一条**临时**提醒（零常驻开销），她才知道该动笔。
 *
 * 为什么用关键词、不让 AI 自己判断：主人 9-13 定过"用法不写进守则，常驻注入每轮都占 token"，
 *   而"是不是在说他自己的事"这件事，几个高置信句式就能抓住：
 *   · **误报代价极小** —— 最多她多记一条没用的（能删，且一天只有 3 条额度）；
 *   · **漏报也无害** —— 下次他再说还会触发。
 *   所以宁可保守，只抓高置信的；拿不准的一律不提醒。
 */
export interface SelfDisclosureHit {
    /** 命中的句式（写进提醒文案，便于她自己复核） */
    matched: string;
}
/**
 * 判断一段话是不是"他在说自己的事"。命中返回 {matched}，否则 undefined。
 * 门槛刻意保守：太短太长不看、疑问句不看、命中排除词不看。
 */
export declare function detectSelfDisclosure(text: string): SelfDisclosureHit | undefined;
/** 注入给她看的提醒（一行，别写成命令式 —— 是"可以"，不是"必须"） */
export declare function selfDisclosureHint(hit: SelfDisclosureHit, senderName: string): string;
/** 今天已经提醒过几次 */
export declare function hintCountToday(key: string, now?: number): number;
/** 记一次提醒（返回 false 表示今天额度已满、这次不该提醒） */
export declare function bumpHint(key: string, now?: number): boolean;
//# sourceMappingURL=self-disclosure.d.ts.map