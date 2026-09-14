/**
 * attitude.ts — 好感度：她对某个人的**态度**（A 值）· 2026-09-14 主人"直接推进"
 *
 * 与「熟识度」的分工（设计稿 §10，两个维度别混）：
 *   · **熟识度** = 她把他**记多牢**（客观计数 + 记忆曲线，慢变，可从聊天记录核对）—— 已有，在 local-signals.ts
 *   · **好感度** = 她对他**什么态度**（主观，随事件**可升可降**）—— **本模块**
 *
 * 公式（§10）：
 *   A ← clamp( A + Δ × k(F), −R(F), +R(F) )
 *     · F       = 熟识度 0~1（memoryStrength）
 *     · R(F)    = 1 + 2F     好感度**范围**：陌生人 ±1、45 天熟人 ≈ ±2.5（越熟能走得越极端）
 *     · k(F)    = 1/(1+3F)   **阻尼**：熟识度越高，同一件事改变越小（惯性）
 *     · Δ       = 本回合事件分（见 computeDelta）
 *
 * Δ（**定案口径 2026-09-14 主人："扣不扣看内心，不看表面"**）：
 *   Δ = 0.1 × score，其中：
 *   · **内心**（s_think）：亲近 +0.5 / 任务 0 / 拒绝 −0.5
 *   · **表面只在"内心拒绝"时参与**（用来分辨"照顾"还是"敷衍"）：
 *       · 正文**仍暖且够长**（≥40 字） → **让步 +0.8**（心里不肯还是照顾了你 → 净正）
 *       · 正文**冷 / 过短**（<20 字） → **重罚 −0.5**（又烦又冷又敷衍 → 净更负）
 *       · 其它 → 不加不减
 *   · 内心是**亲近 / 任务**时，**表面再冷也不扣** —— 那只是语气，不是态度。
 *     （起因：主人 2026-09-14 问"内心亲近正文冷为什么算减🤔"，拍板统一为"看内心"。）
 *   · 群友情绪（仅背景）：**第二版再加**（需把入站侧的群友情绪与出站回合对齐，先不做）
 *
 *   换算（EVENT_SCALE = 0.1）：亲近 **+0.05** · 任务 **0** · 拒绝 **−0.05** ·
 *                              拒绝但让步 **+0.03** · 拒绝且又冷 **−0.10**
 *
 * 红线（§10，硬约束）：**负好感只退礼貌档**（减少主动、措辞客气），**绝不冷落 / 阴阳 / 攻击**。
 *   行为侧这一版**不接**（观察期只看数据）；要接也必须"一次一档 + 可一键回滚"。
 *
 * ⚠️ 主人口径（2026-09-14）："我们是看差值的……又不是人格测试系统，不需要分类出特定性格。"
 *   ⇒ 这里的分类只用来**算差**，不追求精细人格画像。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getAffinityEntry, memoryStrength } from './local-signals.js';
import type { Logger } from '../types.js';

/** 每次事件的最大变化量（Δ 上限）—— 太小看不出，太大几次就顶格 */
const EVENT_SCALE = 0.1;
/** 「让步」判定：正文够"具体照顾"的字数门槛 */
const YIELD_MIN_CHARS = 40;
/** 「敷衍」判定：正文过短（退成模板）的门槛 */
const SLACK_MAX_CHARS = 20;
/** 每人保留的最近事件条数（面板/排查用） */
const RECENT_MAX = 8;
/** 台账上限（人） */
const MAX_PEOPLE = 500;

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

// ── 档位名与「门槛偏移」（2026-09-14 主人定：门槛 = 基础门槛 + 好感度偏移） ──

/** 人话档位（面板要显示它；按**占范围的比例**分，因为范围随熟识度变，看比例才公平） */
export type AttitudeTier = '很亲近' | '亲近' | '中立' | '冷淡' | '疏远';

/** 算档位：a = 好感度，f = 熟识度 0~1 */
export function attitudeTier(a: number, f: number): AttitudeTier {
  const r = attitudeRange(f);
  const ratio = r > 0 ? a / r : 0;
  if (ratio >= 0.6) return '很亲近';
  if (ratio >= 0.2) return '亲近';
  if (ratio > -0.2) return '中立';
  if (ratio > -0.6) return '冷淡';
  return '疏远';
}

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
export function scoreOffsetByRatio(ratio: number): number {
  const r = Math.max(-1, Math.min(1, ratio));
  if (Math.abs(r) < 0.05) return 0; // 死区
  const off = 0.1 * r;
  return Math.round(off * 1000) / 1000;
}

/** 按**档位**算的旧版偏移（离散），仅供对照/回退；实际生效的是 `scoreOffsetByRatio` */
export function thresholdOffset(tier: AttitudeTier): number {
  switch (tier) {
    case '很亲近': return 0.10;
    case '亲近': return 0.05;
    case '冷淡': return -0.05;
    case '疏远': return -0.10;
    default: return 0; // 中立
  }
}

/**
 * 一步到位：给某人算「好感度档位 + 分数偏移」。
 * 没有好感度记录 → 中立 / 偏移 0（新人不受影响）。
 */
