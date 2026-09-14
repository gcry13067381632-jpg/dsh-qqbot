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

/** 高置信自述句式：主语是"我" + 关于自己的动词/判断 */
const PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: '我是/叫/来自', re: /我(是|叫|来自|住在)/ },
  { label: '我玩/做/干', re: /我(玩|做|干|搞)(过|了|的|着)?/ },
  { label: '我喜欢/爱/讨厌', re: /我(喜欢|爱|讨厌|迷|不吃|只看)/ },
  // ⚠️ 允许"我 + 少量字 + 有/会/能"：实测最典型的是「我**哔哩哔哩**有十万粉丝」这种中间插平台/地名的说法
  { label: '我有/会/能', re: /我[^，。！？\s]{0,6}(有|会|能)(过|了|的)?/ },
  { label: '我最近/上次/以前/平时', re: /我(最近|上次|以前|平时|一直|现在)/ },
  { label: '我的…是/叫', re: /我的[^，。！？]{1,10}(是|叫)/ },
];

/** 排除：不是"关于他自己的事实" */
const EXCLUDES: RegExp[] = [
  /我(该|要不要|是不是|能不能|可以|得|想)/,       // 提问 / 征求意见
  /我(刚|刚才|上面|下面|这个|那个|这|那)/,          // 指代当下（临场的东西）
  /我(看到|听说|觉得|以为|猜|怀疑|感觉)/,          // 观点 / 转述，不是关于自己的事实
];

/**
 * 判断一段话是不是"他在说自己的事"。命中返回 {matched}，否则 undefined。
 * 门槛刻意保守：太短太长不看、疑问句不看、命中排除词不看。
 */
export function detectSelfDisclosure(text: string): SelfDisclosureHit | undefined {
  const t = String(text || '').trim();
  if (t.length < 8 || t.length > 400) return undefined;
  if (/[?？]\s*$/.test(t)) return undefined;
  for (const ex of EXCLUDES) if (ex.test(t)) return undefined;
  for (const p of PATTERNS) if (p.re.test(t)) return { matched: p.label };
  return undefined;
}

/** 注入给她看的提醒（一行，别写成命令式 —— 是"可以"，不是"必须"） */
export function selfDisclosureHint(hit: SelfDisclosureHit, senderName: string): string {
  const who = String(senderName || '').trim() || '对方';
  return `【小传提醒】${who}这段话像是在说他**自己**的事（命中"${hit.matched}"）。如果那确实算"旁人也复述得出的客观事实"（身份/喜好/经历），可以顺手用 people_memo 记一条；不是事实、或者只是随口一提，就别记。`;
}

// ── 提醒节流（内存；防止她天天被同一个人同一件事叨扰） ──

/** 每人每天最多提醒几次（够用又不唠叨） */
const MAX_HINT_PER_DAY = 2;
const hintCount = new Map<string, { day: string; n: number }>();

/** 今天已经提醒过几次 */
export function hintCountToday(key: string, now = Date.now()): number {
  const day = new Date(now).toDateString();
  const hit = hintCount.get(key);
  return hit && hit.day === day ? hit.n : 0;
}

/** 记一次提醒（返回 false 表示今天额度已满、这次不该提醒） */
export function bumpHint(key: string, now = Date.now()): boolean {
  const day = new Date(now).toDateString();
  const hit = hintCount.get(key);
  const n = hit && hit.day === day ? hit.n : 0;
  if (n >= MAX_HINT_PER_DAY) return false;
  hintCount.set(key, { day, n: n + 1 });
  return true;
}
