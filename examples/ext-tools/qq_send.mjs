/**
 * qq_send — 查 QQ 聊天对象 + 发消息（单条 / 连发多条）
 *
 * ★ 2026-10-10 主人定：原 `send_texts` 已**并入本工具** —— 一个入口覆盖
 *   「查对象 / 发一条 / 连发多条」，省得在工具之间选错。
 *
 * 场景：**非 QQ 通道**的会话（web / 终端）也能隔着通道把消息发进某个群或私聊。
 * 数据来源：`expose: 'all'` 注入的 `env.qq`（账号包，由插件按"人设 id"构造）。
 *
 * 动作：
 *   · action:"list" —— 列出已知聊天对象（群 / 私聊，带最近活跃时间），可用 query 过滤
 *   · action:"send"（默认）—— 发消息：target 可用 **openid**，也可用**群名 / 昵称**
 *   · 连发 —— 同一次 send 里给 `texts:[多条]`（内容不同）或 `text`+`count`（同一条重复 N 次）
 *
 * 发送链路（插件侧 env.qq.sendText 实现）：先查**目标会话最近的 msgId** 走被动回复，
 *   失败（过期／配额用尽／没窗口）自动去掉 msgId 转**主动**兜底。
 *
 * 纪律：
 *   ⛔ 按名字寻址时**绝不猜** —— 命中 0 个或多个只回候选清单；
 *   ✅ 返回据实 —— 成功/失败条数都报出来，不谎报。
 */
const MAX_LIST = 40;
const MAX_SEND = 50;

