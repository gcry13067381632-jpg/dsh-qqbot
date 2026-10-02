/**
 * qun-admin.ts — QQ 群管理（纯 HTTP，不依赖浏览器，不依赖任何外部脚本）
 *
 * 走 QQ 群官网 qun.qq.com 的 qun_mgr 老接口：
 *   get_group_list / search_group_members / delete_group_member
 * 登录链路：xlogin(拿 login_sig) → ptqrshow(出二维码) → ptqrlogin(轮询扫码) → checkurl(取 cookie) → skey → bkn
 *
 * ⚠️ 实测踩过的坑（别改回去）：
 *   ① 业务接口的 User-Agent 必须用朴素的 'Mozilla/5.0'：
 *      用完整浏览器 UA 会被服务端判成非法请求，直接 404。
 *   ② 接口路径不要再叠 qun_mgr/ 前缀（API_BASE 已含 cgi-bin/）。
 *   ③ delete_group_member 的成员参数名是 **ul**（不是 uin），且要放 POST body：
 *        body: gc=xxx&ul=xxx  →  {"ec":0,"ul":[xxx]}      成功
 *        传 uin              →  {"ec":5}                  参数错误
 *        目标不在群里         →  {"ec":3}
 *        群不存在 / 无权限    →  {"ec":-100005}
 *   ④ search_group_members 的 key 参数只在 st=0&end=20 时生效；
 *      分页会丢页（684 人的群只拉回 661），所以能按 key 精确查就别全量拉。
 *   ⑤ ptqrlogin 轮询必须带 qrsig cookie + login_sig，否则连接被重置。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const APPID = '715030901';
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0';
/** 业务接口专用：朴素 UA（见坑①） */
const UA_API = 'Mozilla/5.0';
const API_BASE = 'https://qun.qq.com/cgi-bin/';

export interface QunCookie { uin: string; skey: string; p_skey?: string; at?: number }

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

/** QQ 登录令牌算法（ptqrtoken） */
export function hash33(s: string): number {
  let e = 0;
  for (let i = 0; i < s.length; i++) e += (e << 5) + s.charCodeAt(i);
  return e & 0x7fffffff;
}

/** 业务接口签名（bkn） */
export function getBkn(skey: string): number {
  let h = 5381;
  for (let i = 0; i < skey.length; i++) h += (h << 5) + skey.charCodeAt(i);
  return h & 0x7fffffff;
}

// ───────────────────────── 凭据存取 ─────────────────────────

export function qunCookieFile(dataRoot: string): string {
  return join(dataRoot, 'qun-cookie.json');
}

export function loadQunCookie(dataRoot: string): QunCookie | null {
  const f = qunCookieFile(dataRoot);
  if (!existsSync(f)) return null;
  try {
    const c = JSON.parse(readFileSync(f, 'utf8')) as QunCookie;
    return c && c.uin && c.skey ? c : null;
  } catch { return null; }
}

export function saveQunCookie(dataRoot: string, c: QunCookie): void {
  const f = qunCookieFile(dataRoot);
  try { mkdirSync(dirname(f), { recursive: true }); } catch { /* ignore */ }
  writeFileSync(f, JSON.stringify({ ...c, at: c.at ?? Date.now() }), 'utf8');
}

export function clearQunCookie(dataRoot: string): void {
  try { rmSync(qunCookieFile(dataRoot), { force: true }); } catch { /* ignore */ }
}

function cookieHeader(c: QunCookie): string {
  return `uin=o${c.uin}; skey=${c.skey}; p_uin=o${c.uin}; p_skey=${c.p_skey || ''};`;
}

// ───────────────────────── 业务接口 ─────────────────────────

/**
 * 调 qun_mgr 业务接口。
 * @param post 传对象时，extra+post 走 POST body（写操作必须这样）；不传则全部走 query。
 */
