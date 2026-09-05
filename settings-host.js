/**
 * qqbot-settings — host 半边: ①im-qqbot settings 命名空间经同源路由暴露给设置面板;
 * ②表情包图库管理 API(列表/缩略图/批量/导入), 与 dsh-qqbot 共享同进程 store 单例。
 * 仅 web profile 装配; 同源 fence 抄 modsearch。
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync, readdirSync, statSync, cpSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
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
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!isTrusted(req)) return writeJson(res, 403, { error: 'refused: same-origin loopback only' });
      if (req.method !== method) return writeJson(res, 405, { error: 'method not allowed' });
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
  route(ctx, 'GET', '/api/qqbot-settings/timers', async (req, res) => {
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
    const lines = raw.split('\n');
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
    return out.join('\n');
  }

  /** 保存实例清单(全量同步; 行级重建, 其它插件行/注释原样保留)
   *  借鉴 dsh-qqbot-panel(2026-09-06): appSecret 空值/掩码(********) = 保留原值,
   *  只有提供全新非掩码值才覆盖 —— 前端只回显掩码, 不会因漏传/未改而误清 secret。 */
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
      // 掩码/空 → 保留原 secret(仅当原值存在; 全新账号本就无原值则维持空)
      if (!inst.appSecret || inst.appSecret === SECRET_MASK) {
        const orig = bots.find((b) => b.id === inst.id);
        if (orig && orig.cfg?.appSecret) inst.appSecret = orig.cfg.appSecret;
        else inst.appSecret = '';
      }
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
      writeJson(res, 200, {
        hasFile,
        instances: bots.map((b) => {
          const cwd = b.cfg?.cwd || '';
          return {
            id: b.id,
            ns: b.id, // settings 命名空间 = 实例 id(主 im-qqbot; 非主实例 render 已写 settingsNs=id)
            appId: b.cfg?.appId || '',
            appSecret: b.cfg?.appSecret ? SECRET_MASK : '', // 掩码回显(借鉴 panel: masked)
            hasSecret: !!b.cfg?.appSecret,
            preset: b.cfg?.preset || '',
            cwd,
            disabled: !!b.disabled,
            // 账号数据目录(各号各库各定时): 图库={cwd}/表情包, 定时={cwd}/.qqbot
            dataDir: cwd ? join(cwd, '表情包') : '',
            schedDir: cwd ? join(cwd, '.qqbot') : '',
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

  // ── 扫码绑定注册流程(每个账号走 QQ 官方绑定, 拿平台下发的 appId/appSecret) ──
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
    const cwd = b.cfg?.cwd || '';
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

}
