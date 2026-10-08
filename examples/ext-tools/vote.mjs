/**
 * vote.mjs — 「群投票」扩展工具 v3（2026-10-08）
 *
 * v3（主人当天的第三轮反馈）：
 *   ① **中途回执极简** —— 投一票只回「「C. 还行」+1 票」，不再甩整张票数表；
 *      完整结算**只在结束时**给（结束按钮 / action=end）；
 *   ② **允许多选** —— 同一个人可以点多个选项（想全投也行）；
 *   ③ **同一按钮只能投一次** —— 重复点同一个按钮回「你已经投过这一项了」；
 *   ④ 卡片**最后一行加「✋ 结束投票」按钮** —— 任何群友点一下就能结算（结算会发到群里并通知 AI）；
 *      因此选项上限调整为 **20 个**（4 行 × 5 列，第 5 行留给结束按钮）。
 *
 * v2（保留）：多投票并存（V1/V2…）、中途加选项（action=add，补发新卡、旧卡仍可用）、
 *             定时结束（minutes）、status 查票数、结束时 appendWake 通知 AI。
 *
 * 安装：复制到 `{数据根}/.qqbot-extensions/tools/vote.mjs`，然后 `tools_reload`（或重启宿主）。
 *
 * 用法（AI 侧）：
 *   vote {action:'start',  topic:'今晚吃什么', options:'火锅|烧烤|白饭'}
 *   vote {action:'add',    voteId:'V1', options:'泡面'}
 *   vote {action:'status', voteId:'V1'}
 *   vote {action:'end',    voteId:'V1'}
 *   vote {action:'start',  topic:'周末去哪', options:'爬山|宅家', minutes:30}
 *
 * 底层依赖（插件侧，见维护手册 §11.32）：env.registerInteractionCard 登记卡片；
 * 按钮 action.type=1、data=`ext:vote:<投票号>:<下标或 e>`；导出 onInteraction 收点击。
 */

const MAX_OPTIONS = 20;                       // 4 行 × 5 列（第 5 行留给「结束投票」）
const PER_ROW = 5;
const LETTERS = 'ABCDEFGHIJKLMNOPQRST';       // 20 个字母
const END_BTN = 'e';                          // 结束按钮的 buttonId
const TOOL = 'vote';
const SEP = /[|｜,，]/;

function loadAll(env) {
  const d = env?.store && typeof env.store.load === 'function' ? env.store.load() : undefined;
  const raw = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  // ── v1 → v2/v3 数据迁移 ────────────────────────────────────────────
  //   v1：{ "<cardId>": { topic, options, votes:{openid:idx}, counts:[] } }
  //   v2+：{ seq, votes: { V1: { id, topic, options, votes } } }
  //   旧 cardId 也挂成别名键 ⇒ 群里那张旧卡片照样能点。
  if (!raw.votes) {
    const migrated = { seq: 0, votes: {} };
    for (const [cardId, old] of Object.entries(raw)) {
      if (!old || typeof old !== 'object' || !Array.isArray(old.options)) continue;
      migrated.seq += 1;
      const id = `V${migrated.seq}`;
      const rec = {
        id,
        topic: String(old.topic ?? '（旧投票）'),
        options: old.options,
        votes: old.votes && typeof old.votes === 'object' ? old.votes : {},
        createdAt: Number(old.createdAt) || Date.now(),
        note: `由 v1 卡片 ${cardId} 迁移`,
      };
      migrated.votes[id] = rec;
      migrated.votes[cardId] = rec;
    }
    return migrated;
  }
  return raw;
}
function saveAll(env, d) {
  try { env.store.save(d); } catch { /* 落盘失败不影响本次回复 */ }
}

/** 某个人的选择 —— 一律按数组读（兼容 v1/v2 的单个数字） */
function choicesOf(v, openid) {
  const c = v.votes?.[openid];
  if (c === undefined) return [];
  return Array.isArray(c) ? c.slice() : [c];
}
/** 某人是否投过某个选项 */
function hasChosen(v, openid, idx) {
  return choicesOf(v, openid).includes(idx);
}