async function callMgr<T = Record<string, unknown>>(
  dataRoot: string,
  path: string,
  gc?: string | null,
  extra: Record<string, string> = {},
  post: Record<string, string> | null = null,
): Promise<T> {
  const c = loadQunCookie(dataRoot);
  if (!c) throw new Error('NOT_LOGGED_IN');
  const qs = new URLSearchParams({
    bkn: String(getBkn(c.skey)),
    ts: String(Date.now()),
    ...(gc ? { gc: String(gc) } : {}),
    ...(post ? {} : extra),
  });
  const res = await fetch(API_BASE + path + '?' + qs, {
    method: 'POST',
    headers: {
      'User-Agent': UA_API,
      Cookie: cookieHeader(c),
      Referer: 'https://qun.qq.com/',
      ...(post ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: post ? new URLSearchParams({ ...extra, ...post }).toString() : '',
  });
  const txt = await res.text();
  try { return JSON.parse(txt) as T; } catch { return { _raw: txt.slice(0, 300), _status: res.status } as T; }
}

// ───────────────────────── 扫码登录 ─────────────────────────

interface LoginState { qrsig: string; ptqrtoken: number; loginSig: string; at: number; qrPath: string; u1: string }
/** 登录中间态放内存：一个进程内同一个 dataRoot 只保留最近一次（二维码 3 分钟有效） */
const loginStates = new Map<string, LoginState>();

/**
 * 第一步：拿到二维码 PNG（存盘），返回路径给上层发出去。
 * 之后用 qunLoginPoll 轮询扫码结果。
 */
export async function qunLoginStart(dataRoot: string): Promise<{ ok: boolean; msg: string; qrPath?: string }> {
  const u1 = encodeURIComponent('https://qun.qq.com/');
  // ① xlogin：拿 login_sig（轮询必须带，否则 ECONNRESET）
  let loginSig = '';
  try {
    const rx = await fetch(
      'https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=' + APPID
      + '&daid=73&style=20&hide_title_bar=1&low_login=0&qlogin_auto_login=1&no_verifyimg=1'
      + '&link_target=blank&proj_self_def=1&s_url=' + encodeURIComponent('https://qun.qq.com/'),
      { headers: { 'User-Agent': UA_BROWSER, Referer: 'https://qun.qq.com/' } },
    );
    const scx = (rx.headers.getSetCookie ? rx.headers.getSetCookie() : []).join(';');
    loginSig = (/(?:^|;|\s)login_sig=([^;]+)/.exec(scx) || [])[1] || '';
  } catch { /* login_sig 拿不到也能试 */ }

  // ② ptqrshow：拿二维码图片 + qrsig cookie
  const r1 = await fetch(
    `https://xui.ptlogin2.qq.com/ssl/ptqrshow?appid=${APPID}&e=2&l=M&s=3&d=72&v=4&t=${Math.random()}&daid=73&pt_3rd_aid=0&u1=${u1}`,
    { headers: { 'User-Agent': UA_BROWSER, Referer: 'https://xui.ptlogin2.qq.com/' } },
  );
  const sc = (r1.headers.getSetCookie ? r1.headers.getSetCookie() : []).join(';');
  const qrsig = (/qrsig=([^;]+)/.exec(sc) || [])[1] || '';
  if (!qrsig) return { ok: false, msg: '没能从 QQ 拿到二维码（qrsig 为空），稍后重试' };

  const qrPath = join(dataRoot, 'qun-login-qr.png');
  try { mkdirSync(dirname(qrPath), { recursive: true }); } catch { /* ignore */ }
  writeFileSync(qrPath, Buffer.from(await r1.arrayBuffer()));

  loginStates.set(dataRoot, { qrsig, ptqrtoken: hash33(qrsig), loginSig, at: Date.now(), qrPath, u1 });
  return {
    ok: true,
    qrPath,
    msg: '二维码已生成（3 分钟内有效，手机 QQ 扫它）。'
      + '请立刻用 send_media 把这个图片发给主人，然后调 status 等扫码结果。',
  };
}

/**
 * 第二步：轮询扫码结果（最多等 budgetMs，默认 20 秒一轮，避免工具调用卡太久）。
 * 返回 done=true 表示已登录并写好了凭据。
 */
export async function qunLoginPoll(dataRoot: string, budgetMs = 20000): Promise<{ ok: boolean; done: boolean; msg: string }> {
  const st = loginStates.get(dataRoot);
  if (!st) return { ok: false, done: false, msg: '没有正在进行的扫码（二维码可能已过期），先调 login 重新出码' };
  if (Date.now() - st.at > 170000) {
    loginStates.delete(dataRoot);
    return { ok: false, done: false, msg: '二维码已过期（超过 3 分钟），请重新调 login' };
  }
  const common = `u1=${st.u1}&ptqrtoken=${st.ptqrtoken}&ptredirect=1&h=1&t=1&g=1&from_ui=1&ptlang=2052`
    + `&js_ver=26092315&js_type=1&login_sig=${encodeURIComponent(st.loginSig)}&pt_uistyle=40&aid=${APPID}&daid=73&has_onekey=1`;
  const ck = 'qrsig=' + st.qrsig + (st.loginSig ? '; login_sig=' + st.loginSig : '');
  const deadline = Date.now() + Math.max(3000, budgetMs);
  let last = '等待扫码…';
  while (Date.now() < deadline) {
    await sleep(3000);
    let txt = '';
    try {
      const r = await fetch(
        `https://xui.ptlogin2.qq.com/ssl/ptqrlogin?${common}&action=0-0-${Date.now()}`,
        { headers: { 'User-Agent': UA_BROWSER, Referer: 'https://xui.ptlogin2.qq.com/cgi-bin/qlogin', Cookie: ck } },
      );
      txt = await r.text();
    } catch { last = '网络抖动，继续等…'; continue; }
    const m = /ptuiCB\('(\d+)','(\d+)','([^']*)','[^']*','([^']*)'/.exec(txt);
    if (!m) continue;
    const code = m[1];
    if (code === '66') { last = '等待扫码…'; continue; }
    if (code === '65') { last = '已扫码，等手机上点「确认登录」…'; continue; }
    if (code === '67') { loginStates.delete(dataRoot); return { ok: false, done: false, msg: '二维码已失效，请重新调 login' }; }
    if (code === '0') {
      const checkUrl = m[3];
      if (!checkUrl) continue;
      const r3 = await fetch(checkUrl, { headers: { 'User-Agent': UA_BROWSER, Referer: 'https://xui.ptlogin2.qq.com/' }, redirect: 'manual' });
      const sc3 = (r3.headers.getSetCookie ? r3.headers.getSetCookie() : []).join(';');
      const get = (k: string): string => { const mm = new RegExp(k + '=([^;]+)').exec(sc3); return mm && mm[1] ? decodeURIComponent(mm[1]) : ''; };
      let uin = (/(\d{5,12})/.exec(get('uin') || get('superuin') || '') || [])[1] || '';
      if (!uin) { const mm = /uin=o(\d+)/.exec(sc3); uin = mm && mm[1] ? mm[1] : ''; }
      const skey = get('skey');
      if (!uin || !skey) return { ok: false, done: false, msg: '拿到了跳转但解析不出 uin/skey，请重新调 login' };
      saveQunCookie(dataRoot, { uin, skey, p_skey: get('p_skey'), at: Date.now() });
      loginStates.delete(dataRoot);
      return { ok: true, done: true, msg: `登录成功，uin=${uin}。现在可以 groups / members / kick 了。` };
    }
  }
  return { ok: true, done: false, msg: `${last}（这一轮没等到；可以再调 status 继续等，二维码还有效）` };
}

