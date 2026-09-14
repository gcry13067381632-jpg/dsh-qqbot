/**
 * four-source.ts — 四源标量留档（观察期**只记录**，2026-09-13）
 *
 * 《好感度系统设计》§11 的「四源」= ① 语言情绪例库（判对方）② 群友的话 ③ 她的思考 ④ 她的正文。
 * 本模块负责**出站侧那两源**（③ 思考 / ④ 正文）的标量，分工定死（2026-09-14）：
 *   · ③ 思考 → **倾向**（亲近 / 拒绝 / 任务）—— 判她"心里怎么想"
 *   · ④ 正文 → **情绪**（夸 / 骂 / 中性）—— 判她"话说出来什么味道"
 *   · 外加 正文长度 + 「是否具体接话」的粗判
 * 一回合一行，落 `{dataRoot}/.qqbot/four-source.jsonl`。
 *
 * 为什么另起一份文件、不塞进 value-scores.jsonl：
 *   那份是**入站侧**按"群友的一条消息"写一行；出站标量是"她这一回合"的，塞不进去。
 *   两边的对齐键是 `turn`/`step` —— §11 明确：**差值只在同一人、同一时刻格内算**（跨时刻相减全是噪声）。
 *
 * 红线：
 *   · 只记录，**不参与任何判定**；稳定项（重测一致、共线性合格）才谈进 Δ好感；
 *   · 只存**标量**（标签 / 分数 / 长度），**不存思考原文**（原文在 `thinking-log.jsonl`，便于单独删）；
 *   · 模型不可用（没下小模型）时也要能跑：此时只记长度，情绪/倾向留空。
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyEmo, classifyTendency } from './local-signals.js';
import { applyAttitudeEvent } from './attitude.js';
import type { Logger } from '../types.js';

/** 留档上限（行）：超出后滚动保留最新 */
const MAX_LINES = 800;
const COMPACT_EVERY = 40;
let sinceCompact = 0;

/** 「是否具体接话」的粗判门槛（字）：短到一句话以下，多半是模板式敷衍 */
const CONCRETE_MIN_CHARS = 40;

/**
 * 倾向判定的**把握门槛**（最高分 − 第二名）：低于此值视为"判不准"，**只留分数不留标签**。
 *
 * 实测两批（2026-09-13 / 09-14）：
 *   · "没叫我我静默"那种短句：最高分与第二名常只差 **0.000**（真·打平）→ 必须挡掉；
 *   · "拒绝"类样本（9-12 拒萝莉向请求那几轮）：档判对了，但 margin 天然偏低（0.010~0.085）。
 * 取 **0.01**：打平的挡掉、判对了的留住 —— 观察期先要看得见分布，行为侧一律不接。
 * 设计稿原则："不确定就不动分（判不准时跳过，不给错分）"。
 */
const TENDENCY_MIN_MARGIN = 0.01;

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
export const TENDENCY_MIN_BEST = 0.44;
export const EMO_MIN_BEST = 0.45;
const EMO_MIN_MARGIN = 0.01;

/**
 * 工具调用参数要不要参与「内心倾向」（2026-09-14 主人拍板：**不参与**）。
 *
 * 起因：某轮她没有思考块（thinkChars=0），判「拒绝」的依据**全是工具参数**——
 *   `reply_gate` 的 `{"reason":"路人甲点我名说…，需回应"}`，一句"要回应"被判成了"拒绝"，
 *   然后配上正文冷 → 好感度 −0.12 扣在群里另一个人头上（详见 inbound 的归因修复）。
 * 代价（已知）：主人当初特意要的另一种信号会丢 —— 姐姐型那只有些回合**没有 reasoning 块**，
 *   它的内心只写在工具参数里（"…可俏皮接梗"）。
 * 权衡：工具参数里大多是**元信息**（要不要回话、发什么图），跟"她对这个人什么态度"关系弱、噪声大；
 *   真内心还是看 reasoning。想恢复：把这里改成 `true` 即可（其余代码不动）。
 */
export const TENDENCY_INCLUDE_TOOL = false;

/** 过了把握门槛才给标签；不过门槛只留分数，便于事后调门槛 */
function confidentLabel(r: { label: string; best: number; margin: number } | undefined): string | undefined {
  if (r === undefined) return undefined;
  if (r.best < TENDENCY_MIN_BEST) return undefined;
  return r.margin >= TENDENCY_MIN_MARGIN ? r.label : undefined;
}

/** 情绪侧同样要过把握门槛（不然低把握的"冷"也会去扣好感度）—— 导出给入站侧一起用 */
export function confidentEmo(r: { label: string; best: number; margin: number } | undefined): string | undefined {
  if (r === undefined) return undefined;
  if (r.best < EMO_MIN_BEST) return undefined;
  return r.margin >= EMO_MIN_MARGIN ? r.label : undefined;
}

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
   * 「古都吹面包调侃我傲娇，可俏皮接梗」——那就是它的内心，白白丢了可惜。
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
export function extractInnerText(rawArgs: string): string {
  let obj: unknown;
  try { obj = JSON.parse(String(rawArgs ?? '')); } catch { return ''; }
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      const t = v.trim();
      if (isMostlyChinese(t)) out.push(t);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (v && typeof v === 'object') { for (const x of Object.values(v as Record<string, unknown>)) walk(x); }
  };
  walk(obj);
  return out.join('\n');
}