export function attitudeGateFor(
  dataRoot: string,
  key: string,
): { tier: AttitudeTier; offset: number; a: number; ratio: number } {
  let a = 0;
  let f = 0;
  try {
    a = attitudeOf(dataRoot, key)?.a ?? 0;
    const aff = getAffinityEntry(dataRoot, key);
    if (aff) f = memoryStrength(aff);
  } catch { /* 读不到 → 按中立 */ }
  const r = attitudeRange(f);
  const ratio = r > 0 ? a / r : 0;
  const tier = attitudeTier(a, f);
  // 偏移**按数值连续算**（档位只用于显示）
  return { tier, offset: scoreOffsetByRatio(ratio), a, ratio };
}

/**
 * 门槛偏移的**总开关**（纪律：一次一档 + 可一键回滚）。
 *   关掉 = 回到"门槛只按会话设"的老行为，好感度不再影响叫醒判定。
 */
export const ATTITUDE_GATE_ENABLED = true;

/** 好感度范围 R(F) = 1 + 2F：陌生人 ±1，45 天熟人 ≈ ±2.5 */
export function attitudeRange(f: number): number {
  return 1 + 2 * Math.max(0, Math.min(1, f));
}

/** 阻尼 k(F) = 1/(1+3F)：同样一件事，陌生人变 1.0，老熟人只变 0.25 */
export function attitudeDamping(f: number): number {
  return 1 / (1 + 3 * Math.max(0, Math.min(1, f)));
}

/**
 * 本回合事件分（纯函数：便于测试，也便于面板解释）。
 *
 * **定案口径（2026-09-14 主人）：扣不扣看内心，不看表面。**
 *   表面（正文）只在"内心拒绝"时参与 —— 用来区分**让步**与**重罚**；
 *   内心是亲近/任务时，表面再冷也**不扣**（那只是语气，不是态度）。
 */
export function computeDelta(ev: AttitudeEvent): DeltaBreakdown {
  const parts: string[] = [];
  const codes: string[] = [];
  let score = 0;

  const think = ev.thinkTen;
  const emo = ev.replyEmo;
  const chars = ev.replyChars ?? 0;

  if (think === '亲近') {
    score += 0.5;
    parts.push('内心亲近 +0.5');
    codes.push('near');
  } else if (think === '拒绝') {
    score -= 0.5;
    parts.push('内心拒绝 −0.5');
    codes.push('refuse');
    // 表面只在"内心拒绝"时参与：是照顾还是敷衍，全看这一句
    if (emo === '暖' && chars >= YIELD_MIN_CHARS) {
      score += 0.8;
      parts.push('让步(心里不肯仍照顾) +0.8');
      codes.push('yield');
    } else if (emo === '冷' || chars < SLACK_MAX_CHARS) {
      score -= 0.5;
      parts.push('又烦又冷(重罚) −0.5');
      codes.push('harsh');
    }
  }
  // 内心"任务/中性"：0 分；表面冷也**不扣**（只是语气）

  // ── 对比放大（主人 2026-09-14）：看"**对方语气 × 她的方向**" ──
  const user = ev.userEmo;
  if (user && score !== 0) {
    if (user === '暖' && score < 0) {
      score *= 1.5;
      parts.push('对方夸她还掉好感(不领情) ×1.5');
      codes.push('amp:cold-praise');
    } else if (user === '冷' && score > 0) {
      score *= 1.5;
      parts.push('对方冷她还涨好感(讨好) ×1.5');
      codes.push('amp:flatter');
    } else if (user === '暖' && score > 0) {
      score *= 1.2;
      parts.push('两好相凑 ×1.2');
      codes.push('amp:both-warm');
    } else if (user === '冷' && score < 0) {
      score *= 1.2;
      parts.push('两冷相叠 ×1.2');
      codes.push('amp:both-cold');
    }
  }

  return { delta: Math.round(score * EVENT_SCALE * 1000) / 1000, parts, codes };
}

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
  recent?: Array<{ ts: number; d: number; why: string }>;
}

interface AttitudeFile {
  map: Record<string, AttitudeEntry>;
}

const attCache = new Map<string, { file: AttitudeFile; mtime: number }>();

function attPath(dataRoot: string): string {
  return join(dataRoot, '.qqbot', 'attitude.json');
}

/**
 * 读台账（带缓存，但**文件一变就重读**）。
 *
 * ⚠️ 2026-09-14 修：原来只认内存缓存 → 手工改文件（演示时调数据）对运行中的进程**无效**
 *   （实测：把 A 调成"疏远"后，新评分记录里 tier 仍是"中立"）。现在按 mtime 判断 ——
 *   文件被外部改了立刻重读，不用重启宿主。affinity.json 那边同款问题也一并修了。
 */