export function qunLoginPending(dataRoot: string): boolean {
  return loginStates.has(dataRoot);
}

// ───────────────────────── 群 / 成员 / 踢人 ─────────────────────────

export interface QunGroup { gc: string; gn: string; role: '我创建' | '我管理' }

export async function qunGroups(dataRoot: string): Promise<QunGroup[]> {
  const d = await callMgr<{ create?: Array<{ gc: number | string; gn: string }>; manage?: Array<{ gc: number | string; gn: string }> }>(
    dataRoot, 'qun_mgr/get_group_list', null,
  );
  const out: QunGroup[] = [];
  for (const g of (d.create || [])) out.push({ gc: String(g.gc), gn: String(g.gn), role: '我创建' });
  for (const g of (d.manage || [])) out.push({ gc: String(g.gc), gn: String(g.gn), role: '我管理' });
  return out;
}

/** 群号直通；群名做模糊匹配（多个命中就报错让人用群号） */
export async function qunResolveGc(dataRoot: string, gcOrName: string): Promise<{ ok: true; gc: string; gn: string } | { ok: false; msg: string }> {
  const s = String(gcOrName || '').trim();
  if (/^\d+$/.test(s)) return { ok: true, gc: s, gn: '' };
  if (!s) return { ok: false, msg: '请给群号或群名' };
  const all = await qunGroups(dataRoot);
  const hit = all.filter((g) => g.gn.includes(s));
  if (!hit.length) return { ok: false, msg: `没找到群「${s}」。我管的群：${all.map((g) => `${g.gn}(${g.gc})`).join('、') || '(空)'}` };
  if (hit.length > 1) return { ok: false, msg: `匹配到多个群：${hit.map((g) => `${g.gn}(${g.gc})`).join('、')}，请改用群号` };
  return { ok: true, gc: hit[0]!.gc, gn: hit[0]!.gn };
}

export interface QunMember { uin: string; nick: string; role?: number }

interface RawMember { uin?: number | string; nick?: string; name?: string; role?: number }

