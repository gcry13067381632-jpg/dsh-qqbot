/**
 * qqbot-settings — host 半边: ①im-qqbot settings 命名空间经同源路由暴露给设置面板;
 * ②表情包图库管理 API(列表/缩略图/批量/导入), 与 dsh-qqbot 共享同进程 store 单例。
 * 仅 web profile 装配; 同源 fence 抄 modsearch。
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync, readdirSync, statSync, cpSync, renameSync, openSync, readSync, closeSync, createWriteStream } from 'node:fs';
import { extname, join, resolve, dirname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { getStickerStore } from '@zaofan/dsh-qqbot/sticker-store';
import { getScheduleStore } from '@zaofan/dsh-qqbot/schedule-store';

export const name = 'qqbot-settings';
export const inject = ['settings', 'webServer', 'agentPresets'];

const NS = 'im-qqbot';
/**
 * 定位宿主 profile 根(账号实例 patch 所在)。优先代码位置(实体安装: 包根上溯 3 级 = profile 根,
 * 上溯层级在单包合并时已按包根位置修正); 若该位置没有 cordis.patch.yml(link/symlink 安装时
 * 本文件被从源码目录加载), 则扫描 ~/.dsh/profiles/* 找装着 @zaofan/dsh-qqbot 的 profile。
 */
function resolveProfileRoot() {
  const byLocation = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  try {
    if (existsSync(join(byLocation, 'cordis.patch.yml'))) return byLocation;
  } catch { /* 继续扫描 */ }
  try {
    const base = join(homedir(), '.dsh', 'profiles');
    for (const name of readdirSync(base)) {
      const prof = resolve(base, name);
      try {
        if (!statSync(prof).isDirectory()) continue;
      } catch { continue; }
      try {
        if (existsSync(join(prof, 'node_modules', '@zaofan', 'dsh-qqbot'))) return prof;
      } catch { /* 走下一判据 */ }
      try {
        const pkg = JSON.parse(readFileSync(join(prof, 'package.json'), 'utf8'));
        const blob = JSON.stringify(pkg.dsh?.profile?.bundles ?? []) + JSON.stringify(pkg.dependencies ?? {});
        if (blob.includes('@zaofan/dsh-qqbot')) return prof;
      } catch { /* 无 package.json, 跳过 */ }
    }
  } catch { /* profiles 目录不存在 */ }
  return byLocation;
}
const PROFILE_ROOT = resolveProfileRoot();
/** cordis.patch.yml = 宿主插件装配文件(账号实例声明处; 改它需重启 dsh 生效) */
const PATCH_FILE = join(PROFILE_ROOT, 'cordis.patch.yml');
/** agent 预设根目录(用户可写; 每预设一个子目录, 目录名=预设 id) */
const PRESET_ROOT = join(homedir(), '.dsh', '.agent-presets');
/** 复制预设时排除的备份/压缩类文件(不把主人的隐私压缩包带进新预设) */
const COPY_SKIP = /\.(rar|zip|7z|bak|tmp|log|diag)$/i;
/** 预设 id 校验: 文件夹命名规范(字母数字开头, 允许 - _) */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** 同源回环 fence: 仅本机 loopback + 同源/无 Origin 放行 */
function isTrusted(req) {
  const h = req.headers?.host;
  if (typeof h !== 'string') return false;
  let hostname;
  try { hostname = new URL(`http://${h}`).hostname; } catch { return false; }
  const loopback = /^(\[::1\]|localhost|127(\.\d{1,3}){3})$/.test(hostname);
  if (!loopback) return false;
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  const o = req.headers?.origin;
  if (o === undefined) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 8 * 1024 * 1024) return undefined;
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}

/** 读命名空间当前解析值 + revision(redact 防密钥外泄) */
function viewOf(settings, ns) {
  const target = ns || NS;
  const d = settings.describe({ redactSecrets: true }).find((x) => x.ns === target);
  return d ? { value: d.value, revision: d.revision } : { value: undefined, revision: undefined };
}

/** 请求里的目录参数(dataDir 显式传; 空=primary 主账号) */
function dirOf(u, key) {
  return (u?.searchParams?.get(key) || '').trim() || undefined;
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

/** 注册一条路由, 统一 fence + method 检查 */
function route(ctx, method, path, handler) {
  const methods = Array.isArray(method) ? method : [method];
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!isTrusted(req)) return writeJson(res, 403, { error: 'refused: same-origin loopback only' });
      if (!methods.includes(req.method)) return writeJson(res, 405, { error: 'method not allowed' });
      try { await handler(req, res); } catch (e) { writeJson(res, 500, { error: String(e?.message ?? e) }); }
    },
  }), `qqbot-settings: ${path}`);
}