/** 卡片正文：题目 + 选项字母表 + 状态（选项全文在这儿，按钮上只有字母） */
function cardBody(v, extra) {
  const lines = [
    `🗳 **${v.topic}**`,
    `投票号：\`${v.id}\`${v.endsAt ? `　截止：${new Date(v.endsAt).toLocaleString('zh-CN', { hour12: false })}` : ''}`,
    '',
  ];
  v.options.forEach((o, i) => lines.push(`**${LETTERS[i] ?? '?'}**. ${o}`));
  lines.push('');
  if (v.closed) lines.push(`⛔ 已结束（共 ${Object.keys(v.votes).length} 人参与）`);
  else lines.push('可多选：想投几个就点几个；每个按钮每人只能点一次。想收摊就点「✋ 结束投票」。');
  if (extra) lines.push('', extra);
  return lines.join('\n');
}

/** 选项按钮（每行 5 个）+ 最后一行的「结束投票」 */
function keyboardOf(voteId, options) {
  const rows = [];
  const n = Math.min(options.length, MAX_OPTIONS);
  for (let r = 0; r * PER_ROW < n; r++) {
    const buttons = [];
    for (let c = 0; c < PER_ROW; c++) {
      const i = r * PER_ROW + c;
      if (i >= n) break;
      buttons.push({
        id: `b${i}`,
        render_data: { label: LETTERS[i], visited_label: `${LETTERS[i]}✓`, style: 1 },
        action: {
          type: 1,
          permission: { type: 2 },
          data: `ext:${TOOL}:${voteId}:${i}`,
          unsupport_tips: '请升级QQ客户端后重试',
        },
      });
    }
    rows.push({ buttons });
  }
  // 最后一行放「结束投票」（放在第二个位置，避免误触第一个按钮）
  rows.push({
    buttons: [
      {
        id: END_BTN,
        render_data: { label: '✋ 结束投票', visited_label: '✋ 结束投票', style: 4 },
        action: {
          type: 1,
          permission: { type: 2 },
          data: `ext:${TOOL}:${voteId}:${END_BTN}`,
          unsupport_tips: '请升级QQ客户端后重试',
        },
      },
    ],
  });
  return { content: { rows } };
}

/** 完整结算块（只在"结束时"用；中途回执不许用它） */
function tallyBlock(v) {
  const people = Object.keys(v.votes).length;
  const lines = [`参与人数：**${people}**（可多选）`];
  v.options.forEach((o, i) => {
    const n = Object.values(v.votes).filter((c) => (Array.isArray(c) ? c : [c]).includes(i)).length;
    lines.push(`· ${LETTERS[i]}. ${o} —— **${n}** 票`);
  });
  return lines.join('\n');
}

/** 取投票 + 顺手做"到点自动结束"判定（键先原样、再大写，兼容旧卡片别名） */
function pick(data, voteId) {
  const key = String(voteId ?? '').trim();
  const v = data?.votes?.[key] ?? data?.votes?.[key.toUpperCase()];
  if (!v) return null;
  if (!v.closed && v.endsAt && Date.now() >= v.endsAt) v.closed = true;
  return v;
}

async function sendCard(env, v, extra) {
  return env.markdownCard(cardBody(v, extra), keyboardOf(v.id, v.options));
}

/** 结束收尾（结束按钮 / action=end 共用）：群里公示 + 通知 AI */
async function finish(env, v, byWhom) {
  const first = !v.closed;
  v.closed = true;
  v.endedAt = Date.now();
  const block = tallyBlock(v);
  try {
    await env.markdown([
      `🗳 **投票结束：${v.topic}**（${v.id}）`,
      byWhom ? `由 ${byWhom} 点下了结束按钮。` : '',
      '',
      block,
    ].filter(Boolean).join('\n'));
  } catch { /* 公示失败不影响结算 */ }
  try {
    if (typeof env.appendWake === 'function') {
      await env.appendWake(`[投票结束] ${v.id}「${v.topic}」已结算：\n${block}`);
    }
  } catch { /* 通知失败不影响结算 */ }
  return { first, block };
}