/** 汉字 ≥4 且 汉字占比 ≥0.8（标点/emoji 不参与计算，避免"，，，"被当中文） */
function isMostlyChinese(s: string): boolean {
  if (s.length < 4 || s.length > 600) return false;
  let han = 0;
  let latinNum = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x4e00 && c <= 0x9fff) han += 1;
    else if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latinNum += 1;
  }
  const total = han + latinNum;
  return han >= 4 && total > 0 && han / total >= 0.8;
}

function compact(path: string): void {
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '');
    if (lines.length <= MAX_LINES) return;
    writeFileSync(path, `${lines.slice(-MAX_LINES).join('\n')}\n`, 'utf8');
  } catch { /* 整理失败不影响主流程 */ }
}

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
export async function noteTurnSignals(
  dataRoot: string,
  entry: TurnSignalEntry,
  text: TurnSignalText = {},
): Promise<void> {
  try {
    const think = String(text.think ?? '');
    const tool = String(text.tool ?? '');
    const reply = String(text.reply ?? '');
    // ① 空回合不留痕（内心与正文都空 = 纯流程步，没有可观测的状态）
    if (think.trim() === '' && tool.trim() === '' && reply.trim() === '') return;

    const opts = { modelDir: text.modelDir, logger: text.logger };
    // 内心活动 = 思考 (+ 工具调用里的中文，默认不参与判定 —— 见 TENDENCY_INCLUDE_TOOL)
    const toolPart = TENDENCY_INCLUDE_TOOL ? tool.trim() : '';
    const inner = [think.trim(), toolPart].filter((s) => s !== '').join('\n');

    // ②③ 分工定死：**内心判倾向**（默认只取 reasoning），正文判情绪
    const [innerTen, replyEmo] = await Promise.all([
      inner ? classifyTendency(inner, opts) : Promise.resolve(undefined),
      reply.trim() ? classifyEmo(reply, opts) : Promise.resolve(undefined),
    ]);

    const replyChars = entry.replyChars ?? reply.length;
    const rec = {
      ts: Date.now(),
      scope: entry.scope,
      peer: entry.peerId,
      turn: entry.turn,
      step: entry.step,
      // ③ 内心活动（她心里怎么想）＝ 思考 + 工具调用里的中文 —— **只留倾向**
      thinkChars: entry.thinkChars ?? think.length,
      thinkTokens: entry.thinkTokens,
      toolChars: entry.toolChars ?? tool.length,
      innerChars: inner.length,
      thinkTen: confidentLabel(innerTen),
      thinkTenScore: innerTen?.best,
      thinkTenMargin: innerTen?.margin,
      thinkTenLang: innerTen?.lang,
      // ④ 正文（说出口的话）—— **只留情绪**；倾向实测全是字面噪声, 已停判
      replyChars,
      replyEmo: confidentEmo(replyEmo),
      replyEmoScore: replyEmo?.best,
      replyEmoMargin: replyEmo?.margin,
      // 「是否具体接话」的粗判（先按长度；将来若发现不灵再换判据）
      concrete: replyChars >= CONCRETE_MIN_CHARS ? true : undefined,
    };

    const dir = join(dataRoot, '.qqbot');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'four-source.jsonl');
    appendFileSync(path, `${JSON.stringify(rec)}\n`, 'utf8');
    if (++sinceCompact >= COMPACT_EVERY) {
      sinceCompact = 0;
      compact(path);
    }

    // 好感度（A 值）**不在这里算** —— 见文件末尾的 applyTurnAttitude。
    // 2026-09-14 修：一个回合可能有多个 step（先思考+调工具，再思考+出正文），
    //   按 step 结算会 ① 把同一份内心重复加减，② 中间步 replyChars=0 被当成
    //   "正文冷 / 过短"触发**重罚**。好感度是"这一轮她对这个人什么态度"，必须按**回合**算。
  } catch (err) {
    text.logger?.debug?.(`[four-source] 留档失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
  }
}

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
export async function applyTurnAttitude(
  dataRoot: string,
  entry: TurnSignalEntry,
  text: TurnSignalText = {},
): Promise<void> {
  try {
    if (!entry.attitudeKey) return;
    const think = String(text.think ?? '').trim();
    const reply = String(text.reply ?? '').trim();
    if (think === '' && reply === '') return;   // 空回合不留痕（与 noteTurnSignals 同口径）
    const opts = { modelDir: text.modelDir, logger: text.logger };
    const [innerTen, replyEmo] = await Promise.all([
      think ? classifyTendency(think, opts) : Promise.resolve(undefined),
      reply ? classifyEmo(reply, opts) : Promise.resolve(undefined),
    ]);
    applyAttitudeEvent(
      dataRoot,
      entry.attitudeKey,
      {
        thinkTen: confidentLabel(innerTen),
        replyEmo: confidentEmo(replyEmo),
        replyChars: reply.length,
        userEmo: entry.userEmo,
        name: entry.attitudeName,
      },
      text.logger,
    );
  } catch (e) {
    text.logger?.debug?.(`[好感度] 回合结算失败(忽略): ${e instanceof Error ? e.message : String(e)}`);
  }
}