export function apply(ctx) {
  // ── 临时诊断(排查"设置读取失败"): settings 服务可用性 + 已注册命名空间 ──
  route(ctx, 'GET', '/api/qqbot-settings/_debug', async (_req, res) => {
    try {
      const hasSettings = !!ctx.settings;
      let nss = [];
      let describeErr = null;
      try {
        const all = ctx.settings.describe({});
        nss = (Array.isArray(all) ? all : []).map((x) => x.ns);
      } catch (e) { describeErr = String(e?.message ?? e); }
      writeJson(res, 200, { hasSettings, nss, describeErr });
    } catch (e) { writeJson(res, 500, { error: String(e?.message ?? e) }); }
  });

  // ── 设置面板读写桥(多账号: ?ns= 选实例命名空间; 缺省 im-qqbot 主账号) ──
  route(ctx, 'GET', '/api/qqbot-settings/read', async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    writeJson(res, 200, viewOf(ctx.settings, u.searchParams.get('ns') || undefined));
  });
  route(ctx, 'POST', '/api/qqbot-settings/update', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'body must be JSON object' });
    const ns = typeof body.ns === 'string' && body.ns ? body.ns : NS;
    try {
      await ctx.settings.update(ns, body.patch ?? {}, typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined);
      writeJson(res, 200, viewOf(ctx.settings, ns));
    } catch (e) {
      const code = e?.code ?? '';
      if (code === 'SETTINGS_CONFLICT' || code === 'SettingsConflictError') return writeJson(res, 409, { error: e.message });
      writeJson(res, 400, { error: String(e?.message ?? e) });
    }
  });

  // ── 定时唤醒辅助: 机器人见过的聊天台账(群/私聊带昵称) ──
  // 台账文件 {store.dataDir}/known-chats.jsonl 由 dsh-qqbot 中间件 append(见 dsh-qqbot src/features/chat-ledger.ts)。
  // 用途: Web 设置④区下拉点选目标(免抄 openid)——群无群名, 用最近发言者昵称帮主人辨认。
  // 多账号: ?dataDir= 指定账号图库目录(台账与之同目录); 缺省 primary。
  route(ctx, 'GET', '/api/qqbot-settings/known-chats', async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://x');
      const store = dirOf(u, 'dataDir') ? getStickerStore(dirOf(u, 'dataDir')) : getStickerStore();
      const dataDir = store.dataDir;
      const lines = [];
      try {
        const raw = readFileSync(join(dataDir, 'known-chats.jsonl'), 'utf8');
        for (const l of raw.split('\n')) {
          const t = l.trim();
          if (!t) continue;
          try {
            const o = JSON.parse(t);
            if (o && typeof o.id === 'string' && (o.scope === 'group' || o.scope === 'c2c')) {
              lines.push({ ts: typeof o.ts === 'number' ? o.ts : 0, scope: o.scope, id: o.id, name: typeof o.name === 'string' ? o.name : undefined });
            }
          } catch { /* 坏行跳过 */ }
        }
      } catch { /* 台账文件尚不存在 */ }
      const map = new Map();
      for (const l of lines) {
        const key = l.scope + ':' + l.id;
        const cur = map.get(key);
        if (!cur) map.set(key, { scope: l.scope, id: l.id, name: l.name, lastSeen: l.ts, count: 1 });
        else {
          cur.count += 1;
          if (l.ts > cur.lastSeen) { cur.lastSeen = l.ts; if (l.name) cur.name = l.name; }
        }
      }
      const chats = [...map.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 80);
      writeJson(res, 200, { chats });
    } catch (e) {
      writeJson(res, 500, { error: String(e?.message ?? e) });
    }
  });

  // ── 定时任务管理(会话内 AI 用 schedule_timer 建的: once/daily, .qqbot/timers.json) ──
  // 多账号: ?schedDir= / body.schedDir 指定账号定时目录(join(cwd,'.qqbot')); 缺省 primary。
  // 本页只管 查看/开关/删除(新建在 QQ 会话里让 AI 建)。
  function timerJobs(schedDir) {
    const store = schedDir ? getScheduleStore(schedDir) : getScheduleStore();
    const now = Date.now();
    return store.list().map((j) => ({
      id: j.id, kind: j.kind, scope: j.scope, peerId: j.peerId,
      atTime: j.atTime || null, dueAt: j.dueAt || null,
      prompt: j.prompt, createdAt: j.createdAt, enabled: j.enabled,
      lastRunDate: j.lastRunDate || null,
      nextFireAt: store.nextFireAt(j, now),
    }));
  }
  route(ctx, ['GET', 'POST'], '/api/qqbot-settings/timers', async (req, res) => {
    // POST = 旧版客户端统一 action: body {id, schedDir?, enabled?} —— enabled 存在=开关, 缺省=删除
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body || typeof body.id !== 'string') return writeJson(res, 400, { error: 'id required' });
      const store = typeof body.schedDir === 'string' && body.schedDir ? getScheduleStore(body.schedDir) : getScheduleStore();
      const removing = body.enabled === undefined;
      const ok = removing ? store.remove(body.id) : store.setEnabled(body.id, body.enabled === true);
      try { store.flush(); } catch { /* ignore */ }
      if (!ok) return writeJson(res, 404, { error: '任务不存在' });
      return writeJson(res, 200, { ok: true });
    }
    const u = new URL(req.url ?? '/', 'http://x');
    writeJson(res, 200, { jobs: timerJobs(dirOf(u, 'schedDir')) });
  });
  // 开关: {id, enabled, schedDir?}
  route(ctx, 'POST', '/api/qqbot-settings/timers/toggle', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body.id !== 'string') return writeJson(res, 400, { error: 'id required' });
    const store = typeof body.schedDir === 'string' && body.schedDir ? getScheduleStore(body.schedDir) : getScheduleStore();
    const ok = store.setEnabled(body.id, body.enabled === true);
    try { store.flush(); } catch { /* ignore */ }
    if (!ok) return writeJson(res, 404, { error: '任务不存在' });
    writeJson(res, 200, { ok: true });
  });
  // 删除: {id, schedDir?}
  route(ctx, 'POST', '/api/qqbot-settings/timers/delete', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body.id !== 'string') return writeJson(res, 400, { error: 'id required' });
    const store = typeof body.schedDir === 'string' && body.schedDir ? getScheduleStore(body.schedDir) : getScheduleStore();
    const ok = store.remove(body.id);
    try { store.flush(); } catch { /* ignore */ }
    if (!ok) return writeJson(res, 404, { error: '任务不存在' });
    writeJson(res, 200, { ok: true });
  });

  // ── 账号与预设管理(第4 tab) ──
  // 账号实例声明在 cordis.patch.yml(改它需重启 dsh 生效); appSecret 明文存本机 profile, 勿提交 git。

  /** YAML 单引号标量(含 ' 转义为 '') */
  function yq(v) { return `'${String(v ?? '').replace(/'/g, "''")}'` }
  /** appSecret 裸写规则: 纯安全字符直接裸, 否则单引号 */
  function ysec(v) { const s = String(v ?? ''); return /^[A-Za-z0-9+/=_\-]+$/.test(s) ? s : yq(s) }
  /** 顶层块行判断(0 缩进以 "- " 开头) */
  function isTopLine(l) { return /^-\s/.test(l) }
  /** 块头是 im-qqbot 实例? */
  function isBotHead(l) { const m = /^-\s*id:\s*(\S+)\s*$/.exec(l.trim()); return m ? /^im-qqbot(-|$)/.test(m[1]) : false }
  function botIdOf(headLine) { const m = /^-\s*id:\s*(\S+)\s*$/.exec(headLine.trim()); return m ? m[1] : '' }

  /** 解析 patch: 返回 {raw, bots:[{id,start,end,ins,cfg:{appId,appSecret,preset,cwd},disabled}], hasFile}
   *  patch 语义(宿主 dsh-app-boot applyEntryPatches): 顶层 `- id: X` 只能覆盖已存在 id(bundle insert 建的);
   *  新增实例必须 `- insert:` 包装(其下 4 空格 `- id: Y`)。本文件里两种形态都识别。 */
  function parsePatch() {
    const hasFile = existsSync(PATCH_FILE);
    const raw = hasFile ? readFileSync(PATCH_FILE, 'utf8') : '';
    // 行尾容错: 兼容 CRLF(2026-09-08 曾因 patch 被写成 CRLF 导致整段解析失败)
    const lines = raw.split(/\r?\n/);
    const bots = [];
    let i = 0;
    while (i < lines.length) {
      const t = lines[i];
      if (isTopLine(t) && isBotHead(t)) {
        // 顶层覆盖形态: head 缩进 0
        const id = botIdOf(t);
        const start = i;
        let j = i + 1;
        const cfg = {};
        let disabled = false;
        let inCfg = false;
        while (j < lines.length && (lines[j].trim() === '' || !isTopLine(lines[j]))) {
          const c = lines[j];
          if (/^\s{2}config:\s*$/.test(c)) inCfg = true;
          else if (/^\s{2}disabled:\s*true\s*$/.test(c)) disabled = true;
          else if (inCfg && /^\s{4}(\S[^:]*):\s*(.*)$/.test(c)) {
            const km = /^\s{4}(\S[^:]*):\s*(.*)$/.exec(c);
            cfg[km[1]] = km[2].trim().replace(/^'|'$/g, '').replace(/''/g, "'");
          }
          j += 1;
        }
        bots.push({ id, start, end: j, ins: false, cfg, disabled });
        i = j;
      } else if (isTopLine(t) && /^\s*-\s*insert:\s*$/.test(t)) {
        // insert 形态: 找其下 4 空格 `- id: im-qqbot*`
        const insStart = i;
        let k = i + 1;
        let found = null;
        while (k < lines.length && (lines[k].trim() === '' || /^\s/.test(lines[k]) && !/^-\s/.test(lines[k]) || /^\s{2,}/.test(lines[k]))) {
          // 在 insert 列表内(行以空白开头或为列表项), 找 4 空格 "- id:"
          const c = lines[k];
          const m4 = /^\s{4}-\s*id:\s*(\S+)\s*$/.exec(c);
          if (m4 && /^im-qqbot(-|$)/.test(m4[1])) { found = { line: k, id: m4[1] }; break; }
          if (/^-\s/.test(c) && !/^\s/.test(c)) break; // 下一个顶层条目
          if (c.trim() !== '' && !/^\s/.test(c) && !/^-\s/.test(c)) break;
          k += 1;
        }
        if (found) {
          const id = found.id;
          let j = found.line + 1;
          const cfg = {};
          let disabled = false;
          let inCfg = false;
          while (j < lines.length && (lines[j].trim() === '' || /^\s{2,}/.test(lines[j]) && !isTopLine(lines[j]))) {
            const c = lines[j];
            if (/^\s{6}config:\s*$/.test(c)) inCfg = true;
            else if (/^\s{6}disabled:\s*true\s*$/.test(c)) disabled = true;
            else if (inCfg && /^\s{8}(\S[^:]*):\s*(.*)$/.test(c)) {
              const km = /^\s{8}(\S[^:]*):\s*(.*)$/.exec(c);
              cfg[km[1]] = km[2].trim().replace(/^'|'$/g, '').replace(/''/g, "'");
            }
            if (isTopLine(lines[j])) break;
            j += 1;
          }
          bots.push({ id, start: insStart, end: j, ins: true, cfg, disabled });
          i = j;
        } else {
          i += 1;
        }
      } else {
        i += 1;
      }
    }
    return { raw, hasFile, bots };
  }

  /** 渲染一个实例块。主 im-qqbot(bundle 已 insert)→ 顶层覆盖; 新实例 → `- insert:` 包装(4/6/8 缩进) */
  function renderBotBlock(inst) {
    const id = String(inst.id || 'im-qqbot');
    const isMain = id === 'im-qqbot';
    const L0 = isMain ? 0 : 4; // 条目行缩进(主=0, insert 内=4)
    const pad0 = ' '.repeat(L0);
    const pad2 = ' '.repeat(L0 + 2);
    const pad4 = ' '.repeat(L0 + 4);
    const out = [];
    if (!isMain) out.push('- insert:');
    out.push(`${pad0}- id: ${id}`);
    if (!isMain) out.push(`${pad2}name: '@zaofan/dsh-qqbot'`);
    if (inst.disabled) out.push(`${pad2}disabled: true`);
    out.push(`${pad2}config:`);
    if (inst.appId) out.push(`${pad4}appId: ${yq(inst.appId)}`);
    if (inst.appSecret) out.push(`${pad4}appSecret: ${ysec(inst.appSecret)}`);
    if (!isMain) out.push(`${pad4}settingsNs: ${yq(id)}`); // 多账号实例身份: settings 命名空间按实例唯一
    if (inst.preset) out.push(`${pad4}preset: ${yq(inst.preset)}`);
    out.push(`${pad4}requireMention: false`);
    out.push(`${pad4}historyLimit: 20`);
    if (inst.cwd) out.push(`${pad4}cwd: ${yq(inst.cwd)}`);
    if (inst.dataRoot) out.push(`${pad4}dataRoot: ${yq(inst.dataRoot)}`); // 数据根(可选; 保存时保留, 见 saveInstances)
    return out.join('\n');
  }

  /** 保存实例清单(全量同步; 行级重建, 其它插件行/注释原样保留)
   *  借鉴 dsh-qqbot-panel(2026-09-06): appSecret 空值/掩码(********) = 保留原值,
   *  只有提供全新非掩码值才覆盖 —— 前端只回显掩码, 不会因漏传/未改而误清 secret。
   *  ⚠️ 2026-09-09: dataRoot 同理 —— 前端不编辑它, 保存时必须保留原值,
   *     否则 accounts/save 会把 patch.yml 里的 dataRoot 覆盖掉(图库路径回退 cwd 的根因)。 */
  function saveInstances(instances) {
    const { raw, hasFile, bots } = parsePatch();
    if (!hasFile) return { ok: false, error: '找不到 cordis.patch.yml(仅 web profile 支持)' };
    const lines = raw.split('\n');
    const edits = [];
    const targetIds = new Set(instances.filter((x) => !x.remove).map((x) => String(x.id)));
    for (const b of bots) {
      if (!targetIds.has(b.id)) edits.push({ start: b.start, end: b.end, text: null });
    }
    for (const inst of instances) {
      if (inst.remove) continue;
      const t = bots.find((b) => b.id === inst.id);
      const orig = bots.find((b) => b.id === inst.id);
      // 掩码/空 → 保留原 secret(仅当原值存在; 全新账号本就无原值则维持空)
      if (!inst.appSecret || inst.appSecret === SECRET_MASK) {
        if (orig && orig.cfg?.appSecret) inst.appSecret = orig.cfg.appSecret;
        else inst.appSecret = '';
      }
      // 前端不编辑 dataRoot → 保留原值(2026-09-09: 曾因保存覆盖丢失导致图库路径回退 cwd)
      if (inst.dataRoot === undefined && orig && orig.cfg?.dataRoot) inst.dataRoot = orig.cfg.dataRoot;
      const blockText = renderBotBlock(inst);
      if (t) edits.push({ start: t.start, end: t.end, text: blockText });
      else edits.push({ append: blockText });
    }
    edits.filter((e) => e.start !== undefined).sort((a, b) => b.start - a.start).forEach((e) => {
      if (e.text === null) lines.splice(e.start, e.end - e.start);
      else lines.splice(e.start, e.end - e.start, ...e.text.split('\n'));
    });
    let out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
    const appendParts = edits.filter((e) => e.append).map((e) => e.append);
    if (appendParts.length) out += (out ? '\n' : '') + appendParts.join('\n') + '\n';
    writeFileSync(`${PATCH_FILE}.bak`, raw, 'utf8');
    writeFileSync(PATCH_FILE, out, 'utf8');
    return { ok: true, file: PATCH_FILE, needRestart: true };
  }

  // 账号列表(多账号: 每条带 settings ns 与数据目录, 供二级 UI 按账号读写)
  // 借鉴 zhengjy01/dsh-qqbot-panel(2026-09-06): appSecret 只回显掩码(不泄露明文),
  // 并带 hasSecret 供前端区分"已保存"与"真空"; 保存时空值/掩码 = 保留原 secret。
  const SECRET_MASK = '********';
  route(ctx, 'GET', '/api/qqbot-settings/accounts', async (_req, res) => {
    try {
      const { bots, hasFile } = parsePatch();
      const reg = await import('./dist/features/session-registry.js');
      writeJson(res, 200, {
        hasFile,
        instances: bots.map((b) => {
          const cwd = b.cfg?.cwd || '';
          const droot = b.cfg?.dataRoot || cwd;
          return {
            id: b.id,
            ns: b.id, // settings 命名空间 = 实例 id(主 im-qqbot; 非主实例 render 已写 settingsNs=id)
            appId: b.cfg?.appId || '',
            appSecret: b.cfg?.appSecret ? SECRET_MASK : '', // 掩码回显(借鉴 panel: masked)
            hasSecret: !!b.cfg?.appSecret,
            preset: b.cfg?.preset || '',
            cwd,
            disabled: !!b.disabled,
            online: typeof reg.isBotOnline === 'function' ? reg.isBotOnline(b.id) : false, // 在线状态(bot ws ready 事件驱动)
            // 账号数据目录(各号各库各定时): 图库={cwd}/表情包, 定时={cwd}/.qqbot
            dataDir: droot ? join(droot, '表情包') : '',
            schedDir: droot ? join(droot, '.qqbot') : '',
          };
        }),
      });
    } catch (e) { writeJson(res, 500, { error: String(e?.message ?? e) }); }
  });
  // 保存账号清单: body {instances:[{id,appId,appSecret,preset,cwd,disabled,remove}]}
  route(ctx, 'POST', '/api/qqbot-settings/accounts/save', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || !Array.isArray(body.instances)) return writeJson(res, 400, { error: 'instances 数组必填' });
    try {
      const r = saveInstances(body.instances);
      writeJson(res, r.ok ? 200 : 400, r);
    } catch (e) { writeJson(res, 500, { error: String(e?.message ?? e) }); }
  });

  // ── 工作区列表(借鉴 zhengjy01/dsh-qqbot-panel 的 workspace picker, 2026-09-06):
  //    列出"已有 dsh 会话"的工作区目录 + 会话数, 供账号 cwd 挑选(避免指到空目录/错目录)。
  //    dsh 把会话按工作区路径归到 ~/.dsh/sessions/--<编码路径>--, 目录内 *.zstd = 会话数。
  /** dsh session 目录名 → 工作区绝对路径(~XXXX 为 UTF-16 code unit, - 为段分隔, 首段补盘符冒号) */
  function decodeSessionDirName(name) {
    try {
      const segs = name.split('-').filter(Boolean);
      if (segs.length === 0) return '';
      const decoded = segs.map((s) => s.replace(/~([0-9A-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16))));
      // 首段是盘符(D / C) → 补冒号; 其余段拼回路径分隔
      const head = /^[A-Za-z]$/.test(decoded[0]) ? decoded[0] + ':' : decoded[0];
      return [head].concat(decoded.slice(1)).join('\\');
    } catch { return ''; }
  }
  route(ctx, 'GET', '/api/qqbot-settings/workspaces', async (_req, res) => {
    try {
      const sessionsRoot = join(homedir(), '.dsh', 'sessions');
      const out = [];
      if (existsSync(sessionsRoot)) {
        for (const ent of readdirSync(sessionsRoot, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue;
          const dir = join(sessionsRoot, ent.name);
          let count = 0;
          try {
            // 会话文件(.zstd)在 workspace 目录的深层子目录里, 需递归统计
            const stack = [dir];
            while (stack.length) {
              const cur = stack.pop();
              for (const f of readdirSync(cur, { withFileTypes: true })) {
                const p = join(cur, f.name);
                if (f.isDirectory()) stack.push(p);
                else if (f.isFile() && f.name.endsWith('.zstd')) count += 1;
              }
            }
          } catch { /* 目录读取失败忽略 */ }
          const path = decodeSessionDirName(ent.name);
          out.push({ dir: ent.name, path: path || ent.name, count });
        }
      }
      out.sort((a, b) => b.count - a.count);
      writeJson(res, 200, { workspaces: out });
    } catch (e) { writeJson(res, 500, { error: String(e?.message ?? e) }); }
  });

  // ── agent 预设: 列表/复制/打开文件夹/说明 ──
  /** QQ 通道工具插件的规范行 id/name(复制预设时自动补上; 新行名跟随本安装主包) */
  const CHANNEL_TOOLS_ROW_ID = 'qqbot-channel-tools';
  const CHANNEL_TOOLS_ROW_NAME = '@zaofan/dsh-qqbot/channel-tools';
  /** 检测 preset 的 agent.cordis.yml 是否已含 qqbot-channel-tools 插件行 */
  function presetHasChannelTools(base) {
    try {
      const txt = readFileSync(join(base, 'agent.cordis.yml'), 'utf8');
      // 匹配连续的 "- id: qqbot-channel-tools" 与 "name: .../channel-tools" 两行(m: $=每行行尾)
      return /id:\s*qqbot-channel-tools\s*\n[ \t]*name:\s*['"]?[^'\n]*\/channel-tools['"]?\s*$/m.test(txt);
    } catch { return false; }
  }
  /** 若 preset 缺 channel-tools 插件行, 在 agent.cordis.yml 末尾自动补上(幂等) */
  function ensureChannelToolsRow(base) {
    const p = join(base, 'agent.cordis.yml');
    let txt = '';
    try { txt = readFileSync(p, 'utf8'); } catch { return false; }
    if (presetHasChannelTools(base)) return true;
    const sep = txt.endsWith('\n') ? '' : '\n';
    txt += `${sep}- id: ${CHANNEL_TOOLS_ROW_ID}\n  name: '${CHANNEL_TOOLS_ROW_NAME}'\n`;
    writeFileSync(p, txt, 'utf8');
    return true;
  }
  function scanPresets() {
    if (!existsSync(PRESET_ROOT)) return [];
    const out = [];
    for (const dir of readdirSync(PRESET_ROOT, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const id = dir.name;
      const base = join(PRESET_ROOT, id);
      if (!existsSync(join(base, 'agent.cordis.yml'))) continue;
      let name = '';
      try {
        const pm = join(base, 'preset.yml');
        if (existsSync(pm)) {
          const m = /^name:\s*(.*)$/m.exec(readFileSync(pm, 'utf8'));
          if (m) name = m[1].trim().replace(/^["']|["']$/g, '');
        }
      } catch { /* ignore */ }
      let mtime = 0;
      try { mtime = statSync(join(base, 'agent.cordis.yml')).mtimeMs; } catch { /* ignore */ }
      out.push({ id, name: name || id, mtime, hasChannelTools: presetHasChannelTools(base) });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }
  route(ctx, 'GET', '/api/qqbot-settings/presets', async (_req, res) => {
    writeJson(res, 200, { root: PRESET_ROOT, presets: scanPresets() });
  });
  // 复制并双名: {sourceId, newId, newName}
  route(ctx, 'POST', '/api/qqbot-settings/presets/copy', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body.sourceId !== 'string' || typeof body.newId !== 'string') {
      return writeJson(res, 400, { error: 'sourceId/newId 必填' });
    }
    const newId = body.newId.trim();
    if (!ID_RE.test(newId)) return writeJson(res, 400, { error: '预设 id 只能字母/数字开头，含 - _（也是文件夹名）' });
    const src = join(PRESET_ROOT, String(body.sourceId).trim());
    const dst = join(PRESET_ROOT, newId);
    if (!existsSync(join(src, 'agent.cordis.yml'))) return writeJson(res, 404, { error: '源预设不存在' });
    if (existsSync(dst)) return writeJson(res, 409, { error: `预设 ${newId} 已存在` });
    try {
      cpSync(src, dst, { recursive: true, filter: (s) => !COPY_SKIP.test(s) });
      // 复制出的新预设自动补上 QQ 通道工具插件行(缺则加; 幂等)——保证新人格在 QQ 里能发图/查表情包
      ensureChannelToolsRow(dst);
      // 人设名写入新 preset.yml(name 为 YAML 双引号标量; JSON 转义兼容)
      const pm = join(dst, 'preset.yml');
      if (existsSync(pm)) {
        const txt = readFileSync(pm, 'utf8');
        const nameYaml = JSON.stringify(String(body.newName ?? newId));
        const next = txt.replace(/^name:.*$/m, `name: ${nameYaml}`);
        writeFileSync(pm, next, 'utf8');
      }
      writeJson(res, 200, { ok: true, newId });
    } catch (e) { writeJson(res, 500, { error: String(e?.message ?? e) }); }
  });
  // 从内置"标准模式(standard)"新建一个预设(空机器起步用): 复制宿主 standard + 自动补 QQ 通道工具行
  // 复用宿主原生 agentPresets.copy(from,id,name) —— 复制出的正是宿主当前标准版, 保证能跑; 无需自己拼组合。
  route(ctx, 'POST', '/api/qqbot-settings/presets/new', async (req, res) => {
    const body = await readJsonBody(req);
    const newId = String(body?.id ?? '').trim();
    const newName = String(body?.name ?? '').trim() || undefined;
    if (!ID_RE.test(newId)) return writeJson(res, 400, { error: '预设 id 只能字母/数字开头，含 - _（也是文件夹名）' });
    try {
      const ap = (ctx).agentPresets;
      if (!ap || typeof ap.copy !== 'function') {
        return writeJson(res, 500, { error: '宿主未提供 agentPresets 服务, 无法从标准模式新建' });
      }
      await ap.copy('standard', newId, newName);
      const dstDir = join(PRESET_ROOT, newId);
      ensureChannelToolsRow(dstDir);
      writeJson(res, 200, { ok: true, newId });
    } catch (e) {
      const msg = String(e?.message ?? e);
      // 宿主 RemoteError 里的用户可读文案: 取含中文(预设/已存在)的后段
      const m = /(预设|preset|id|已存在|exist)[^\n]*$/im.exec(msg);
      writeJson(res, 500, { error: m ? m[0] : msg });
    }
  });
  // 打开预设文件夹(本机弹资源管理器; 仅限 presetRoot 内白名单路径)
  route(ctx, 'POST', '/api/qqbot-settings/presets/open', async (req, res) => {
    const body = await readJsonBody(req);
    const id = String(body?.id ?? '').trim();
    if (!ID_RE.test(id)) return writeJson(res, 400, { error: '非法的预设 id' });
    const dir = join(PRESET_ROOT, id);
    if (!dir.startsWith(PRESET_ROOT) || !existsSync(join(dir, 'agent.cordis.yml'))) {
      return writeJson(res, 404, { error: '预设不存在' });
    }
    try {
      const child = spawn('explorer', [dir], { detached: true, stdio: 'ignore' });
      child.unref();
      writeJson(res, 200, { ok: true });
    } catch (e) { writeJson(res, 500, { error: String(e?.message ?? e) }); }
  });


  // ── 预设人格文件浏览/编辑(2026-09-07): "展开改写人格"。安全: 仅 PRESET_ROOT/{id} 内白名单文件;
  //    写权限仅限"复制出来带QQ工具标记"的副本(防误改内置/半成品); 大小上限 200KB。
  const PRESET_EDIT_EXT = /.(yml|yaml|json|mjs|js|md|txt)$/i;
  const PRESET_EDIT_MAX = 200 * 1024;
  function presetDirSafe(id) {
    if (!ID_RE.test(String(id || ''))) return null;
    const dir = resolve(PRESET_ROOT, id);
    if (!dir.startsWith(resolve(PRESET_ROOT) + sep)) return null;
    if (!existsSync(join(dir, 'agent.cordis.yml'))) return null;
    return dir;
  }
  function presetWritable(id) {
    // 安全规则(主人定): 仅"复制出来带 QQ 工具标记"的预设可改写(liangshen 等底层/实验预设保持只读)。
    const p = scanPresets().find((x) => x.id === id);
    return !!(p && p.hasChannelTools);
  }
  route(ctx, 'GET', '/api/qqbot-settings/presets/files', async (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const dir = presetDirSafe(q.get('id') || '');
    if (!dir) return writeJson(res, 404, { error: '预设不存在' });
    try {
      const files = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && PRESET_EDIT_EXT.test(d.name))
        .map((d) => { const st = statSync(join(dir, d.name)); return { name: d.name, size: st.size, mtime: st.mtimeMs }; })
        .sort((a, b) => (b.name === 'agent.cordis.yml' ? 1 : 0) - (a.name === 'agent.cordis.yml' ? 1 : 0) || a.name.localeCompare(b.name));
      writeJson(res, 200, { id: q.get('id'), dir, writable: presetWritable(q.get('id')), files });
    } catch (e) { writeJson(res, 500, { error: String(e?.message ?? e) }); }
  });
  route(ctx, ['GET', 'PUT'], '/api/qqbot-settings/presets/file', async (req, res) => {
    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const id = String(body?.id ?? '');
      const dir = presetDirSafe(id);
      const name = String(body?.name ?? '');
      if (!dir || !PRESET_EDIT_EXT.test(name)) return writeJson(res, 400, { error: '参数不合法' });
      const p = join(dir, name);
      if (!existsSync(p) || !resolve(p).startsWith(resolve(dir) + sep)) return writeJson(res, 404, { error: '文件不存在' });
      if (!presetWritable(id)) return writeJson(res, 403, { error: '安全限制: 仅"带QQ工具标记"的复制预设可改写(liangshen 等底层预设只读)' });
      const content = String(body?.content ?? '');
      if (Buffer.byteLength(content, 'utf8') > PRESET_EDIT_MAX) return writeJson(res, 400, { error: '内容过大(上限 200KB)' });
      try {
        const tmp = p + '.tmp-' + Date.now();
        writeFileSync(tmp, content, 'utf8');
        renameSync(tmp, p);
        writeJson(res, 200, { ok: true, name, size: Buffer.byteLength(content, 'utf8') });
      } catch (e) { writeJson(res, 500, { error: String(e?.message ?? e) }); }
      return;
    }
    const q = new URL(req.url, 'http://x').searchParams;
    const id = q.get('id') || '';
    const dir = presetDirSafe(id);
    const name = String(q.get('name') || '');
    if (!dir || !PRESET_EDIT_EXT.test(name)) return writeJson(res, 400, { error: '参数不合法' });
    const p = join(dir, name);
    if (!existsSync(p) || !resolve(p).startsWith(resolve(dir) + sep)) return writeJson(res, 404, { error: '文件不存在' });
    try { writeJson(res, 200, { id, name, content: readFileSync(p, 'utf8') }); }
    catch (e) { writeJson(res, 500, { error: String(e?.message ?? e) }); }
  });

  // ── QQ 菜单/指令面板管理(2026-09-07): 经 QQBot.api 网关转发官方接口(v2/menu、v2/panels CRUD+target)。
  //    面板=机器人在会话/群里的指令入口; 菜单=长按/下拉快捷菜单。白名单 path, 仅本机 loopback 可调。
  const QQ_API_PATH_RE = new RegExp('^/v2/(menu|panels)(/[A-Za-z0-9_-]+)?(/target)?$');
  route(ctx, 'POST', '/api/qqbot-settings/qq/proxy', async (req, res) => {
    const body = await readJsonBody(req);
    const ns = String(body?.ns ?? '');
    const method = String(body?.method ?? 'GET').toUpperCase();
    const path = String(body?.path ?? '');
    if (!QQ_API_PATH_RE.test(path)) return writeJson(res, 400, { error: '仅支持 /v2/menu 与 /v2/panels 相关接口' });
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return writeJson(res, 400, { error: '不支持的方法' });
    try {
      const gc = await groupClientOf(ns);
      const apiG = gc && gc.client && gc.client.api;
      if (!apiG || typeof apiG.get !== 'function') return writeJson(res, 400, { error: '找不到该账号实例(未配置/未连接)' });
      const fn = apiG[method.toLowerCase()];
      if (typeof fn !== 'function') return writeJson(res, 400, { error: '网关不支持 ' + method });
      const out = (method === 'GET' || method === 'DELETE')
        ? await fn(path, body && body.query)
        : await fn(path, body && body.body);
      writeJson(res, 200, out ?? { ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = e && e.code;
      writeJson(res, 200, { ok: false, err: { code: code || 'QQ_API_ERROR', human: msg } });
    }
  });

  // ── 扫码绑定注册流程(每个账号走 QQ 官方绑定, 拿平台下发的 appId/appSecret) ──(每个账号走 QQ 官方绑定, 拿平台下发的 appId/appSecret) ──
  // 前端拿 qrUrl 打开授权页(手机 QQ 扫码) → host 轮询 → 完成回填。displayQrCodeToConsole=false。
  const bindSessions = new Map(); // id -> {url, creds, error, stop}
  let bindSeq = 0;
  route(ctx, 'POST', '/api/qqbot-settings/bind/start', async (_req, res) => {
    const id = 'bind-' + (++bindSeq) + '-' + Date.now().toString(36);
    try {
      const { startQrConnect } = await import('@tencent-connect/qqbot-connector');
      const sess = { url: '', creds: null, error: null };
      bindSessions.set(id, sess);
      const stop = startQrConnect({
        onSuccess: (creds) => { sess.creds = Array.isArray(creds) ? creds[0] : creds; },
        onFailure: (err) => { sess.error = String(err?.message ?? err); },
        onQrDisplayed: (url) => { sess.url = url; },
        onQrExpired: () => { /* 前端轮询会拿到新 url */ },
      }, { displayQrCodeToConsole: false, source: 'dsh-qqbot' });
      sess.stop = stop;
      // 等第一个二维码 URL(最多 12s)
      const deadline = Date.now() + 12000;
      while (!sess.url && !sess.error && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
      }
      if (!sess.url) {
        stop();
        bindSessions.delete(id);
        return writeJson(res, 500, { error: sess.error || '获取绑定二维码超时' });
      }
      writeJson(res, 200, { id, url: sess.url });
    } catch (e) {
      writeJson(res, 500, { error: String(e?.message ?? e) });
    }
  });
  route(ctx, 'GET', '/api/qqbot-settings/bind/poll', async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const id = u.searchParams.get('id') || '';
    const sess = bindSessions.get(id);
    if (!sess) return writeJson(res, 404, { error: '绑定会话不存在或已结束' });
    if (sess.creds) { bindSessions.delete(id); return writeJson(res, 200, { status: 'done', appId: sess.creds.appId, appSecret: sess.creds.appSecret }); }
    if (sess.error) { bindSessions.delete(id); return writeJson(res, 200, { status: 'error', error: sess.error }); }
    writeJson(res, 200, { status: 'wait', url: sess.url });
  });
  route(ctx, 'POST', '/api/qqbot-settings/bind/cancel', async (req, res) => {
    const body = await readJsonBody(req);
    const sess = bindSessions.get(String(body?.id ?? ''));
    if (sess) { try { sess.stop?.(); } catch { /* ignore */ } bindSessions.delete(String(body?.id ?? '')); }
    writeJson(res, 200, { ok: true });
  });

  // ── 图库管理 ──
  // 列表: /api/qqbot-settings/stickers?layer=&q=&untagged=1&includeTrash=1
  route(ctx, 'GET', '/api/qqbot-settings/stickers', async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const layer = u.searchParams.get('layer') || undefined;
    const q = u.searchParams.get('q') || undefined;
    const untagged = u.searchParams.get('untagged') === '1';
    const includeTrash = u.searchParams.get('includeTrash') === '1';
    const store = dirOf(u, 'dataDir') ? getStickerStore(dirOf(u, 'dataDir')) : getStickerStore();
    const items = store.queryAll({ layer: layer === 'all' ? undefined : layer, q: q || undefined, untagged, includeTrash });
    writeJson(res, 200, { items, total: items.length });
  });

  // 缩略图: /api/qqbot-settings/sticker-img?id=xxx (id 由 store 内部解析路径, 不外接路径)
  route(ctx, 'GET', '/api/qqbot-settings/sticker-img', async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const id = u.searchParams.get('id') || '';
    const store = dirOf(u, 'dataDir') ? getStickerStore(dirOf(u, 'dataDir')) : getStickerStore();
    const meta = store.get(id);
    if (!meta) return writeJson(res, 404, { error: 'not found' });
    const p = store.pathOf(id);
    const buf = readFileSync(p);
    const ext = extname(p).replace('.', '').toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' });
    res.end(buf);
  });

  // 批量: {op:'promote'|'trash'|'restore'|'tag', ids:[], tags?:string[], desc?:string}
  route(ctx, 'POST', '/api/qqbot-settings/stickers/batch', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad body' });
    const store = typeof body.dataDir === 'string' && body.dataDir ? getStickerStore(body.dataDir) : getStickerStore();
    const op = body.op;
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    let okN = 0;
    for (const id of ids) {
      if (op === 'promote') { if (store.promote(id)) okN += 1; }
      else if (op === 'trash') { if (store.markTrash(id)) okN += 1; }
      else if (op === 'restore') { if (store.restore(id)) okN += 1; }
      else if (op === 'tag') { if (store.setDescTags(id, Array.isArray(body.tags) ? body.tags : undefined, typeof body.desc === 'string' ? body.desc : undefined)) okN += 1; }
      else return writeJson(res, 400, { error: `unknown op ${op}` });
    }
    try { store.flush(); } catch { /* ignore */ } // 批量改完立即落盘, 防杀进程丢最后一笔
    writeJson(res, 200, { ok: okN, total: ids.length });
  });

  // 导入: {paths?: string[], urls?: string[], files?: [{name,dataBase64}]} → 逐项导入
  route(ctx, 'POST', '/api/qqbot-settings/stickers/import', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad body' });
    const store = typeof body.dataDir === 'string' && body.dataDir ? getStickerStore(body.dataDir) : getStickerStore();
    const results = [];
    const paths = Array.isArray(body.paths) ? body.paths : [];
    const urls = Array.isArray(body.urls) ? body.urls : [];
    const files = Array.isArray(body.files) ? body.files : [];
    for (const p of paths) {
      try {
        const r = store.importLocalFile(String(p));
        results.push({ ref: String(p), status: r.status, id: r.id, error: r.error });
      } catch (e) { results.push({ ref: String(p), status: 'error', error: String(e?.message ?? e) }); }
    }
    for (const url of urls) {
      try {
        const r = await store.capture(String(url), { sourceUrl: String(url) }, undefined);
        results.push({ ref: String(url), status: r.status, id: r.id, error: r.error });
      } catch (e) { results.push({ ref: String(url), status: 'error', error: String(e?.message ?? e) }); }
    }
    for (const f of files) {
      const name = String(f?.name ?? 'upload');
      const b64 = typeof f?.dataBase64 === 'string' ? f.dataBase64 : '';
      try {
        if (!b64) throw new Error('no data');
        const buf = Buffer.from(b64, 'base64');
        const tmpDir = join(store.dataDir, '.import');
        mkdirSync(tmpDir, { recursive: true });
        const tmp = join(tmpDir, `${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
        writeFileSync(tmp, buf);
        const r = store.importLocalFile(tmp);
        try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
        results.push({ ref: name, status: r.status, id: r.id, error: r.error });
      } catch (e) { results.push({ ref: name, status: 'error', error: String(e?.message ?? e) }); }
    }
    try { store.flush(); } catch { /* ignore */ } // 导入完立即落盘
    writeJson(res, 200, { results });
  });

  // ── ⑥QQ 群管理面板(P3, 2026-09-05): 多群管理 host 路由(读/写走 GroupAdminClient; 面板=主人直发免 QQ 审批) ──
  // 数据: {cwd}/.qqbot/{groups.json 群注册表, join-pending.json 待审, group-audit.jsonl 审计日志}
  // 鉴权: 与全路由一致走 route() 同源 loopback fence; 面板主人级鉴权(P4 加强)。
  function nsBot(ns) {
    const { bots } = parsePatch();
    const id = ns && ns !== 'im-qqbot' ? String(ns) : 'im-qqbot';
    const b = bots.find((x) => x.id === id);
    if (!b) return null;
    const appId = b.cfg?.appId || '';
    const appSecret = b.cfg?.appSecret || '';
    // 数据根: dataRoot(新) > cwd(旧); nsBot 的 cwd 字段按数据根返回(全为数据目录用途)
    const cwd = (b.cfg?.dataRoot || b.cfg?.cwd || '');
    if (!appId || !appSecret) return null;
    return { id, appId, appSecret, cwd, ns: id };
  }
  async function groupClientOf(ns) {
    const bot = nsBot(ns);
    if (!bot) return null;
    const mod = await import('./dist/api/group-admin.js');
    return { bot, client: mod.createGroupAdmin({ appId: bot.appId, appSecret: bot.appSecret }) };
  }
  function audit(cwd, entry) {
    try {
      mkdirSync(join(cwd, '.qqbot'), { recursive: true });
      const af = join(cwd, '.qqbot', 'group-audit.jsonl');
      writeFileSync(af, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', { flag: 'a' });
    } catch { /* ignore */ }
  }
  function readGroupsJson(cwd) {
    try { return JSON.parse(readFileSync(join(cwd, '.qqbot', 'groups.json'), 'utf8') || '{}'); } catch { return {}; }
  }
  function writeGroupsJson(cwd, g) {
    try { mkdirSync(join(cwd, '.qqbot'), { recursive: true }); writeFileSync(join(cwd, '.qqbot', 'groups.json'), JSON.stringify(g, null, 1), 'utf8'); } catch { /* ignore */ }
  }
  function readPendingJson(cwd) {
    try { return JSON.parse(readFileSync(join(cwd, '.qqbot', 'join-pending.json'), 'utf8') || '{}'); } catch { return {}; }
  }
  const NSQ = (u) => (u.searchParams.get('ns') || '').trim() || undefined;
  const GQ = (u) => (u.searchParams.get('gid') || '').trim();

  // ── Web 会话 → QQ 目标反查(悬浮球自动选目标用) ──
  // dsh-qqbot 的 sessionId = sha256(`qqbot:{appId}:{scope}:{peerId}`) 前 32 hex 排成 UUID。
  // 输入 web 当前会话 sessionId, 遍历所有实例的注册表群 + 台账私聊, 命中即返回归属。
  function deriveSessionIdOf(appId, scope, peerId) {
    const hash = createHash('sha256').update(`qqbot:${appId}:${scope}:${peerId}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }
  function chatLedgerNames(dataDir) {
    const out = new Map(); // key=scope:id -> {name, ts}
    try {
      const raw = readFileSync(join(dataDir, 'known-chats.jsonl'), 'utf8');
      for (const l of raw.split('\n')) {
        const t = l.trim(); if (!t) continue;
        try {
          const o = JSON.parse(t);
          if (o && typeof o.id === 'string' && (o.scope === 'group' || o.scope === 'c2c') && o.id) {
            const key = o.scope + ':' + o.id;
            const cur = out.get(key);
            if (!cur || (o.ts || 0) > cur.ts) out.set(key, { name: o.name || '', ts: o.ts || 0 });
          }
        } catch { /* 坏行 */ }
      }
    } catch { /* 无台账 */ }
    return out;
  }
  route(ctx, 'GET', '/api/qqbot-settings/session-lookup', async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://x');
      const sessionId = (u.searchParams.get('sessionId') || '').trim();
      if (!sessionId) return writeJson(res, 400, { error: 'sessionId 必填' });
      const { bots } = parsePatch();
      const hits = [];
      for (const bot of bots) {
        if (bot.disabled || !bot.cfg?.appId || !bot.cfg?.cwd) continue;
        const appId = bot.cfg.appId;
        const cwd = bot.cfg.dataRoot || bot.cfg.cwd;
        const ns = bot.id;
        const ledger = chatLedgerNames(join(cwd, '表情包'));
        // 群: 注册表 + 台账
        const groups = readGroupsJson(cwd);
        const gids = new Set([...Object.keys(groups), ...[...ledger.keys()].filter((k) => k.startsWith('group:')).map((k) => k.slice(6))]);
        for (const gid of gids) {
          if (!gid) continue;
          if (deriveSessionIdOf(appId, 'group', gid) !== sessionId) continue;
          const regMeta = groups[gid];
          const ld = ledger.get('group:' + gid);
          hits.push({ ns, scope: 'group', peerId: gid, name: (regMeta && regMeta.name) || (ld && ld.name) || '' });
        }
        // 私聊: 台账 c2c
        for (const [key, ld] of ledger) {
          if (!key.startsWith('c2c:')) continue;
          const openid = key.slice(4);
          if (!openid || deriveSessionIdOf(appId, 'c2c', openid) !== sessionId) continue;
          hits.push({ ns, scope: 'c2c', peerId: openid, name: ld.name || '' });
        }
      }
      writeJson(res, 200, { ok: true, sessionId, hits });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // 群列表(注册表 + pending 出现过的群 + 台账群; 逐个调官方 info 校验有效性+补群名, 11255=群已注销/不存在则标记失效并过滤)
  route(ctx, 'GET', '/api/qqbot-settings/group/accounts', async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://x');
      const bot = nsBot(NSQ(u));
      if (!bot) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
      const reg = readGroupsJson(bot.cwd);
      const pend = readPendingJson(bot.cwd);
      const map = new Map();
      for (const [gid, meta] of Object.entries(reg)) {
        if (!gid) continue;
        map.set(gid, { gid, name: (meta && meta.name) || '', from: 'registry', lastAt: (meta && meta.lastAt) || 0 });
      }
      for (const gid of Object.keys(pend)) {
        if (!gid) continue;
        if (map.has(gid)) { const m = map.get(gid); m.from = 'registry+pending'; }
        else map.set(gid, { gid, name: '', from: 'pending', lastAt: 0 });
      }
      try {
        const store = getStickerStore(bot.cwd ? join(bot.cwd, '表情包') : undefined);
        const raw = readFileSync(join(store.dataDir, 'known-chats.jsonl'), 'utf8');
        for (const l of raw.split('\n')) {
          const t = l.trim(); if (!t) continue;
          try {
            const o = JSON.parse(t);
            if (o && o.scope === 'group' && typeof o.id === 'string' && o.id) {
              if (map.has(o.id)) { if (!map.get(o.id).name && o.name) map.get(o.id).name = o.name; }
              else map.set(o.id, { gid: o.id, name: o.name || '', from: 'ledger', lastAt: typeof o.ts === 'number' ? o.ts : 0 });
            }
          } catch { /* 坏行跳过 */ }
        }
      } catch { /* 无台账 */ }
      // 逐个校验有效性 + 用官方群名补全显示名(注册表里的群也顺手回写官方名)
      const gc = await groupClientOf(NSQ(u));
      const out = [];
      const aliveReg = {};
      if (gc) {
        for (const g of [...map.values()].sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))) {
          try {
            const info = await gc.client.getGroupInfo(g.gid);
            if (info.ok && info.data) {
              const official = info.data.group_name || '';
              if (official) g.name = official;
              out.push(g);
              aliveReg[g.gid] = { name: official || (reg[g.gid] && reg[g.gid].name) || '', lastAt: (reg[g.gid] && reg[g.gid].lastAt) || Date.now() };
            } else {
              // 11255 等 = 群已注销/不存在 → 不返回给 UI(避免选中后调用报错), 仅保留审计
              audit(bot.cwd, { ev: 'group.dead', ns: bot.id, gid: g.gid, code: info.err && info.err.code, human: info.err && info.err.human });
            }
          } catch (e2) {
            audit(bot.cwd, { ev: 'group.check-error', ns: bot.id, gid: g.gid, error: String((e2 && e2.message) || e2) });
            out.push(g); // 网络类错误不判死, 保守保留
          }
        }
        // 回写有效群注册表(自动剔除已注销群)
        if (Object.keys(aliveReg).length >= 0) writeGroupsJson(bot.cwd, aliveReg);
      } else {
        out.push(...map.values());
      }
      writeJson(res, 200, { groups: out });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // 待审入群申请(官方列表 + 本地 pending 已处理标记)
  route(ctx, 'GET', '/api/qqbot-settings/group/join_requests', async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://x');
      const gid = GQ(u);
      if (!gid) return writeJson(res, 400, { error: 'gid 必填' });
      const gc = await groupClientOf(NSQ(u));
      if (!gc) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
      const r = await gc.client.listJoinRequests(gid);
      if (!r.ok) return writeJson(res, 200, { ok: false, err: r.err });
      const pend = readPendingJson(gc.bot.cwd);
      const local = (pend[gid] || []).map((x) => ({ member_openid: x.member_openid, join_request_id: x.join_request_id, notified: !!x.notified, seen_at: x.seen_at }));
      writeJson(res, 200, { ok: true, list: r.data.list, local });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // 本地成员清单(官方成员列表未开放 → 用机器人见过的发言者兜底; 供禁言"选人"与成员 Tab 展示)
  route(ctx, 'GET', '/api/qqbot-settings/group/members_local', async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://x');
      const gid = GQ(u);
      const bot = nsBot(NSQ(u));
      if (!bot) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
      const store = getStickerStore(bot.cwd ? join(bot.cwd, '表情包') : undefined);
      // 与台账同 dataDir 的 group-members.jsonl
      const mod = await import('./dist/features/chat-ledger.js');
      const members = mod.readGroupMembers(store.dataDir, gid || undefined);
      writeJson(res, 200, { ok: true, members });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // 手动审批入群 {ns?, gid, member_openid, op:approve|decline, reason?}
  route(ctx, 'POST', '/api/qqbot-settings/group/approve', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad body' });
    const gid = String(body.gid || '');
    const mid = String(body.member_openid || '');
    const op = String(body.op || '');
    if (!gid || !mid || (op !== 'approve' && op !== 'decline')) return writeJson(res, 400, { error: 'gid/member_openid/op(approve|decline) 必填' });
    try {
      const gc = await groupClientOf(String(body.ns || ''));
      if (!gc) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
      const listR = await gc.client.listJoinRequests(gid);
      const found = listR.ok ? (listR.data.list || []).find((x) => x.member_openid === mid) : undefined;
      const r = await gc.client.approveJoinRequest(gid, mid, op, {
        ...(found ? { join_request_id: found.join_request_id } : {}),
        ...(op === 'decline' && String(body.reason || '') ? { reject_reason: String(body.reason) } : {}),
      });
      audit(gc.bot.cwd, { ev: 'group.approve', ns: gc.bot.id, gid, member_openid: mid, op, reason: String(body.reason || ''), ok: r.ok, code: r.ok ? undefined : (r.err && r.err.code) });
      writeJson(res, r.ok ? 200 : 200, r.ok ? { ok: true, msg: op === 'approve' ? '已放行' : '已拒绝' } : { ok: false, err: r.err });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // 禁言状态 {ns?, gid}
  route(ctx, 'GET', '/api/qqbot-settings/group/mute_state', async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://x');
      const gid = GQ(u);
      if (!gid) return writeJson(res, 400, { error: 'gid 必填' });
      const gc = await groupClientOf(NSQ(u));
      if (!gc) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
      const r = await gc.client.getMuteState(gid);
      writeJson(res, 200, r.ok ? { ok: true, data: r.data } : { ok: false, err: r.err });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // 手动禁言/解禁 {ns?, gid, member_openid, action:mute|unmute, seconds?}
  route(ctx, 'POST', '/api/qqbot-settings/group/mute', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad body' });
    const gid = String(body.gid || '');
    const mid = String(body.member_openid || '');
    const action = String(body.action || '');
    if (!gid || !mid || (action !== 'mute' && action !== 'unmute')) return writeJson(res, 400, { error: 'gid/member_openid/action(mute|unmute) 必填' });
    try {
      const gc = await groupClientOf(String(body.ns || ''));
      if (!gc) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
      const secs = action === 'mute' ? Math.max(1, Math.min(30 * 86400, Math.round(Number(body.seconds || 600)))) : 0;
      const p2 = (n) => String(n).padStart(2, '0');
      const expire = action === 'mute' ? new Date(Date.now() + secs * 1000) : null;
      const rfc = expire ? expire.getFullYear() + '-' + p2(expire.getMonth() + 1) + '-' + p2(expire.getDate()) + 'T' + p2(expire.getHours()) + ':' + p2(expire.getMinutes()) + ':' + p2(expire.getSeconds()) + '+08:00' : null;
      const r = await gc.client.setMemberMute(gid, mid, rfc);
      audit(gc.bot.cwd, { ev: 'group.mute', ns: gc.bot.id, gid, member_openid: mid, action, seconds: secs, ok: r.ok, code: r.ok ? undefined : (r.err && r.err.code) });
      // ⚠️ 官方对"禁言已退群成员"静默返回成功但不生效(实测 HTTP 200 空体, 状态列表无此人)
      // → 禁言后回读 restrict_chat_setting 验证: 目标不在成员列表 = 已不在群/无法禁言 → 人话提示 + 自动剔除本地名单
      if (r.ok && action === 'mute') {
        try {
          const st = await gc.client.getMuteState(gid);
          const stMembers = (st.ok && st.data && Array.isArray(st.data.members) ? st.data.members : []) || [];
          const present = stMembers.some((m) => m.member_openid === mid);
          if (!present) {
            const store = getStickerStore(gc.bot.cwd ? join(gc.bot.cwd, '表情包') : undefined);
            const ledgerMod = await import('./dist/features/chat-ledger.js');
            ledgerMod.removeGroupMember(store.dataDir, gid, mid);
            audit(gc.bot.cwd, { ev: 'group.member-auto-remove', ns: gc.bot.id, gid, member_openid: mid, reason: '禁言无效(成员已不在群)' });
            return writeJson(res, 200, { ok: false, err: { code: 'MEMBER_NOT_IN_GROUP', human: '该成员已不在群(可能已退群)——已自动从本地成员清单剔除' } });
          }
        } catch (e2) { /* 回读失败不阻断, 按成功返回 */ }
      }
      writeJson(res, r.ok ? 200 : 200, r.ok ? { ok: true, msg: action === 'mute' ? '已禁言 ' + Math.round(secs / 60) + ' 分钟' : '已解除禁言' } : { ok: false, err: r.err });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // 面板代发消息: 以机器人身份向群发文本 {ns?, gid, text, insertContext?}
  // insertContext=true → 发完后往该 QQ 会话 append 一条 user/message(模拟用户消息, 内容以
  // 「用户代你发送: 」开头, web 流可见、不唤醒、不开回合——与入群申请通知同款姿势)。
  // 该文本只进 web 流, QQ 群里收到的是干净原文。
  route(ctx, 'POST', '/api/qqbot-settings/group/send', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad body' });
    const gid = String(body.gid || '').trim();
    const text = String(body.text || '').trim();
    if (!gid || !text) return writeJson(res, 400, { error: 'gid 与 text 必填' });
    if (text.length > 2000) return writeJson(res, 400, { error: '文本过长(最多 2000 字符)' });
    try {
      const gc = await groupClientOf(String(body.ns || ''));
      if (!gc) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
      const r = await gc.client.sendGroupText(gid, text);
      audit(gc.bot.cwd, { ev: 'group.send', ns: gc.bot.id, gid, text: text.slice(0, 120), ok: r.ok, code: r.ok ? undefined : (r.err && r.err.code) });
      let ctxNote = '';
      if (r.ok && body.insertContext === true) {
        const why = await appendUserRelayToPeer(String(body.ns || 'im-qqbot'), 'group', gid, text).catch((e) => { audit(gc.bot.cwd, { ev: 'group.send.insertContext-failed', ns: gc.bot.id, error: String((e && e.message) || e) }); return 'failed'; });
        if (why) audit(gc.bot.cwd, { ev: 'group.send.insertContext-skipped', ns: gc.bot.id, gid, reason: why });
        ctxNote = why ? '(' + (WHY_MAP[why] || why) + ')' : '(已写入上下文: 用户代你发送)';
      }
      writeJson(res, r.ok ? 200 : 200, r.ok ? { ok: true, msg: '已发送 ✓ ' + ctxNote } : { ok: false, err: r.err });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // 面板代发私聊: 以机器人身份向用户发文本 {ns?, openid, text, insertContext?}(悬浮球 dock 发消息用)
  route(ctx, 'POST', '/api/qqbot-settings/chat/send', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad body' });
    const openid = String(body.openid || '').trim();
    const text = String(body.text || '').trim();
    if (!openid || !text) return writeJson(res, 400, { error: 'openid 与 text 必填' });
    if (text.length > 2000) return writeJson(res, 400, { error: '文本过长(最多 2000 字符)' });
    try {
      const gc = await groupClientOf(String(body.ns || ''));
      if (!gc) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
      const r = await gc.client.sendC2cText(openid, text);
      audit(gc.bot.cwd, { ev: 'chat.send', ns: gc.bot.id, openid, text: text.slice(0, 120), ok: r.ok, code: r.ok ? undefined : (r.err && r.err.code) });
      let ctxNote = '';
      if (r.ok && body.insertContext === true) {
        const why = await appendUserRelayToPeer(String(body.ns || 'im-qqbot'), 'c2c', openid, text).catch((e) => { audit(gc.bot.cwd, { ev: 'chat.send.insertContext-failed', ns: gc.bot.id, error: String((e && e.message) || e) }); return 'failed'; });
        if (why) audit(gc.bot.cwd, { ev: 'chat.send.insertContext-skipped', ns: gc.bot.id, openid, reason: why });
        ctxNote = why ? '(' + (WHY_MAP[why] || why) + ')' : '(已写入上下文: 用户代你发送)';
      }
      writeJson(res, r.ok ? 200 : 200, r.ok ? { ok: true, msg: '已发送 ✓ ' + ctxNote } : { ok: false, err: r.err });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // ── 悬浮球「💬 聊天视图」(2026-09-07): 读某 QQ 会话最近的入站/出站消息, 只读不建会话 ──
  // 会话事件结构(宿主 dsh-session): {type, seq, time, data}; user/message 的 data=消息体根(data.content),
  // assistant/message 的 data={turn,step,message:{role,content,…}}。只收这两型:
  //   · user/message   — 群友/对方发言(左气泡)。滤 source.kind='plugin'(runtime context/系统注入)与
  //                      伪造系统通知(入群申请/定时, 内容无 [当前时间 头); 剥「[当前时间 …]」头、
  //                      QQ 入站「[昵称 (openid)]」外壳、<@openid> 提及(换成群成员昵称)、尾部 (@you)、
  //                      长附件 URL(折叠成 [图片] 等)。面板代发(「用户代你发送: 」)标 tag=面板代发。
  //   · assistant/message — 机器人回复(右气泡)。只取 content 里 type=text 块; 纯思考/纯工具步(无正文)跳过。
  // chunk/tool-call/tool-result/step/turn/request 等一律不取 → 天然滤掉流式与工具噪声。
  // 分页: 事件 seq 全序(含 chunk 等), 倒扫快进后只保留聊天两型, 每页默认 50 条升序返回 + hasMore。
  function chatTextOf(blocks) {
    if (!Array.isArray(blocks)) return '';
    const parts = [];
    for (const b of blocks) if (b && b.type === 'text' && typeof b.text === 'string' && b.text) parts.push(b.text);
    return parts.join('\n').trim();
  }
  function chatPeelTimeHead(text) {
    // QQ 入站文本头形如 "[当前时间 2026-09-05 周六 19:08]\n\n"(可能 \r\n), 整体剥掉
    return String(text || '').replace(/^\s*\[当前时间[^\]]*\]\s*\r?\n?/, '');
  }
  function chatDisplayClean(text, nameByMid) {
    let s = String(text || '');
    // <@openid> 提及 → @昵称(群成员表有则换名, 否则 @短id)
    s = s.replace(/<@([A-Za-z0-9_-]{6,})>/g, (all, id) => {
      const nm = (nameByMid && nameByMid.get && nameByMid.get(id)) || '';
      return nm ? ('@' + nm) : ('@' + id.slice(0, 6));
    });
    // 行尾 (@you) 等点名标记剥掉(那是给 LLM 的, QQ 界面不显示)
    s = s.replace(/\s*\(@you\)\s*$/, '');
    return s.trim();
  }
  const QQ_MEDIA_RE = /(?:multimedia\.nt\.qq\.com\.cn|multimedia\.qq\.com|qpic\.cn|qlogo\.cn)/i;
  const QQ_URL_RE = /https?:\/\/[^\s\]\)）]+/g;
  // 从聊天文本抽离 QQ 媒体 URL(图/附件直显用), 附件描述行整行吞掉; 返回 {text, images}
  // 面板代发媒体标记 "[MEDIA:类型|来源]": 网络图直接当图; 本机路径图/音频/视频转成 raw-media 直出 URL
  function chatMediaSrcToImg(kind, src) {
    const k = String(kind || '')
      .replace(/图片|img/gi, 'image').replace(/视频|video/gi, 'video')
      .replace(/语音|音频|voice/gi, 'voice').replace(/文件|file/gi, 'file');
    const s = String(src || '').trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return { url: s, kind: k };
    if (k === 'image' || k === 'voice' || k === 'video') {
      return { url: '/api/qqbot-settings/chat/raw-media?p=' + encodeURIComponent(s), kind: k };
    }
    return null; // 本地文件类型不确定时不渲染, 保留文字
  }
  // 按扩展名判本机文件类型(整行本地路径的文本消息也能看图/播音频)
  function chatLocalExtKind(path) {
    const ext = String(path || '').split('?')[0].split('.').pop().toLowerCase();
    if (/^(jpe?g|png|gif|webp|bmp)$/.test(ext)) return 'image';
    if (/^(mp3|wav|ogg|opus|m4a|aac|amr|silk)$/.test(ext)) return 'voice';
    if (/^(mp4|webm|mov|m4v)$/.test(ext)) return 'video';
    return null;
  }
  // 来源短名(标注用): 路径/URL 尾段去 query
  function chatSrcShortName(src) {
    let s = String(src || '').trim();
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    if (i >= 0) s = s.slice(i + 1);
    return s.replace(/[?#].*$/, '') || src || '';
  }
  function chatLocalRawUrl(p) {
    return '/api/qqbot-settings/chat/raw-media?p=' + encodeURIComponent(p);
  }
  // 附件行/URL 归属类型: 文件名/URL fname 扩展名优先(voice/image/file), 无扩展名看行标签与上下文
  // 语音上下文(- ASR:/[Voice message])→ voice; 默认 image(QQ 图消息常走 [附件: url] 无扩展名)
  function chatAttachmentKind(line, hasVoiceCtx, defaultKind) {
    const l = String(line || '');
    // 从行内或 URL fname 参数取文件名
    let name = '';
    const fm = l.match(/fname=([^&\s]+)/);
    if (fm) { try { name = decodeURIComponent(fm[1]); } catch { name = fm[1]; } }
    const am = l.match(/\[Attachment:\s*([^\s\]]+)/i);
    if (am) name = am[1];
    const extM = name.match(/\.([a-z0-9]{2,5})$/i);
    const ext = extM ? extM[1].toLowerCase() : '';
    if (/^(ogg|amr|silk|mp3|wav|opus|m4a|aac)$/.test(ext) || /\[语音|\[音频|\[Voice message\]/i.test(l)) return 'voice';
    if (/^(jpe?g|png|gif|webp|bmp)$/.test(ext)) return 'image';
    if (/^(mp4|webm|mov|m4v)$/.test(ext)) return 'video';
    if (/^(zip|rar|7z|tar|gz|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|apk|exe|iso|json|md|html?|js|py|ts|xml)$/.test(ext)) return 'file';
    if (/\[文件:|\[File:|\[附件:|- File:|\bFile:/i.test(l)) return 'file';
    if (hasVoiceCtx) return 'voice';
    return defaultKind || 'image';
  }
  // 文件显示名: URL fname 参数解码优先, 否则路径尾名
  function chatFileDisplayName(u) {
    try { const q = new URL(u).searchParams.get('fname'); if (q) return decodeURIComponent(q); } catch { /* 继续 */ }
    return chatSrcShortName(u) || '文件';
  }
  function chatSplitMedia(text) {
    const images = [];
    const lines = String(text || '').split('\n');
    const out = [];
    // 语音消息上下文: 该条消息含 ASR/Voice message/语音标记 → 附件 URL 按音频渲染(可播放)
    const hasVoiceCtx = /- ASR:|\[Voice message\]|\[语音|\[音频|voice/i.test(String(text || ''));
    for (const line of lines) {
      const raw = line.trim();
      if (!raw) { out.push(''); continue; }
      // QQ 语音转文字: "- ASR: 内容" → 当消息正文保留
      if (/^- ASR:/i.test(raw)) { out.push(raw.replace(/^- ASR:\s*/i, '').trim()); continue; }
      // "[Voice message] 内容" → 剥壳当正文(与 ASR 重复时可留, dock 不丢文字)
      if (/^\[Voice message\]/i.test(raw)) { const vt = raw.replace(/^\[Voice message\]\s*/i, '').trim(); if (vt) out.push(vt); continue; }
      // 面板代发媒体标记(用户代发上下文格式): [MEDIA:图片|D:\…] / [MEDIA:图片|http…]
      const md = raw.match(/^\[MEDIA:([^\]|]+)\|([^\]]+)\]$/i);
      if (md) {
        const got = chatMediaSrcToImg(md[1], md[2]);
        const sn = chatSrcShortName(md[2]);
        if (got) {
          images.push({ url: got.url, kind: got.kind === 'image' ? 'image' : got.kind });
          const icon = got.kind === 'voice' ? '🎵' : got.kind === 'video' ? '🎬' : '📷';
          out.push(icon + ' ' + sn);
        } else {
          out.push('📎 ' + sn);
        }
        continue;
      }
      // 整行就是一个本机绝对路径(主人贴 D:\…\a.jpg / a.mp3 文本) → 按扩展名转可看/可播
      const lp = raw.match(/^([A-Za-z]:[\\/].+)$/);
      if (lp) {
        const lk = chatLocalExtKind(lp[1]);
        if (lk) { images.push({ url: chatLocalRawUrl(lp[1]), kind: lk }); continue; }
      }
      // 附件描述行: "- Attachment URLs: …" / "- File: …" / "[附件: …]" / "[文件: …]" / "[图片: …]" / "[Attachment: name -> …]"
      if (/^-\s*Attachment URLs:/i.test(raw) || /^-\s*File:/i.test(raw) || /^\[(图片|附件|文件|语音|视频|音频):/i.test(raw) || /^\[Attachment:|^\[File:/i.test(raw)) {
        const urls = raw.match(QQ_URL_RE) || [];
        let got = 0;
        for (const u of urls) {
          const k = chatAttachmentKind(raw, hasVoiceCtx, undefined);
          // 图片/音频须是 QQ 媒体域; 文件(ftn.qq.com 等任意域)直接收
          if (k === 'file') { images.push({ url: u, kind: 'file', name: chatFileDisplayName(u) }); got++; }
          else if (QQ_MEDIA_RE.test(u)) { images.push({ url: u, kind: k }); got++; }
        }
        if (!got) {
          // 无 URL 的 File/附件描述行(如 "- File: a.zip (3.0MB)")→ 保留可读文本, 不给空占位
          const desc = raw
            .replace(/^-\s*File:\s*/i, '').replace(/^\[File:\s*/i, '')
            .replace(/^\[(图片|附件|文件|语音|视频|音频):\s*/i, '').trim().replace(/\]$/, '').trim();
          if (desc && !/^https?:/i.test(desc) && !/^Attachment\s*:/i.test(desc)) out.push('📎 ' + desc);
        }
        continue;
      }
      // 整行就是一个 QQ 媒体 URL(纯图片/音频消息体) → 当媒体
      const urls = raw.match(QQ_URL_RE) || [];
      if (urls.length === 1 && QQ_MEDIA_RE.test(raw) && raw === urls[0]) {
        images.push({ url: urls[0], kind: chatAttachmentKind(raw, hasVoiceCtx, 'image') });
        continue;
      }
      // 普通行: 行内嵌的 QQ 媒体长 URL 抽走(防撑爆气泡), 其余保留
      if (urls.length) {
        let rest = raw;
        for (const u of urls) {
          if (QQ_MEDIA_RE.test(u)) { images.push({ url: u, kind: chatAttachmentKind(raw, hasVoiceCtx, 'image') }); rest = rest.split(u).join(''); }
        }
        rest = rest.trim();
        if (rest) out.push(rest);
        continue;
      }
      out.push(raw);
    }
    // 去重保序
    // 去重: 同一 URL 在多行出现(描述行/标签行/Attachment 行)时保留最精确的类型
    // 权重: voice/video(扩展名实锤)=3 > image(图片扩展名)/file(标签/扩展名)=2 > 默认 image=1
    const kindW = (x) => {
      const k = typeof x === 'string' ? 'image' : ((x && x.kind) || 'image');
      if (k === 'voice' || k === 'video') return 3;
      if (k === 'file') return 2;
      return 2; // image(含默认)
    };
    const byUrl = new Map();
    for (const x of images) {
      const key = typeof x === 'string' ? x : (x && x.url);
      if (!key) continue;
      const prev = byUrl.get(key);
      if (!prev || kindW(x) >= kindW(prev)) byUrl.set(key, x);
    }
    const uniq = [...byUrl.values()];
    // 正文行去重(ASR 与 [Voice message] 常同文, 不重复显示)
    const rawLines = out.join('\n').split('\n');
    const textOut = rawLines.filter((l, i) => rawLines.indexOf(l) === i).join('\n').trim();
    return { text: textOut, images: uniq };
  }
  // 群延迟/冷却历史打包的分行器: [Chat history begins]…[Chat history ends] + [Current message]
  // 每行 "[昵称 (openid)] 内容" 开新气泡, 后续行并入该气泡; 系统提示段起截断(后面是给 LLM 的注入)
  function chatSplitHistoryBlock(body) {
    const out = [];
    let cur = null;
    const flush = () => {
      if (cur) {
        const t = cur.lines.join('\n').trim();
        out.push({ sender: cur.sender, text: t });
      }
      cur = null;
    };
    for (const line of String(body || '').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      if (/^\[Chat history begins\]$/.test(s) || /^\[Chat history ends\]$/.test(s) || /^\[Current message\]$/.test(s) || /^\[当前时间/.test(s)) continue;
      if (/^\[系统提示\]/.test(s)) { flush(); return out; } // 系统注入段, 之后都不属于群聊内容
      const m = s.match(/^\[([^\]\n]*?)\s*\([A-Za-z0-9_-]{6,}\)\](.*)$/);
      if (m) { flush(); cur = { sender: m[1].trim(), lines: [m[2].trim()].filter(Boolean) }; }
      else { if (cur) cur.lines.push(s); else { flush(); cur = { sender: '', lines: [s] }; } }
    }
    flush();
    return out;
  }
  // 单条/子条通用清洗: 去 [Current message] 标记、引用块折叠、提取昵称标签、剥 [系统提示]、
  // 去提及/@you、抽离 QQ 媒体 URL。返回 { sender, mm:{text,images} }
  function chatPolishOne(body, fallbackSender, nameByMid) {
    let sender = fallbackSender;
    let b = String(body || '');
    b = b.replace(/\[Current message\]\s*/g, '');
    b = b.replace(/\[Quoted message begins\]\s*[\s\S]*?\[Quoted message ends\]\s*/g, '[引用]');
    const tagM = b.match(/\[([^\]\n]*?)\s*\([A-Za-z0-9_-]{6,}\)\]/);
    if (tagM) { if (tagM[1].trim()) sender = tagM[1].trim(); b = b.replace(tagM[0], ''); }
    const sysIdx = b.indexOf('[系统提示]');
    if (sysIdx >= 0) b = b.slice(0, sysIdx).replace(/\s*$/, '');
    const mm = chatSplitMedia(chatDisplayClean(b, nameByMid));
    return { sender, mm };
  }
  // 解码一条会话事件为聊天条目(群打包会展开成多条); 非聊天事件/噪声返回 null
  function chatDecodeEvent(ev, scope, nameByMid, fallbackSender) {
    if (!ev || typeof ev.type !== 'string') return null;
    const data = ev.data && typeof ev.data === 'object' ? ev.data : {};
    const time = typeof ev.time === 'number' ? ev.time : 0;
    if (ev.type === 'user/message') {
      const src = data.source && typeof data.source === 'object' ? data.source : {};
      if (src.kind === 'plugin') return null; // runtime context / 系统注入等, 非真人对话
      const raw0 = chatTextOf(data.content);
      if (!raw0) return null;
      const raw = chatPeelTimeHead(raw0);
      const isRelay = /^用户代你发送: /.test(raw);
      // 后台任务/面板大文件完成通知([系统] 后台任务…)→ 显示为 bot 侧气泡并打来源标; 其余系统注入滤掉
      const isBg = /^\[系统\]\s*后台任务/.test(raw0);
      // 伪造/系统注入(无 [当前时间 头且非 web 直聊): 入群申请/定时 → 滤(QQ 里并没有这句话)
      if (!/^\[当前时间 /.test(raw0) && !src.rpcId) {
        if (/^\[(入群申请|定时|到点)/.test(raw0)) return null;
        if (/^\[系统\]/.test(raw0) && !isBg) return null;
      }
      const isWeb = !!src.rpcId; // web 直聊(同一会话, 主人手打)
      let sender = fallbackSender;
      let body = raw;
      if (isRelay) body = body.replace(/^用户代你发送:\s*/, '');
      if (isBg) body = body.replace(/^\[系统\]\s*/, '');
      // 群延迟/冷却历史打包: [Chat history begins]…[Chat history ends] + [Current message]
      // 历史段里每条都是真实发生过的群消息 → 逐条拆成独立气泡(不裁不丢), 返回多条
      if (body.indexOf('[Chat history begins]') >= 0) {
        const parts = chatSplitHistoryBlock(body);
        const out = [];
        for (const p of parts) {
          const polished = chatPolishOne(p.text, p.sender || fallbackSender, nameByMid);
          if (!polished.mm.text && polished.mm.images.length === 0) continue;
          out.push({ seq: ev.seq, time, dir: 'in', sender: polished.sender || '', text: polished.mm.text, images: polished.mm.images, tag: '' });
        }
        return out.length ? out : null;
      }
      // 普通单条(去标记/剥昵称壳/剥系统提示/抽媒体)
      const polished = chatPolishOne(body, sender, nameByMid);
      sender = polished.sender;
      const mm = polished.mm;
      if (!mm.text && mm.images.length === 0) return null;
      // 面板代发/后台任务完成 = bot 侧事实 → 右气泡 + 来源标(面板代发 / 后台任务)
      return {
        seq: ev.seq, time,
        dir: (isRelay || isBg) ? 'out' : 'in',
        sender: isBg ? '' : (sender || ''),
        text: mm.text,
        images: mm.images,
        tag: isBg ? '后台任务' : (isRelay ? '面板代发' : (isWeb ? 'Web' : '')),
      };
    }
    if (ev.type === 'assistant/message') {
      const msg = data.message && typeof data.message === 'object' ? data.message : null;
      if (!msg) return null;
      const text0 = chatTextOf(msg.content);
      if (!text0) return null; // 纯思考/纯工具步(没对群友说话)跳过
      const text = chatDisplayClean(text0, nameByMid);
      const mm = chatSplitMedia(text);
      if (!mm.text && mm.images.length === 0) return null;
      return { seq: ev.seq, time, dir: 'out', sender: '', text: mm.text, images: mm.images, tag: '' };
    }
    return null;
  }
  // GET /chat/history?ns&scope&peerId&beforeSeq&limit —— 聊天视图数据源
  route(ctx, 'GET', '/api/qqbot-settings/chat/history', async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://x');
      const ns = String(u.searchParams.get('ns') || '').trim() || undefined;
      const scope = String(u.searchParams.get('scope') || '').trim();
      const peerId = String(u.searchParams.get('peerId') || '').trim();
      if (scope !== 'group' && scope !== 'c2c') return writeJson(res, 400, { error: 'scope 必须为 group|c2c' });
      if (!peerId) return writeJson(res, 400, { error: 'peerId 必填' });
      const limit = Math.max(1, Math.min(200, Math.round(Number(u.searchParams.get('limit'))) || 50));
      const bRaw = Number(u.searchParams.get('beforeSeq'));
      const beforeSeq = Number.isFinite(bRaw) && bRaw > 0 ? Math.floor(bRaw) : undefined;
      const bot = nsBot(ns);
      if (!bot) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
      const reg = await import('./dist/features/session-registry.js');
      const rec = typeof reg.findRecordByPeerWeb === 'function'
        ? reg.findRecordByPeerWeb(String(ns || 'im-qqbot'), scope, peerId) : undefined;
      if (!rec || !rec.agent) {
        return writeJson(res, 200, { ok: true, code: 'no-session', items: [], hasMore: false, msg: '该目标暂无活跃会话' });
      }
      const agent = rec.agent;
      const sess = agent && (agent.session || (agent.ctx && agent.ctx.session));
      if (!sess || typeof sess.seq !== 'number') {
        return writeJson(res, 200, { ok: true, code: 'no-session', items: [], hasMore: false, msg: '会话未就绪' });
      }
      const snap = typeof sess.snapshotEvents === 'function' ? sess.snapshotEvents.bind(sess) : undefined;
      // 名字映射: c2c 用台账兜底 sender; group 读群成员表把 <@openid> 换成昵称
      const dataDir = join(bot.cwd, '表情包');
      const ledger = chatLedgerNames(dataDir);
      const nameByMid = new Map();
      if (scope === 'group') {
        try {
          const lm = await import('./dist/features/chat-ledger.js');
          const mems = (lm.readGroupMembers && lm.readGroupMembers(dataDir, peerId)) || [];
          for (const m of mems) if (m && m.mid && m.name) nameByMid.set(m.mid, m.name);
        } catch { /* 无成员表不阻断 */ }
      }
      const fallbackSender = scope === 'c2c' ? ((ledger.get('c2c:' + peerId) || {}).name || '') : '';
      // 尾部倒扫: 默认从最新一条事件 seq 往前; beforeSeq=加载更早(beforeSeq 之前的)
      const items = [];
      let high = beforeSeq !== undefined ? Math.max(0, beforeSeq - 1) : Math.max(0, sess.seq - 1);
      let reachedEnd = false;
      const STEP = 500;
      while (high >= 0 && items.length < limit) {
        const low = Math.max(0, high - STEP + 1);
        let evs = [];
        if (snap) { try { evs = snap(low, high + 1) || []; } catch { evs = []; } }
        if (!evs.length) { const all = sess.events; if (Array.isArray(all) && all.length && all.length > low) evs = all.slice(low, high + 1); }
        for (let i = evs.length - 1; i >= 0; i--) {
          const got = chatDecodeEvent(evs[i], scope, nameByMid, fallbackSender);
          if (got) {
            if (Array.isArray(got)) { for (const g of got) items.push(g); } // 群打包历史 → 多条
            else items.push(got);
          }
          if (items.length >= limit) { reachedEnd = !(i > 0 || low > 0); break; }
        }
        if (items.length >= limit) break;
        if (low === 0) { reachedEnd = true; break; }
        high = low - 1;
      }
      items.reverse(); // 升序(旧→新)
      // QQ 媒体域的语音 URL → 经 /chat/voice-play 转 mp3 播放(浏览器解不了 SILK)
      for (const it of items) {
        if (!Array.isArray(it.images)) continue;
        for (const m of it.images) {
          if (m && typeof m === 'object' && m.kind === 'voice' && typeof m.url === 'string'
            && /^https?:/i.test(m.url) && QQ_MEDIA_RE.test(m.url)) {
            m.url = '/api/qqbot-settings/chat/voice-play?u=' + encodeURIComponent(m.url);
          }
        }
      }
      // 群图片/附件消息不带昵称壳 → 用之前最近一条有名字的群友文本消息推断发送者(只影响展示)
      {
        let prev = '';
        for (const it of items) {
          if (it.dir === 'in') {
            if (!it.sender && it.tag !== 'Web') it.sender = prev;
            if (it.text && it.tag !== 'Web') prev = it.sender;
          }
        }
      }
      writeJson(res, 200, { ok: true, items, hasMore: !reachedEnd, tailSeq: sess.seq });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // 面板富媒体发送: dock 聊天输入框 bbcode [MEDIA:kind|src] → 以机器人身份向群/私聊发富媒体。
  // src = http(s) 网络图/文件, 或本机绝对路径(D:\xxx\a.jpg)。复用 agentCtx 的
  // qqChannel.sender.sendMedia(与通道 send_media 工具同一咽喉, 含表情包闸门/撤回记账)。
  let hostBgSeq = 0; // dock 面板大文件后台任务序号(与通道工具后台任务同款语义)
  route(ctx, 'POST', '/api/qqbot-settings/chat/media', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad body' });
    const scope = String(body.scope || '');
    const peerId = String(body.peerId || '').trim();
    const kind = String(body.kind || '');
    const url = String(body.url || '').trim();
    const localPath = String(body.localPath || '').trim();
    if (scope !== 'group' && scope !== 'c2c') return writeJson(res, 400, { error: 'scope 必须为 group|c2c' });
    if (!peerId) return writeJson(res, 400, { error: 'peerId 必填' });
    if (!['image', 'video', 'voice', 'file'].includes(kind)) return writeJson(res, 400, { error: 'kind 必须为 image|video|voice|file' });
    const isUrl = /^https?:\/\//i.test(url);
    if (!isUrl && !localPath) return writeJson(res, 400, { error: 'url(http 链接) 或 localPath(本机路径) 至少给一个' });
    if (localPath) {
      // 本机直读: 面板和宿主同机, 文件存在才发(防手误/路径注入)
      try {
        const st = statSync(localPath);
        if (!st.isFile()) return writeJson(res, 200, { ok: false, msg: '本地文件不存在或不是文件: ' + localPath });
        if (st.size <= 0) return writeJson(res, 200, { ok: false, msg: '本地文件为空(0 字节)' });
      } catch {
        return writeJson(res, 200, { ok: false, msg: '读不到本地文件: ' + localPath + '(确认路径存在)' });
      }
    }
    const ns = String(body.ns || 'im-qqbot').trim();
    const kindLbl = kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'voice' ? '语音' : '文件';
    try {
      const reg = await import('./dist/features/session-registry.js');
      const rec = typeof reg.findRecordByPeerWeb === 'function' ? reg.findRecordByPeerWeb(ns, scope, peerId) : undefined;
      if (!rec || !rec.agent) return writeJson(res, 200, { ok: false, msg: '该目标暂无活跃会话(让机器人先聊过几句)' });
      const aCtx = rec.agent && (rec.agent.ctx || (rec.agent).agentCtx);
      const ch = aCtx && typeof aCtx.get === 'function' ? aCtx.get('qqChannel') : undefined;
      const sm = ch && ch.sender && typeof ch.sender.sendMedia === 'function' ? ch.sender : undefined;
      if (!sm) return writeJson(res, 200, { ok: false, msg: '机器人通道未就绪(给该目标发条消息后再试)' });
      const srcDesc = localPath ? localPath : url.slice(0, 120);
      // 本地大文件(≥5MB): 后台异步发送(分片耗时), 立即返回; 完成/失败往会话写 [系统] 后台任务通知(dock 可见+来源标)
      let localSize = 0;
      if (localPath) { try { localSize = statSync(localPath).size; } catch { localSize = 0; } }
      const FILE_ASYNC_MIN = 5 * 1024 * 1024;
      if (localPath && localSize >= FILE_ASYNC_MIN) {
        const seq = ++hostBgSeq;
        const fname = localPath.split(/[\\/]/).pop() || 'file';
        const fnameClean = String(fname).split('?')[0];
        const doSend = () => sm.sendMedia({ scope, targetId: peerId }, kind, { localPath });
        void (async () => {
          let okNote = '成功';
          try {
            await doSend();
            if (body.insertContext === true) {
              try {
                const relayText = String(body.relayText || '').slice(0, 500) || localPath;
                await appendUserRelayToPeer(ns, scope, peerId, '[MEDIA:' + kindLbl + '|' + relayText + ']');
              } catch { /* 上下文写入失败不影响发送结果提示 */ }
            }
          } catch (e) {
            okNote = '失败: ' + String((e && e.message) || e).slice(0, 120);
            const bot2 = nsBot(ns || undefined);
            if (bot2 && bot2.cwd) audit(bot2.cwd, { ev: 'chat.media.bg', ns, scope, peerId, kind, src: srcDesc, ok: false, error: okNote });
          }
          await appendNoticeToPeer(ns, scope, peerId, '[系统] 后台任务 #' + seq + ' ' + (okNote === '成功' ? ('完成: 已发送 ' + fnameClean + '(' + Math.round(localSize / 1048576 * 10) / 10 + 'MB)。') : ('失败: ' + okNote)));
        })();
        const bot0 = nsBot(ns || undefined);
        if (bot0 && bot0.cwd) audit(bot0.cwd, { ev: 'chat.media.bg-start', ns, scope, peerId, kind, src: srcDesc, size: localSize });
        return writeJson(res, 200, { ok: true, msg: '📤 大文件已提交后台任务 #' + seq + '(' + Math.round(localSize / 1048576 * 10) / 10 + 'MB), 分片上传中… 完成后会有通知', id: undefined });
      }
      const r = await sm.sendMedia({ scope, targetId: peerId }, kind, localPath ? { localPath } : { url });
      const bot = nsBot(ns || undefined);
      if (bot && bot.cwd) audit(bot.cwd, { ev: 'chat.media', ns, scope, peerId, kind, src: srcDesc, ok: true });
      // 与文本发送一致: insertContext=true → 往该会话写「用户代你发送: …」模拟消息(web 流/dock 可见, 不唤醒不开回合)
      // 文本用 [MEDIA:类型|来源] 结构化 → dock 能渲染本地上传图, bot 上下文也知道发了哪个来源
      let ctxNote = '';
      if (body.insertContext === true) {
        const relayText = String(body.relayText || '').slice(0, 500);
        const inner = relayText || srcDesc || kindLbl;
        const why = await appendUserRelayToPeer(ns, scope, peerId, '[MEDIA:' + kindLbl + '|' + inner + ']').catch(() => 'failed');
        if (why) { if (bot && bot.cwd) audit(bot.cwd, { ev: 'chat.media.relay-skip', ns, reason: why }); ctxNote = ' (' + (WHY_MAP[why] || why) + ')'; }
        else ctxNote = ' (已记入上下文)';
      }
      writeJson(res, 200, { ok: true, msg: '已发送' + kindLbl + ' ✓' + ctxNote, id: r && r.id });
    } catch (e) {
      const msg = String((e && e.message) || e);
      const bot = nsBot(ns || undefined);
      if (bot && bot.cwd) audit(bot.cwd, { ev: 'chat.media', ns, scope, peerId, kind, src: localPath || url.slice(0, 120), ok: false, error: msg });
      writeJson(res, 200, { ok: false, msg: '发送失败: ' + msg });
    }
  });

  // 面板文件选择器后端(小文件 base64 版): dock 旧客户端/小文件用, 落 dock-uploads。
  route(ctx, 'POST', '/api/qqbot-settings/chat/upload', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad body' });
    const bot = nsBot(String(body.ns || '').trim() || undefined);
    if (!bot || !bot.cwd) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
    const data = String(body.data || '');
    const m = data.match(/^data:([^;]+);base64,(.*)$/s) || data.match(/^base64:(.*)$/s);
    const b64 = m ? (m[2] || '') : data;
    if (!b64) return writeJson(res, 400, { error: 'data(base64) 必填' });
    let ext = String(body.ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!ext) ext = 'bin';
    if (ext.length > 6) return writeJson(res, 400, { error: '扩展名不合法' });
    try {
      const buf = Buffer.from(b64, 'base64');
      if (buf.length <= 0) return writeJson(res, 200, { ok: false, msg: '空文件' });
      const dir = join(bot.cwd, '.qqbot', 'dock-uploads');
      mkdirSync(dir, { recursive: true });
      const name = 'up' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.' + ext;
      const target = join(dir, name);
      writeFileSync(target, buf);
      writeJson(res, 200, { ok: true, path: target });
    } catch (e) {
      writeJson(res, 500, { error: String((e && e.message) || e) });
    }
  });

  // 面板文件选择器后端(大文件流式版): dock 📎 选中的任意大小文件直接以 octet-stream body 上传,
  // 流式写盘(不占内存上限 readJsonBody 的 8MB), 落 cwd/.qqbot/dock-uploads → client 插 [MEDIA:kind|path]。
  // 参数走 query: ns(账号实例), ext(扩展名); body = 原始文件字节。
  route(ctx, 'POST', '/api/qqbot-settings/chat/upload-raw', async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://x');
      const bot = nsBot(String(u.searchParams.get('ns') || '').trim() || undefined);
      if (!bot || !bot.cwd) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
      let ext = String(u.searchParams.get('ext') || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 6);
      if (!ext) ext = 'bin';
      const dir = join(bot.cwd, '.qqbot', 'dock-uploads');
      mkdirSync(dir, { recursive: true });
      const name = 'up' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.' + ext;
      const target = join(dir, name);
      const ws = createWriteStream(target);
      const MAX = 300 * 1024 * 1024;
      let size = 0;
      let failed = null;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX) { failed = 'too large(>300MB)'; break; }
          if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
        }
      } catch (e) {
        failed = String((e && e.message) || e);
      }
      await new Promise((r) => ws.end(r));
      if (failed || size <= 0) {
        try { rmSync(target, { force: true }); } catch { /* 忽略 */ }
        return writeJson(res, failed ? 413 : 400, { error: failed || '空文件' });
      }
      writeJson(res, 200, { ok: true, path: target, size });
    } catch (e) {
      writeJson(res, 500, { error: String((e && e.message) || e) });
    }
  });

  // dock 本地图片直出(渲染用户代发/本地上传图): 读本机文件回 bytes。
  // 仅本机同源可访问(route fence); <img> 不能跨域读取内容, 只作图片预览用。
  route(ctx, 'GET', '/api/qqbot-settings/chat/raw-media', async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://x');
      const p = String(u.searchParams.get('p') || '').trim();
      if (!p) return writeJson(res, 400, { error: 'p 必填' });
      const st = statSync(p);
      if (!st.isFile()) return writeJson(res, 404, { error: 'file not found' });
      if (st.size > 200 * 1024 * 1024) return writeJson(res, 413, { error: 'too large(>200MB)' });
      const ext = extname(p).slice(1).toLowerCase();
      const AUDIO = { ogg: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', amr: 'audio/amr', silk: 'audio/silk', webm: 'audio/webm' };
      const VIDEO = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4' };
      const type = MIME[ext] || AUDIO[ext] || VIDEO[ext] || 'application/octet-stream';
      // 支持 Range(视频/音频拖动播放需要): bytes=a-b
      let start = 0;
      let end = st.size - 1;
      let status = 200;
      const range = req.headers && req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(String(range));
        if (m) {
          const s1 = m[1] === '' ? undefined : parseInt(m[1], 10);
          const e1 = m[2] === '' ? undefined : parseInt(m[2], 10);
          if (s1 !== undefined && s1 < st.size) start = s1;
          if (e1 !== undefined && e1 < st.size) end = e1;
          if (end < start) end = Math.min(start + 1024 * 1024, st.size - 1);
          status = 206;
        }
      }
      const len = end - start + 1;
      const fd = openSync(p, 'r');
      const buf = Buffer.alloc(len);
      try { readSync(fd, buf, 0, len, start); } finally { closeSync(fd); }
      const headers = {
        'content-type': type,
        'content-length': len,
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
      };
      if (status === 206) headers['content-range'] = 'bytes ' + start + '-' + end + '/' + st.size;
      res.writeHead(status, headers);
      res.end(buf);
    } catch (e) {
      writeJson(res, 404, { error: String((e && e.message) || e) });
    }
  });

  // dock QQ 语音播放: 下载 SILK → 纯 JS(silk-wasm + lamejs-fixed)转 mp3 → 返回(带磁盘缓存)。
  // 零系统依赖(不依赖 ffmpeg/外部工具), 通用插件可直接打包; 浏览器播放 mp3 兼容性最好。
  route(ctx, 'GET', '/api/qqbot-settings/chat/voice-play', async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://x');
      const src = String(u.searchParams.get('u') || '').trim();
      if (!/^https?:\/\//i.test(src) || !QQ_MEDIA_RE.test(src)) return writeJson(res, 400, { error: 'u 必须为 QQ 媒体 URL' });
      const bot = nsBot(undefined);
      const cacheDir = join((bot && bot.cwd) || homedir(), '.qqbot', 'voice-cache');
      mkdirSync(cacheDir, { recursive: true });
      const key = createHash('sha256').update(src).digest('hex');
      const cf = join(cacheDir, key + '.mp3');
      if (!existsSync(cf)) {
        const resp = await fetch(src, { headers: { 'user-agent': 'Mozilla/5.0' } });
        if (!resp.ok) return writeJson(res, 502, { error: '语音下载失败(HTTP ' + resp.status + ')' });
        const buf = Buffer.from(await resp.arrayBuffer());
        const mod = await import('./voice-convert.mjs');
        if (!mod.isSilk(buf)) return writeJson(res, 415, { error: '该语音非 SILK 格式(QQ 语音均为 SILK)' });
        const { mp3 } = await mod.silkToMp3(buf);
        try { writeFileSync(cf, mp3); } catch { /* 缓存失败不影响播放 */ }
      }
      const mp3 = readFileSync(cf);
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': mp3.length, 'cache-control': 'public, max-age=86400' });
      res.end(mp3);
    } catch (e) {
      writeJson(res, 500, { error: String((e && e.message) || e) });
    }
  });

const WHY_MAP = { busy: '目标会话回合活跃(思考/流式中),已跳过注入', 'no-session': '未找到该群/私聊的活跃会话', 'no-msg': '构造消息失败', failed: '写入失败' };

  // 安全闸: 目标会话 LLM 回合活跃(turn/start 已开、turn/end 未闭合——覆盖思考中/流式输出/工具执行)
  // 时禁止外部往该会话插入任何消息(含模拟用户消息), 防止把正在生成的回合流搞乱(曾因此写坏会话)。
  // 查不到则放行(append 自身有 reenter 兜底)。
  function sessionTurnActive(sess) {
    try {
      const seq = typeof sess?.seq === 'number' ? sess.seq : -1;
      if (seq <= 0 || typeof sess.snapshotEvents !== 'function') return false;
      const tail = sess.snapshotEvents(Math.max(0, seq - 400), seq);
      let lastStart = -1;
      let lastEnd = -1;
      for (const ev of tail) {
        if (ev.type === 'turn/start') lastStart = ev.seq;
        else if (ev.type === 'turn/end') lastEnd = ev.seq;
      }
      return lastStart > lastEnd;
    } catch { return false; }
  }

  // 线B(用户代发→插入上下文): 往目标 QQ 会话 append 一条 user/message 模拟用户消息, 不唤醒、不开回合。
  // 文本以「用户代你发送: 」开头(只进 web 流, QQ 收到干净原文); 主人下次真人消息开回合时, 该
  // user/message 作为历史被 deriveMessages 组装进上下文 → bot 自然看到"主人代我发了这句"。
  // 活跃回合/找不到会话时跳过并在 audit 留痕。
  async function appendUserRelayToPeer(ns, scope, peerId, text) {
    const reg = await import('./dist/features/session-registry.js');
    let rec = typeof reg.findRecordByPeerWeb === 'function' ? reg.findRecordByPeerWeb(ns, scope, peerId) : undefined;
    // 活跃表 miss(会话被 idle 回收/未建立)→ 与入群申请通知/定时任务同款: getOrCreate 恢复/重建会话(不开回合),
    // 保证 log 存在能 append(否则 findRecordByPeerWeb 永远 no-session, QQ 发出但 web 流无痕)。
    if (!rec && typeof reg.getOrCreateByPeerWeb === 'function') {
      try { rec = await reg.getOrCreateByPeerWeb(ns, scope, peerId, 'master'); } catch { /* 恢复失败按 no-session 走 */ }
    }
    if (!rec || !rec.agent) return 'no-session';
    const agent = rec.agent;
    const sess = agent && (agent.session || (agent.ctx && agent.ctx.session));
    const appendFn = sess && typeof sess.append === 'function' ? sess.append.bind(sess) : undefined;
    if (!appendFn) return 'no-session';
    if (sessionTurnActive(sess)) return 'busy'; // 🔒 LLM 回合活跃(思考/流式中), 不插入
    const llm = await import('@deepseek-ai/dsh-llm');
    const relayText = `用户代你发送: ${text}`;
    const msg = llm.createUserMessage
      ? llm.createUserMessage({ content: [{ type: 'text', text: relayText }], source: { kind: 'user' } })
      : undefined;
    if (!msg) return 'no-msg';
    // 与 agent-loop turn()/入群申请通知同款: user/message 的 data 就是消息体本身(不包 message 层)。
    appendFn('user/message', msg, { surfaceOp: 'append' });
    return null;
  }

  // 后台任务结果通知写回会话(与通道工具 bgSend notifySession 同款形状: source kind user, 文本 [系统] 后台任务…)
  // dock 解码时按 isBg 显示为 bot 侧气泡 + 「后台任务」来源标。
  async function appendNoticeToPeer(ns, scope, peerId, text) {
    try {
      const reg = await import('./dist/features/session-registry.js');
      let rec = typeof reg.findRecordByPeerWeb === 'function' ? reg.findRecordByPeerWeb(ns, scope, peerId) : undefined;
      if (!rec && typeof reg.getOrCreateByPeerWeb === 'function') {
        try { rec = await reg.getOrCreateByPeerWeb(ns, scope, peerId, 'master'); } catch { /* 忽略 */ }
      }
      if (!rec || !rec.agent) return false;
      const agent = rec.agent;
      const sess = agent && (agent.session || (agent.ctx && agent.ctx.session));
      const appendFn = sess && typeof sess.append === 'function' ? sess.append.bind(sess) : undefined;
      if (!appendFn || sessionTurnActive(sess)) return false;
      appendFn('user/message', {
        id: 'bg-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36),
        role: 'user',
        content: [{ type: 'text', text: String(text || '') }],
        source: { kind: 'user' },
      }, { surfaceOp: 'append' });
      return true;
    } catch { return false; }
  }

  // 入群申请红点汇总(悬浮球 dock 用): 遍历所有已配置实例, 返回各实例待审申请数(计数不上报明细)
  route(ctx, 'GET', '/api/qqbot-settings/group/join-summary', async (_req, res) => {
    try {
      const { bots } = parsePatch();
      const out = [];
      for (const bot of bots) {
        if (bot.disabled || !bot.cfg?.appId || !bot.cfg?.appSecret) continue;
        try {
          const ns = bot.id;
          const gc = await groupClientOf(ns);
          if (!gc) continue;
          const reg = readGroupsJson(bot.cwd);
          let pending = 0;
          for (const gid of Object.keys(reg)) {
            if (!gid) continue;
            try {
              const r = await gc.client.listJoinRequests(gid);
              if (r.ok && Array.isArray(r.data?.list)) pending += r.data.list.length;
            } catch { /* 单群失败不阻断 */ }
          }
          out.push({ ns, pending });
        } catch { /* 实例失败跳过 */ }
      }
      writeJson(res, 200, { ok: true, items: out });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // 绑定/登记群 {ns?, gid, name?}
  route(ctx, 'POST', '/api/qqbot-settings/group/bind', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad body' });
    const gid = String(body.gid || '').trim();
    if (!gid) return writeJson(res, 400, { error: 'gid 必填' });
    try {
      const bot = nsBot(String(body.ns || ''));
      if (!bot) return writeJson(res, 400, { error: '找不到该账号实例(请先在账号页配置 appId/appSecret)' });
      const reg = readGroupsJson(bot.cwd);
      reg[gid] = { name: String(body.name || '').trim(), lastAt: Date.now() };
      writeGroupsJson(bot.cwd, reg);
      audit(bot.cwd, { ev: 'group.bind', ns: bot.id, gid });
      writeJson(res, 200, { ok: true });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // ── 审批双通道: Web 浮层同源路由(读待办 / 点按钮结算) ──
  // 数据来自各实例 QqApprovalController(经 registerApprovalController 注册表),
  // 与 QQ 按钮卡片/文本码共用同一 pending —— 先到先得, 两端天然同步。
  route(ctx, 'GET', '/api/qqbot-settings/approval/pending', async (_req, res) => {
    try {
      const mod = await import('./dist/features/qq-approval.js');
      const list = typeof mod.listAllPendingWeb === 'function' ? mod.listAllPendingWeb() : [];
      writeJson(res, 200, { ok: true, pending: list });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });
  // {code, act:'allow'|'deny'}
  route(ctx, 'POST', '/api/qqbot-settings/approval/decide', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad body' });
    const code = String(body.code || '').toUpperCase();
    const act = String(body.act || '');
    if (!code || (act !== 'allow' && act !== 'deny')) return writeJson(res, 400, { error: 'code 与 act(allow|deny) 必填' });
    try {
      const mod = await import('./dist/features/qq-approval.js');
      const r = typeof mod.decideByWebAny === 'function' ? mod.decideByWebAny(code, act) : { ok: false, msg: '审批模块不可用' };
      writeJson(res, r.ok ? 200 : 404, r);
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

  // ── 提问双通道: Web 浮层同源路由(读待办问题 / 点选项结算) ──
  route(ctx, 'GET', '/api/qqbot-settings/questions/pending', async (_req, res) => {
    try {
      const mod = await import('./dist/features/qq-user-questions.js');
      const list = typeof mod.listAllPendingQuestionsWeb === 'function' ? mod.listAllPendingQuestionsWeb() : [];
      writeJson(res, 200, { ok: true, pending: list });
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });
  // {key, optIdx}
  route(ctx, 'POST', '/api/qqbot-settings/questions/decide', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad body' });
    const key = String(body.key || '');
    const optIdx = Number(body.optIdx);
    if (!key || !Number.isInteger(optIdx) || optIdx < 0) return writeJson(res, 400, { error: 'key 与 optIdx 必填' });
    try {
      const mod = await import('./dist/features/qq-user-questions.js');
      const r = typeof mod.decideQuestionByWebAny === 'function' ? mod.decideQuestionByWebAny(key, optIdx) : { ok: false, msg: '提问模块不可用' };
      writeJson(res, r.ok ? 200 : 404, r);
    } catch (e) { writeJson(res, 500, { error: String((e && e.message) || e) }); }
  });

}