function mapMembers(ms: RawMember[]): QunMember[] {
  return ms.map((m) => ({ uin: String(m.uin ?? ''), nick: String(m.nick || m.name || ''), role: m.role }));
}

/**
 * 查群成员。
 * keyword 给 uin → 服务端精确查（快且准）；给昵称 → 先试服务端 key，不行再全量分页本地过滤。
 * 返回 count 是群总人数（服务端给的）。
 */
export async function qunMembers(
  dataRoot: string,
  gc: string,
  keyword?: string,
): Promise<{ ok: boolean; count?: number; members: QunMember[]; note?: string }> {
  const kw = String(keyword || '').trim();

  // 有关键词：先用 key 精确查（服务端只在 st=0&end=20 时认 key）
  if (kw) {
    const d = await callMgr<{ mems?: RawMember[]; count?: number }>(
      dataRoot, 'qun_mgr/search_group_members', gc, { st: '0', end: '20', sort: '0', key: kw },
    );
    const hit = mapMembers(d.mems || []);
    if (hit.length) return { ok: true, count: d.count, members: hit };

    // 服务端 key 查不到 → 全量分页兜底（可能丢页，见坑④）
    const all = await qunMembersAll(dataRoot, gc);
    const low = kw.toLowerCase();
    const filtered = all.members.filter((m) => m.uin === kw || m.nick.toLowerCase().includes(low));
    return {
      ok: true,
      count: all.count,
      members: filtered,
      note: filtered.length ? '（服务端 key 查不到，这是全量分页过滤的结果，分页可能丢页）' : undefined,
    };
  }

  const all = await qunMembersAll(dataRoot, gc);
  return { ok: true, count: all.count, members: all.members };
}

async function qunMembersAll(dataRoot: string, gc: string): Promise<{ count?: number; members: QunMember[] }> {
  let all: RawMember[] = [];
  let count: number | undefined;
  // ⚠️ 服务端把 st/end 当**闭区间**：st=0&end=20 会返回 21 条。
  //   必须按**实际返回条数**步进，否则每页重叠 1 条、去重后总数偏少（实测 683 人的群只拉回 661）。
  let st = 0;
  for (let guard = 0; guard < 200; guard++) {
    const d = await callMgr<{ mems?: RawMember[]; count?: number }>(
      dataRoot, 'qun_mgr/search_group_members', gc, { st: String(st), end: String(st + 20), sort: '0' },
    );
    const ms = d.mems || [];
    if (d.count) count = d.count;
    if (!ms.length) break;
    all = all.concat(ms);
    if (count && all.length >= count) break;
    st += ms.length;
  }
  const seen = new Set<string>();
  const members = mapMembers(all).filter((m) => (seen.has(m.uin) ? false : (seen.add(m.uin), true)));
  return { count, members };
}

/** 按 uin 精确存在性判断（踢完验证用，也最快） */
export async function qunHasMember(dataRoot: string, gc: string, uin: string): Promise<boolean> {
  const d = await callMgr<{ mems?: RawMember[] }>(
    dataRoot, 'qun_mgr/search_group_members', gc, { st: '0', end: '20', sort: '0', key: String(uin) },
  );
  return (d.mems || []).some((m) => String(m.uin) === String(uin));
}

/** ec 码解释（实测 + 社区经验） */
function explainEc(ec: number): string {
  if (ec === 0) return '成功';
  if (ec === 3) return '该成员不在这个群里（或没有可移除的身份）';
  if (ec === 5) return '参数错误（ul 传法不对）';
  if (ec === -100005) return '群不存在，或当前账号对这个群没有管理权限';
  if (ec === 1) return '权限不足';
  return '未知错误';
}

/** 踢人（可多个）。返回逐条结果。 */
export async function qunKick(
  dataRoot: string,
  gc: string,
  uins: string[],
): Promise<Array<{ uin: string; ec: number; msg: string }>> {
  const out: Array<{ uin: string; ec: number; msg: string }> = [];
  for (const u of uins) {
    const d = await callMgr<{ ec?: number; em?: string }>(
      dataRoot, 'qun_mgr/delete_group_member', gc, { ul: String(u) }, { ul: String(u) },
    );
    const ec = Number(d.ec ?? NaN);
    let msg = explainEc(ec);
    if (ec === 5 && d.em) msg += ' raw=' + String(d.em).slice(0, 60);
    if (!Number.isFinite(ec)) msg = '返回无法解析: ' + JSON.stringify(d).slice(0, 120);
    out.push({ uin: String(u), ec: Number.isFinite(ec) ? ec : -999, msg });
    await sleep(400);
  }
  return out;
}