const isOpenid = (s) => /^[A-Za-z0-9_-]{16,}$/.test(String(s || ''));
const shortId = (id) => (String(id || '').length > 14 ? String(id).slice(0, 12) + '…' : String(id || ''));
const when = (ts) => {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  try { return new Date(n).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
};
const line = (scope, x) => `[${scope === 'c2c' ? '私聊' : '群'}] ${x.name ? x.name : '(无名)'} · ${shortId(x.id)}${when(x.lastAt) ? ' （' + when(x.lastAt) + '）' : ''}`;

export default {
  name: 'qq_send',
  expose: 'all',
  description: '查询本机器人的 QQ 聊天对象（群/私聊），并向指定对象发送文本消息——单条或连发多条。目标可用 openid，也可用群名/昵称（模糊命中多个时不猜，只回候选）',
  inputSchema: {
    action: { type: 'string', enum: ['list', 'send'], description: 'list=只查询聊天对象；send=发消息（默认）' },
    query: { type: 'string', description: 'action=list 用：按名字或 ID 过滤的关键词' },
    target: { type: 'string', description: 'action=send 用：群 openid / 用户 openid / 群名·昵称' },
    scope: { type: 'string', enum: ['group', 'c2c'], description: 'action=send 用：目标类型（用 openid 时建议写明；按名字找可省）' },
    text: { type: 'string', description: '要发的文本（单条；配 count 可重复发 N 次）' },
    texts: { type: 'array', items: { type: 'string' }, description: '要依次发的多条文本（与 text+count 二选一）' },
    count: { type: 'integer', description: '把 text 重复发几次（1~50，默认 1）' },
    intervalMs: { type: 'integer', description: '连发时每条之间的间隔毫秒（默认 600，防 QQ 吞消息）' },
  },
  run: async (args, env) => {
    const qq = env && env.qq;
    if (!qq) {
      return { ok: false, msg: '拿不到 QQ 账号包（env.qq）—— 需要该工具声明 expose:"all"，且对应人设实例在线' };
    }
    const groups = Array.isArray(qq.groups) ? qq.groups : [];
    const c2c = Array.isArray(qq.c2c) ? qq.c2c : [];

    // ── list：只查 ──────────────────────────────────────────────
    if (args.action === 'list') {
      const q = String(args.query || '').trim().toLowerCase();
      const hit = (x) => !q || String(x.name || '').toLowerCase().includes(q) || String(x.id || '').toLowerCase().includes(q);
      const g = groups.filter(hit);
      const c = c2c.filter(hit);
      if (!g.length && !c.length) {
        return { ok: true, msg: `没有匹配「${String(args.query || '')}」的对象（已知群 ${groups.length} 个 / 私聊 ${c2c.length} 个）` };
      }
      const out = [];
      out.push(`人设「${qq.preset || qq.tag || '?'}」已知聊天对象：群 ${g.length} / 私聊 ${c.length}`);
      if (g.length) out.push('— 群 —\n' + g.slice(0, MAX_LIST).map((x) => '  ' + line('group', x)).join('\n'));
      if (c.length) out.push('— 私聊 —\n' + c.slice(0, MAX_LIST).map((x) => '  ' + line('c2c', x)).join('\n'));
      if (g.length > MAX_LIST || c.length > MAX_LIST) out.push(`（每类最多显示 ${MAX_LIST} 条，可用 query 过滤）`);
      return { ok: true, msg: out.join('\n') };
    }

    // ── send：发（单条 / 连发）────────────────────────────────────
    const raw = String(args.target || '').trim();
    if (!raw) return { ok: false, msg: '需要 target（群 openid / 用户 openid / 群名·昵称）' };
    let scope = args.scope === 'c2c' ? 'c2c' : (args.scope === 'group' ? 'group' : '');

    // 组装待发清单：texts 优先，其次 text × count
    let list = [];
    if (Array.isArray(args.texts)) list = args.texts.map((s) => String(s)).filter((s) => s.trim());
    else if (args.text) {
      const n = Math.max(1, Math.min(MAX_SEND, Math.round(Number(args.count) || 1)));
      list = Array.from({ length: n }, () => String(args.text));
    }
    if (!list.length) return { ok: false, msg: '没有要发的内容：给 text（单条/配 count 重复）或 texts（多条）' };
    if (list.length > MAX_SEND) list = list.slice(0, MAX_SEND);

    // 解析目标：openid 直接用；否则按名字找（唯一才发）
    let id = '';
    let label = raw;
    if (isOpenid(raw)) {
      id = raw;
      if (!scope) {
        if (groups.some((x) => x.id === raw)) scope = 'group';
        else if (c2c.some((x) => x.id === raw)) scope = 'c2c';
        else scope = raw.length > 30 ? 'group' : 'c2c';
      }
      const known = (scope === 'group' ? groups : c2c).find((x) => x.id === raw);
      label = (known && known.name) ? known.name : raw;
    } else {
      const pool = [];
      if (!scope || scope === 'group') {
        for (const x of groups) if (String(x.name || '').includes(raw) || String(x.id) === raw) pool.push({ scope: 'group', ...x });
      }
      if (!scope || scope === 'c2c') {
        for (const x of c2c) if (String(x.name || '').includes(raw) || String(x.id) === raw) pool.push({ scope: 'c2c', ...x });
      }
      if (!pool.length) return { ok: false, msg: `找不到「${raw}」这个聊天对象 —— 可先用 action:"list" 看一眼已知的群/私聊` };
      if (pool.length > 1) {
        return {
          ok: false,
          msg: `「${raw}」命中 ${pool.length} 个候选，人家不猜着发 —— 请用 openid 指定：\n` + pool.slice(0, 8).map((x) => '  ' + line(x.scope, x)).join('\n'),
        };
      }
      scope = pool[0].scope;
      id = pool[0].id;
      label = pool[0].name || id;
    }

    const gap = Number.isFinite(Number(args.intervalMs)) ? Number(args.intervalMs) : 600;
    const where = scope === 'c2c' ? '私聊' : '群';
    let ok = 0;
    const errs = [];
    for (let i = 0; i < list.length; i++) {
      let sent = false;
      try { sent = await qq.sendText(scope, id, list[i]); } catch { sent = false; }
      if (sent) ok += 1; else errs.push('第' + (i + 1) + '条');
      if (i < list.length - 1 && gap > 0) await new Promise((r) => setTimeout(r, gap));
    }
    if (ok === list.length) {
      return { ok: true, msg: list.length === 1 ? `已发送到${where}「${label}」✓` : `已向${where}「${label}」连发 ${ok} 条 ✓（间隔 ${gap}ms）` };
    }
    return {
      ok: ok > 0,
      msg: `发往${where}「${label}」：成功 ${ok}/${list.length} 条${errs.length ? '，失败：' + errs.slice(0, 5).join('、') : ''}（失败多为 QQ 侧拒绝：被动窗口过期且主动消息不可用）`,
    };
  },
};