export default {
  name: TOOL,
  description: '群投票（可多选）：start=发起 / add=中途加选项 / status=看票数 / end=结束结算；卡片最后一行自带「结束投票」按钮；支持多投票并存、最多 20 个选项、可设定时结束；结束时结果会通知 AI。',
  inputSchema: {
    action: { type: 'string', required: true, description: 'start=发起投票；add=加选项；status=查票数；end=结束并结算' },
    topic: { type: 'string', description: 'start 必填：投票题目' },
    options: { type: 'string', description: 'start/add 必填：选项，用 | 分隔（每条建议 ≤12 字，合计最多 20 条）' },
    voteId: { type: 'string', description: 'add/status/end 必填：投票号（start 时返回，如 V1）' },
    minutes: { type: 'number', description: '可选（仅 start）：多少分钟后自动结束；不填 = 手动/点结束按钮' },
  },

  async run(args, env) {
    const action = String(args?.action ?? 'start').trim().toLowerCase();
    const all = loadAll(env);
    all.votes = all.votes && typeof all.votes === 'object' ? all.votes : {};
    all.seq = Number(all.seq) || 0;

    // ── 发起 ─────────────────────────────────────────────
    if (action === 'start') {
      const topic = String(args?.topic ?? '').trim();
      const options = String(args?.options ?? '').split(SEP).map((s) => s.trim()).filter(Boolean);
      if (!topic) return { ok: false, msg: '缺 topic（投票题目）' };
      if (options.length < 2) return { ok: false, msg: '至少 2 个选项（用 | 分隔）' };
      if (options.length > MAX_OPTIONS) return { ok: false, msg: `选项太多：最多 ${MAX_OPTIONS} 个（卡片 4 行 × 5 列，第 5 行留给结束按钮）` };

      all.seq += 1;
      const id = `V${all.seq}`;
      const minutes = Number(args?.minutes);
      const v = {
        id,
        topic,
        options,
        votes: {},
        createdAt: Date.now(),
        ...(Number.isFinite(minutes) && minutes > 0 ? { endsAt: Date.now() + minutes * 60_000 } : {}),
      };
      all.votes[id] = v;
      saveAll(env, all);

      const ok = typeof env.registerInteractionCard === 'function'
        ? env.registerInteractionCard({
          cardId: id,
          // ★ 结束按钮也要登记，否则点了没人认
          buttonIds: [...options.slice(0, MAX_OPTIONS).map((_, i) => String(i)), END_BTN],
          expireAt: Date.now() + (v.endsAt ? Math.max(24 * 3600_000, v.endsAt - Date.now() + 86400_000) : 3 * 86400_000),
        })
        : false;
      const sent = await sendCard(env, v);
      return {
        ok: !!sent,
        msg: sent
          ? `投票已发起：${id}「${topic}」，${options.length} 个选项${v.endsAt ? `，${minutes} 分钟后自动结束` : '（结束时点卡片上的「✋ 结束投票」，或 action=end）'}${ok ? '' : '；⚠️ 卡片登记失败，按钮可能点不动'}`
          : '发卡失败（确认在 QQ 会话里）',
      };
    }

    // ── 中途加选项 ───────────────────────────────────────
    if (action === 'add') {
      const v = pick(all, args?.voteId);
      if (!v) return { ok: false, msg: `没找到投票 ${args?.voteId}` };
      if (v.closed) return { ok: false, msg: `投票 ${v.id} 已经结束了，不能再加选项` };
      const added = String(args?.options ?? '').split(SEP).map((s) => s.trim()).filter(Boolean);
      if (added.length === 0) return { ok: false, msg: '要加什么选项？（options 用 | 分隔）' };
      if (v.options.length + added.length > MAX_OPTIONS) {
        return { ok: false, msg: `加不下：还余 ${MAX_OPTIONS - v.options.length} 个位（含结束按钮共 5 行）` };
      }
      const startIdx = v.options.length;
      v.options.push(...added);
      saveAll(env, all);
      if (typeof env.registerInteractionCard === 'function') {
        env.registerInteractionCard({
          cardId: v.id,
          buttonIds: [...v.options.map((_, i) => String(i)), END_BTN],
          expireAt: Date.now() + 3 * 86400_000,
        });
      }
      const newOnes = added.map((a, k) => `**${LETTERS[startIdx + k]}**. ${a}`).join('、');
      const sent = await sendCard(env, v, `🆕 新增选项：${newOnes}（旧卡片上的按钮同样有效）`);
      return { ok: !!sent, msg: `已给 ${v.id} 加上：${added.join('、')}（现共 ${v.options.length} 个选项）` };
    }

    // ── 查票数 ───────────────────────────────────────────
    if (action === 'status') {
      const v = pick(all, args?.voteId);
      if (!v) return { ok: false, msg: `没找到投票 ${args?.voteId}` };
      saveAll(env, all);
      return { ok: true, msg: `${v.closed ? '【已结束】' : '【进行中】'}${v.id}「${v.topic}」\n${tallyBlock(v)}` };
    }

    // ── 结束并结算（AI 手动）────────────────────────────
    if (action === 'end') {
      const v = pick(all, args?.voteId);
      if (!v) return { ok: false, msg: `没找到投票 ${args?.voteId}` };
      const { first, block } = await finish(env, v, '');
      saveAll(env, all);
      return { ok: true, msg: `${first ? '已结束并结算' : '该投票此前已结束，重新结算'}：${v.id}「${v.topic}」\n${block}` };
    }

    return { ok: false, msg: `未知 action：${action}（可用：start / add / status / end）` };
  },

  async onInteraction(ctx, info) {
    const openid = String(ctx?.performer?.openid ?? '');
    if (!openid) return '拿不到你的身份，稍后再试~';

    const all = loadAll(ctx);
    const v = pick(all, info.cardId);
    if (!v) return '这次投票不存在或已被清理。';

    const who = `${openid.slice(0, 6)}…`;

    // ── 结束按钮 ─────────────────────────────────────────
    if (String(info.buttonId) === END_BTN) {
      if (v.closed) return '这次投票已经结束啦，结算在上面那条消息里。';
      await finish(ctx, v, who);
      saveAll(ctx, all);
      ctx.log?.(`[vote] ${v.id} 由 ${who} 点结束按钮`);
      return '✅ 已结束，结算发到群里了（也通知到 AI 了）。';
    }

    if (v.closed) return '这次投票已经结束啦，结算在上面那条消息里。';

    const idx = Number(String(info.buttonId ?? ''));
    if (!Number.isInteger(idx) || idx < 0 || idx >= v.options.length) return '这个选项不认识…';

    // 同一按钮只能投一次（但**可以**继续投别的选项 = 多选）
    if (hasChosen(v, openid, idx)) {
      return `你已经投过「${LETTERS[idx]}. ${v.options[idx]}」了（不过还能投别的选项）`;
    }
    const mine = choicesOf(v, openid);
    mine.push(idx);
    v.votes[openid] = mine;
    saveAll(ctx, all);

    const cnt = Object.values(v.votes).filter((c) => (Array.isArray(c) ? c : [c]).includes(idx)).length;
    ctx.log?.(`[vote] ${v.id} by=${who} → ${LETTERS[idx]}（该项第 ${cnt} 票）`);
    // ★ 中途回执只报这一票（主人要求：别甩整张表，完整结算只在结束时给）
    return `✅ 「${LETTERS[idx]}. ${v.options[idx]}」+1 票（当前 ${cnt} 票）`;
  },
};