function loadAtt(dataRoot: string): AttitudeFile {
  let mtime = 0;
  try { mtime = statSync(attPath(dataRoot)).mtimeMs; } catch { mtime = 0; }
  const hit = attCache.get(dataRoot);
  if (hit && mtime !== 0 && hit.mtime === mtime) return hit.file;
  let data: AttitudeFile = { map: {} };
  try {
    if (existsSync(attPath(dataRoot))) {
      const raw = JSON.parse(readFileSync(attPath(dataRoot), 'utf8')) as AttitudeFile;
      if (raw && typeof raw === 'object' && raw.map && typeof raw.map === 'object') data = { map: raw.map };
    }
  } catch { /* 首次/损坏 → 空台账 */ }
  attCache.set(dataRoot, { file: data, mtime });
  return data;
}

function saveAtt(dataRoot: string, data: AttitudeFile): void {
  try {
    const p = attPath(dataRoot);
    mkdirSync(join(dataRoot, '.qqbot'), { recursive: true });
    writeFileSync(p, JSON.stringify(data, null, 1), 'utf8');
  } catch { /* 记不上不影响主链 */ }
}

/**
 * 记一次事件、更新该人的好感度。返回更新后的条目（失败返回 undefined）。
 *
 * @param key   建议用 `person:<openid>`（与熟识度台账同键，方便两列对齐）
 * @param ev    本回合的内心倾向 / 正文情绪 / 正文长度
 */
export function applyAttitudeEvent(
  dataRoot: string,
  key: string,
  ev: AttitudeEvent & { name?: string },
  logger?: Logger,
): AttitudeEntry | undefined {
  if (!dataRoot || !key) return undefined;
  try {
    const now = Date.now();
    const file = loadAtt(dataRoot);
    const cur: AttitudeEntry = file.map[key] ?? { a: 0, events: 0, firstAt: now };
    const { delta, parts, codes } = computeDelta(ev);

    // F = 熟识度（记忆强度 0~1）；没这个人就按 0 算（陌生人：范围小、变化快）
    let f = 0;
    try {
      const aff = getAffinityEntry(dataRoot, key);
      if (aff) f = memoryStrength(aff, now);
    } catch { /* 熟识度读不到 → 按陌生人 */ }

    const k = attitudeDamping(f);
    const r = attitudeRange(f);
    const next = Math.max(-r, Math.min(r, cur.a + delta * k));

    cur.a = Math.round(next * 1000) / 1000;
    cur.events += 1;
    cur.lastAt = now;
    if (ev.name) cur.name = String(ev.name).slice(0, 40);
    if (delta !== 0 || parts.length > 0) {
      cur.lastDelta = delta;
      cur.lastWhy = parts.join(' / ') || '无变化';
      cur.lastCodes = codes;
      const recent = cur.recent ?? [];
      recent.push({ ts: now, d: cur.a, why: cur.lastWhy });
      cur.recent = recent.slice(-RECENT_MAX);
    }
    file.map[key] = cur;

    // 上限保护：人太多时丢掉最久没动的（保留最近活跃的 MAX_PEOPLE 个）
    const keys = Object.keys(file.map);
    if (keys.length > MAX_PEOPLE) {
      keys.sort((x, y) => (file.map[y]!.lastAt ?? 0) - (file.map[x]!.lastAt ?? 0));
      for (const dead of keys.slice(MAX_PEOPLE)) delete file.map[dead];
    }

    saveAtt(dataRoot, file);
    return cur;
  } catch (err) {
    logger?.debug?.(`[attitude] 更新失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** 按好感度排序（面板用） */
export function topAttitude(
  dataRoot: string,
  limit = 10,
): Array<{ key: string; name?: string; a: number; events: number; lastAt?: number; lastWhy?: string }> {
  const data = loadAtt(dataRoot);
  return Object.entries(data.map)
    .map(([key, e]) => ({ key, name: e.name, a: e.a, events: e.events, lastAt: e.lastAt, lastWhy: e.lastWhy, lastCodes: e.lastCodes }))
    .sort((x, y) => y.a - x.a)
    .slice(0, Math.max(1, limit));
}

/** 单查 */
export function attitudeOf(dataRoot: string, key: string): AttitudeEntry | undefined {
  return loadAtt(dataRoot).map[key];
}

// ── 会话 → 最近一次入站消息的发送者（出站时才知道"这一轮在跟谁说话"） ──
// 为什么需要：好感度是"她对**某个人**的态度"，但出站事件只带会话（群），不带发送者。
// 做法与本插件既有风格一致（bot-reply-memo 同款）：入站时记一下，出站时取用。

const lastSender = new Map<string, { id: string; name?: string; emo?: string; at: number }>();

/** 入站时调用（每收到一条群友消息）；emo = 这条消息的语气（暖/冷/中性），供"对比放大"用 */
export function noteLastSender(sessionKey: string, id: string, name?: string, emo?: string): void {
  if (!sessionKey || !id) return;
  lastSender.set(sessionKey, { id, name, emo, at: Date.now() });
}

/** 出站时调用：取"本轮在跟谁说话"（10 分钟内有效，过期视为无） */
export function getLastSender(sessionKey: string): { id: string; name?: string; emo?: string } | undefined {
  const hit = lastSender.get(sessionKey);
  if (!hit) return undefined;
  if (Date.now() - hit.at > 10 * 60_000) return undefined;
  return { id: hit.id, name: hit.name, emo: hit.emo };
}
