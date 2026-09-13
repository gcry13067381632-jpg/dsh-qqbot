/**
 * channel-tools.ts — QQ 通道工具插件(send_media / recall_message)
 *
 * 标准 dsh-tool 插件：由 dsh-qqbot 在 QQ 会话的 setup 事务内(agentCtx)装载，
 * 因此只对 QQ 会话可见；任意 preset 走 QQ 都会带上；web 会话不经过 setup → 没有。
 *
 * 铁律：@deepseek-ai/dsh-tools 只经 peerDependencies 由宿主解析，本文件不得被
 * 复制进共享 node_modules，也不得在 dependencies 里自带 dsh-tools(避免双包)。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionManager } from './session/session-manager.js';
import type { QQBotSender } from './transport/outbound-buffer.js';
import { getStickerStore } from './features/sticker-store.js';
import { autoTagImage } from './features/sticker-tagger.js';
import { isStickerGateDenied } from './features/sticker-gate.js';
import { getScheduleStore } from './features/schedule-store.js';
import { switchOutboundMode } from './features/outbound-mode-switch.js';
import { loadExtensionTools } from './features/extension-store.js';
import { verifyHuman, groupRegistryPath } from './api/group-admin.js';
import { readGroupMembers } from './features/chat-ledger.js';
import * as broadcastQueue from './features/broadcast.js';
import { wakeSessionAgent, safeAppendUserMessage } from './features/group-hub.js';
import { managersOf, findManagerByPeer, findManagerBySessionId } from './features/session-registry.js';
import { handleInbound } from './transport/inbound.js';
import { getQuote } from './features/quote-cache.js';
import { appendMemoLine, deleteMemo, listMemos, readMemo } from './features/people-memo.js';

/** 诊断日志路径: 默认关闭; 需要排查时设环境变量 QQBOT_DIAG_FILE 指向日志文件 */
const DIAG_FILE = process.env.QQBOT_DIAG_FILE || '';
/** 大文件异步发送阈值: 本地文件 >= 5MB 时走后台任务(SDK 分片上传耗时, 避免阻塞 LLM 回合) */
const FILE_ASYNC_MIN = 5 * 1024 * 1024;
/** 等回合空闲的最长时间(ms); 与 QQ 入站 debounce 排队/group-hub safeAppend 同款语义 */
const TURN_WAIT_MS = 60_000;
let bgSeq = 0;
function fmtMB(n: number): string { return (n / 1048576).toFixed(1) + 'MB'; }
/** 从 exec 取 logger(ctx.logger), 拿不到用 console 兜底(类型兼容 Logger) */
function loggerLike(exec: { agent?: unknown }): import('./types.js').Logger {
  try {
    const a = exec.agent as { ctx?: { logger?: import('./types.js').Logger } } | undefined;
    if (a?.ctx?.logger) return a.ctx.logger;
  } catch { /* 忽略 */ }
  const c = console;
  return {
    info: (m: string, ...args: unknown[]) => c.info(m, ...args),
    warn: (m: string, ...args: unknown[]) => c.warn(m, ...args),
    error: (m: string, ...args: unknown[]) => c.error(m, ...args),
    debug: (m: string, ...args: unknown[]) => c.debug(m, ...args),
  };
}
/**
 * 把后台任务结果作为 user/message 写回会话(不唤醒, 与入群申请通知同款; 失败静默)。
 * 🔒 回合安全(主人硬约束 2026-09-09): LLM 回合进行中严禁 session.append(拆散 tool_calls 坏记录),
 *    先 agent.whenIdle() 等回合结束再写(与 QQ 入站 debounce 排队同款); 无 whenIdle/超时放弃。
 */
async function notifySession(agent: unknown, text: string): Promise<void> {
  try {
    const a = agent as { whenIdle?: () => Promise<void>; session?: { append?: (t: string, d: unknown, o?: unknown) => unknown } };
    const session = a?.session;
    if (!session || typeof session.append !== 'function') return;
    if (typeof a.whenIdle === 'function') {
      try {
        await Promise.race([a.whenIdle(), new Promise((r) => setTimeout(r, TURN_WAIT_MS))]);
      } catch { /* whenIdle 超时/异常 → 放弃写回(不坏记录) */ }
    }
    session.append('user/message', {
      id: 'bg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      role: 'user',
      content: [{ type: 'text', text: text }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' });
  } catch { /* 通知失败不影响发送结果 */ }
}
function diag(line: string): void {
  if (!DIAG_FILE) return;
  try { appendFileSync(DIAG_FILE, `${new Date().toISOString()} ${line}\n`); } catch { /* ignore */ }
}

/** 扩展工具注册诊断(固定落盘, 不依赖环境变量; 排查扩展没进工具列表用) */
function extDiag(line: string): void {
  try {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (!home) return;
    appendFileSync(home.replace(/\\/g, '/') + '/.dsh/qqbot-ext-diag.log', `[${new Date().toISOString()}] ${line}\n`);
  } catch { /* ignore */ }
}

/** qqChannel service 形状：由 dsh-qqbot 在 QQ 会话 ctx 上 provide */
export interface QQChannel {
  manager: SessionManager;
  sender: QQBotSender;
}

export const name = 'qqbot-channel-tools';
export const inject = ['tools'];

/**
 * 运行时按当前执行 agent 解析 qqChannel service。
 * 解析顺序: ①exec.agent.ctx.get('qqChannel')(agent ctx, setup 时 provide);
 * ②全局桥 channelBridge(bootstrap 直接注入 manager+sender)——不依赖 setup/provide,
 *   防止 setup 未执行/竞态导致"不是 QQ 会话"误判(线上踩坑: 重启后 setup 未跑到)。
 */
let channelBridges: QQChannel[] = [];
export function setChannelBridge(b: QQChannel | undefined): void {
  if (!b) return;
  const i = channelBridges.findIndex((x) => x.manager === b.manager);
  if (i >= 0) channelBridges[i] = b; else channelBridges.push(b);
}
function channelOf(exec: { agent?: unknown }): QQChannel | undefined {
  try {
    const agent = exec.agent as { ctx?: Context; id?: unknown } | undefined;
    const ctx = agent?.ctx;
    if (ctx) {
      const ch = ctx.get('qqChannel') as QQChannel | undefined;
      if (ch) return ch;
      diag('channelOf: agent.ctx 无 qqChannel, 尝试全局桥');
    } else {      diag(`channelOf: 无 agent.ctx (agent=${typeof agent}${agent ? ` keys=${Object.keys(agent).slice(0, 8).join(',')}` : ''})`);
    }
  } catch (e) {
    diag(`channelOf: ctx.get 异常 ${e instanceof Error ? e.message : String(e)}, 尝试全局桥`);
  }
  // ⚠️ C类修复(2026-09-11): 多实例下不能直接回退 channelBridges[0](可能是别的实例的桥)。
  //    先按 exec.agent 精确匹配所属实例的桥(不会张冠李戴), 匹配不到才回退第一个。
  if (exec.agent) {
    for (const b of channelBridges) {
      try {
        if (b.manager?.findByAgent(exec.agent as never)) return b;
      } catch { /* ignore */ }
    }
  }
  if (channelBridges.length) {
    diag('channelOf: 走全局桥成功');
    return channelBridges[0];
  }
  return undefined;
}

/** findByAgent 返回的非空记录类型 */
type SessionRec = Exclude<ReturnType<SessionManager['findByAgent']>, undefined>;
/**
 * 解析"当前执行 agent → 会话 + 通道"(多账号/热更新后 agent 引用可能跨实例或换新对象):
 * ① ctx 通道的 manager 按引用/id 找(findByAgent 已含 id 兜底); ② 找不到→遍历所有实例桥再找。
 */
function findSessionRec(ch: QQChannel | undefined, exec: { agent?: unknown }): { ch: QQChannel; rec: SessionRec } | undefined {
  const tryOne = (c: QQChannel | undefined): { ch: QQChannel; rec: SessionRec } | undefined => {
    if (!c?.manager || !exec.agent) return undefined;
    const rec = c.manager.findByAgent(exec.agent as never);    return rec ? { ch: c, rec } as { ch: QQChannel; rec: SessionRec } : undefined;
  };
  if (ch) { const r = tryOne(ch); if (r) return r; }
  for (const b of channelBridges) {
    if (b === ch) continue;
    const r = tryOne(b);
    if (r) return r;
  }
  return undefined;
}

/**
 * 按当前执行 agent 会话归属的账号实例取图库/定时 store(多账号: 各实例 cwd 各库)。
 * 解析优先级: ① findSessionRec(undefined, exec) —— 遍历全部实例桥、按 exec.agent 精确匹配 record
 *             (不会张冠李戴; 旧代码 findSessionRec(channelOf(exec),…) 在 agent 未命中时会错落 primary);
 *            ② channelOf(exec) —— agent.ctx 的 qqChannel(本实例通道), 退而求其次;
 *            ③ 回退 primary 单例库。
 */
function stickerStoreOf(exec: { agent?: unknown }): ReturnType<typeof getStickerStore> {
  try {
    const s = findSessionRec(undefined, exec);
    if (s) {
      diag(`stickerStoreOf: 按 agent 命中实例 dir=${s.ch.manager.stickerDataDir}`);
      return getStickerStore(s.ch.manager.stickerDataDir);
    }
    const ch = channelOf(exec as never);
    if (ch) {
      diag(`stickerStoreOf: 走 agent.ctx 通道 dir=${ch.manager.stickerDataDir}`);
      return getStickerStore(ch.manager.stickerDataDir);
    }
  } catch (e) {
    diag(`stickerStoreOf: 解析异常 ${e instanceof Error ? e.message : String(e)}`);
  }
  // 回退 primary(2026-09-11 B类: 尽力按 exec 所属实例 ns 取, 避免串到别的实例的库)
  let ns: string | undefined;
  try {
    const s2 = findSessionRec(undefined, exec);
    ns = s2?.ch.manager.settingsNs;
  } catch { /* ignore */ }
  diag(`stickerStoreOf: 回退 primary${ns ? ` ns=${ns}` : ''}`);
  return getStickerStore(undefined, undefined, ns);
}

/** 装载本插件时把 qqChannel 一并注入(由 dsh-qqbot setup 提供) */
export async function apply(ctx: Context): Promise<void> {
  const toolsAny = (ctx as { tools?: unknown }).tools as { register?: (t: unknown) => unknown } | undefined;
  diag(`apply 调用: tools=${typeof toolsAny} register=${typeof toolsAny?.register} ctxKeys=${Object.keys(ctx as object).slice(0, 12).join(',')}`);

  const sendMediaTool = defineTool({
    name: 'send_media',
    description: '在当前 QQ 会话给对方发送富媒体(图片/语音/视频/文件)。kind=image|voice|video|file；source=本地文件绝对路径 或 http(s) 网址。',
    parameters: {
      kind: { type: 'string', required: true, enum: ['image', 'voice', 'video', 'file'], description: '媒体类型' },
      source: { type: 'string', required: true, description: '本地绝对路径或 http(s) 网址' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [
        { type: 'text' as const, text: v.ok ? '已发送' : `发送失败: ${v.msg}` },
      ],
    },
    async execute(args, exec) {
      const _sess = findSessionRec(channelOf(exec as never), exec);
      if (!_sess) return { ok: false, msg: '未找到当前 QQ 会话(通道未就绪), 请稍后重试' };
      const ch = _sess.ch;
      const rec = _sess.rec;
      try {
        const srcOpt = /^https?:\/\//i.test(args.source)
          ? { url: args.source }
          : { localPath: args.source };
        // 本地大文件(>=5MB): 走后台任务——SDK 自动分片上传(prepare->parts->complete)耗时较长,
        // 工具立即返回不阻塞回合; 完成后/失败把系统消息写回会话, LLM 下轮自然知晓。
        if (srcOpt.localPath && typeof srcOpt.localPath === 'string') {
          let big = false;
          try { big = statSync(srcOpt.localPath).size >= FILE_ASYNC_MIN; } catch { big = false; }
          if (big && typeof srcOpt.localPath === 'string') {
            const lp = srcOpt.localPath as string;
            const st = statSync(lp);
            const fname = (lp.split(String.fromCharCode(92)).pop() || '').split('/').pop() || 'file';
            const seq = ++bgSeq;
            const agent = rec.agent as unknown;
            void ch.sender.sendMedia(rec.replyTarget, args.kind as never, { localPath: lp } as never)
              .then(async (r) => {
                await notifySession(agent, '[系统] 后台任务 #' + seq + ' 完成：已发送 ' + fname + '(' + fmtMB(st.size) + ')。');
                if (r && r.id) {
                  try {
                    const store = getStickerStore(ch.manager.stickerDataDir);
                    const sid = lookupId(store, lp);
                    if (sid) store.markUsed(sid);
                  } catch { /* 统计失败不影响发送 */ }
                }
                diag('bgSend #' + seq + ' ok ' + fname);
              })
              .catch(async (e) => {
                const msg = e instanceof Error ? e.message : String(e);
                await notifySession(agent, '[系统] 后台任务 #' + seq + ' 失败：' + msg + '（未发送完成, 可重试或改用小文件）');
                diag('bgSend #' + seq + ' fail ' + fname + ': ' + msg);
              });
            return { ok: true, msg: '📤 大文件 ' + fname + '(' + fmtMB(st.size) + ') 已提交后台任务 #' + seq + '——分片上传耗时较长, 完成/失败后会有系统消息通知' };
          }
        }
        const r = await ch.sender.sendMedia(rec.replyTarget, args.kind as never, srcOpt as never);
        // 发送成功且是图库里的本地图 → 标记"用过"(升正式区, 不入滚动清理)
        if (r?.id && srcOpt.localPath) {
          try {
            const store = getStickerStore(ch.manager.stickerDataDir);
            const sid = lookupId(store, srcOpt.localPath as string);
            if (sid) store.markUsed(sid);
          } catch { /* 统计失败不影响发送 */ }
        }
        return { ok: true, msg: r?.id ? String(r.id) : '' };
      } catch (e) {
        // 表情包闸门拒绝: 明确告知"不要重试", 避免 LLM 换图/反复尝试刷闸
        if (isStickerGateDenied(e)) {
          return { ok: false, msg: `表情包闸门拦截, 本轮不再尝试发图: ${e.message.replace(/^\[sticker-gate\]\s*/, '')}` };
        }
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const recallTool = defineTool({
    name: 'recall_message',
    description: '撤回本机器人最近发给当前 QQ 会话的消息。index 缺省 1(=最近一条)，2=倒数第 2 条，以此类推。',
    parameters: {
      index: { type: 'integer', description: '要撤的倒数第几条(默认1)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [
        { type: 'text' as const, text: v.ok ? '已撤回' : `撤回失败: ${v.msg}` },
      ],
    },
    async execute(args, exec) {
      const _sess = findSessionRec(channelOf(exec as never), exec);
      if (!_sess) return { ok: false, msg: '未找到当前 QQ 会话(通道未就绪), 请稍后重试' };
      const ch = _sess.ch;
      const rec = _sess.rec;
      const rawIdx = (args as { index?: number }).index;
      const idx = rawIdx == null || !Number.isFinite(rawIdx) ? 1 : rawIdx;
      try {
        const ok = await ch.sender.recallByIndex(rec.replyTarget, idx);
        return ok ? { ok: true, msg: '' } : { ok: false, msg: `第${idx}条无可撤回消息或已超时` };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const listStickersTool = defineTool({
    name: 'list_stickers',
    description: '(聊天加分项,气氛对就大胆用!)按情绪关键词搜本地表情包库, 挑最贴切的一张用 send_media(kind=image, source=路径) 发出去(一次最多一张); 实在查不到贴切的才回纯文字。',
    parameters: {
      query: { type: 'string', description: '语义关键词(可空=最近收藏; 匹配标签与描述)' },
      tag: { type: 'string', description: '标签过滤(可空)' },
      limit: { type: 'integer', description: '返回条数 1~20(默认 3)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          msg: { type: 'string', required: true },
          items: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
                desc: { type: 'string', required: true },
                used: { type: 'integer', required: true },
                formal: { type: 'boolean', required: true },
                src: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_a, v: { ok: boolean; msg: string; items: Array<{ path: string; tags: string[]; desc: string; used: number; formal: boolean; src: string }> }) => {
        if (!v.ok) return [{ type: 'text' as const, text: `查询失败: ${v.msg}` }];
        if (v.items.length === 0) {
          return [{ type: 'text' as const, text: '表情包库中无匹配,不建议发图,只回文字即可' }];
        }
        return v.items.map((it, i) => ({
          type: 'text' as const,
          text: `${i + 1}. [${it.tags.length > 0 ? it.tags.join('/') : '未打标'}] 用过${it.used}次${it.desc ? `\n   描述: ${it.desc.slice(0, 120)}` : ''}\n   → ${it.path}`,
        }));
      },
    },
    async execute(args, exec) {
      try {
        const store = stickerStoreOf(exec as never);
        const limitRaw = (args as { limit?: number }).limit;
        // 默认 3 条(2026-09-12 token 瘦身: 每条含描述+路径, 5 条≈白烧几十 token, 3 条足够挑图)
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.floor(limitRaw ?? 3))) : 3;
        const hits = store.search({
          q: (args as { query?: string }).query ?? '',
          tag: (args as { tag?: string }).tag ?? '',
          limit,
        });
        return {
          ok: true,
          msg: '',
          items: hits.map(h => ({
            path: h.path,
            tags: h.tags,
            desc: h.desc ?? '',
            used: h.useCount,
            formal: h.layer === 'library',
            src: h.sourceGroup ?? '',
          })),
        };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e), items: [] };
      }
    },
  });

  /** 按 path / id 前缀 / 来源URL 定位条目(list_stickers 的 path、或群消息里那张图的 URL 都行) */
  const lookupId = (store: ReturnType<typeof getStickerStore>, ref: string): string | undefined => {
    const r = (ref ?? '').trim();
    if (!r) return undefined;
    const direct = store.get(r);
    if (direct) return direct.id;
    if (/^https?:\/\//i.test(r)) {
      const byUrl = store.findBySourceUrl(r);
      if (byUrl) return byUrl.id;
    }
    if (r.includes('\\') || r.includes('/')) {
      const hit = store.search({ q: '', limit: 200, includeTrash: true }).find((h) => h.path === r);
      if (hit) return hit.id;
    }
    for (const it of store.search({ q: '', limit: 200, includeTrash: true })) {
      if (it.id.startsWith(r)) return it.id;
    }
    return undefined;
  };

  const tagStickerTool = defineTool({
    name: 'sticker_tag',
    description: '(主动维护)看到值得留的图就收藏+打标(群友发的有梗/好图, 不管这轮发不发): tags=逗号分隔中文短标签(如 爆笑,元气), desc=一句"画面+情绪+适用场合"; 缺标签的图(见 sticker_untagged)也用它补。想省视觉额度可传 vision=false(只对已在库的图打标)。',
    parameters: {
      sticker: { type: 'string', required: true, description: '图片URL 或 本地绝对路径(也可传 list_stickers 返回的路径)' },
      tags: { type: 'string', description: '逗号分隔中文标签,如 开心,元气,打招呼' },
      desc: { type: 'string', description: '一句中文详细描述(画面+情绪+适合场合)' },
      vision: { type: 'boolean', description: '图不在库时是否先识图生成草稿,默认true' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      try {
        const a = args as { sticker?: string; tags?: string; desc?: string; vision?: boolean };
        const store = stickerStoreOf(exec as never);
        const sticker = (a.sticker ?? '').trim();
        if (!sticker) return { ok: false, msg: 'sticker 不能为空' };
        const userTags = (a.tags ?? '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
        const userDesc = (a.desc ?? '').trim() || undefined;
        if (!userTags.length && !userDesc && a.vision === false) {
          return { ok: false, msg: 'tags/desc 至少给一个(或允许 vision 识图生成草稿)' };
        }

        let id = lookupId(store, sticker);
        let created = false;
        if (!id) {
          if (/^https?:\/\//i.test(sticker)) {
            const r = await store.capture(sticker, { sourceUrl: sticker }, undefined);
            if (r.status === 'error') return { ok: false, msg: `下载收藏失败: ${r.error}` };
            id = r.id;
            created = r.status === 'new';
          } else if (existsSync(sticker)) {
            const r = await store.importLocalFile(sticker);   // 2026-09-13 起 async(内部要算感知哈希 dHash)
            if (r.status === 'error') return { ok: false, msg: `导入失败: ${r.error}` };
            id = r.id;
            created = r.status === 'new';
          } else {
            return { ok: false, msg: '找不到这张图(图不在库里,且给的不是有效URL/路径)' };
          }
        }

        const userHas = userTags.length > 0 || !!userDesc;
        if (!created) {
          // 已在库: 给了内容→部分更新; 没给内容→不覆盖现有, 仅当该图本来空(待整理)才识图补
          const meta = store.get(id as string);
          if (userHas) {
            store.setDescTags(id as string, userTags.length ? userTags : undefined, userDesc);
            store.promote(id as string); // 主动打标=认可这张图 → 升正式区, 不入自动滚动清理
            return { ok: true, msg: '已更新标签/描述 ✓(并标记为收藏保留)' };
          }
          if (meta?.needsDescribe && a.vision !== false) {
            try {
              const p = store.pathOf(id as string);
              if (p) {
                const draft = await autoTagImage(p, '');
                if (draft) {
                  store.setDescTags(id as string, draft.tags, draft.desc);
                  return { ok: true, msg: `该图原无标签/描述,已识图补标: [${draft.tags.join('/')}]` };
                }
              }
            } catch { /* 草稿失败则提示用户手填 */ }
            return { ok: true, msg: '该图原无标签/描述,识图失败,请传 tags/desc 手动补' };
          }
          const cur = store.get(id as string);
          return {
            ok: true,
            msg: `该图已在库里(标签: ${(cur?.tags ?? []).join('/') || '无'}${cur?.desc ? `; 描述: ${cur.desc.slice(0, 60)}` : ''})。想改请传 tags/desc`,
          };
        }

        // 新收藏: 识图草稿(默认) + 用户内容覆盖
        let t: string[] | undefined = userTags.length ? userTags : undefined;
        let d: string | undefined = userDesc;
        const needDraft = !t && !d;
        if (needDraft && a.vision !== false) {
          try {
            const p = store.pathOf(id as string);
            if (p) {
              const draft = await autoTagImage(p, '');
              if (draft) { t = draft.tags; d = draft.desc; }
            }
          } catch { /* 草稿失败则留待整理 */ }
        }
        if (t || d) store.setDescTags(id as string, t, d);
        store.promote(id as string); // 主动收藏 → 正式区(不参与自动滚动清理)
        const tagsShown = (t ?? []).join('/') || '无';
        return { ok: true, msg: `已收藏并打标 [${tagsShown}]` };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const deleteStickerTool = defineTool({
    name: 'sticker_delete',
    description: '把表情包库里的某张图送进回收站(30天后自动清,期间可用 sticker_restore 找回)。当这张图不合适/不想要/发出去被嫌弃时用。sticker=那张图的本地路径(来自 list_stickers)或群图URL。',
    parameters: {
      sticker: { type: 'string', required: true, description: '要操作的图: list_stickers 查到的本地路径 / 或当时群消息里那张图的图片URL' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? '已送回收站(30天内可找回)' : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      try {
        const store = stickerStoreOf(exec as never);
        const id = lookupId(store, (args as { sticker?: string }).sticker ?? '');
        if (!id) return { ok: false, msg: '找不到这张图(请先用 list_stickers 拿到准确 path)' };
        store.markTrash(id);
        return { ok: true, msg: '' };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const restoreStickerTool = defineTool({
    name: 'sticker_restore',
    description: '从回收站找回一张图(取消删除)。sticker=回收站里那张图的路径或URL。',
    parameters: {
      sticker: { type: 'string', required: true, description: '回收站中那张图的路径或URL' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? '已找回 ✓' : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      try {
        const store = stickerStoreOf(exec as never);
        const id = lookupId(store, (args as { sticker?: string }).sticker ?? '');
        if (!id) return { ok: false, msg: '找不到(请确认在回收站且路径准确)' };
        store.restore(id);
        return { ok: true, msg: '' };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const statsStickerTool = defineTool({
    name: 'sticker_stats',
    description: '查看表情包库概况(总数/各分区/未打标数/占用)。想了解库存或准备整理时用: 若"未打标"数大于0, 接着用 sticker_untagged 翻出未整理图并 sticker_tag 补标, 保持弹药库好用。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.msg }],
    },
    async execute(_args, exec) {
      try {
        const s = stickerStoreOf(exec as never).stats();
        const mb = (s.totalBytes / 1024 / 1024).toFixed(1);
        return {
          ok: true,
          msg: `表情包库: 共${s.total}张(候选${s.candidate}/正式${s.library}/回收站${s.trash}/负${s.negative}), 未打标${s.untagged}张, 占用${mb}MB`,
        };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const untaggedStickerTool = defineTool({
    name: 'sticker_untagged',
    description: '(日常整理巡检,AI应主动做)列出表情包库里还没整理完的图(缺标签或缺介绍)。群里没活/或想维护图库时先调它(也可先 sticker_stats 看有没有未打标), 发现有图就逐张用 sticker_tag 补标签和一句描述; 库越干净, list_stickers 搜图越准。参数 a: 1=全部(候选+收藏) 2=只看收藏(正式文件夹)。可选 limit(每批条数, 默认20, 上限100)、offset(跳过前N条, 翻页用)。',
    parameters: {
      a: { type: 'integer', enum: [1, 2], required: true, description: '1=查全部 2=只查收藏文件夹(正式)' },
      limit: { type: 'integer', description: '每批返回条数(1-100, 默认20)' },
      offset: { type: 'integer', description: '跳过前 N 条(翻页用, 默认0)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.msg }],
    },
    async execute(args, exec) {
      try {
        const store = stickerStoreOf(exec as never);
        const onlyLibrary = args.a === 2;
        const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 20)));
        const offset = Math.max(0, Math.floor(args.offset ?? 0));
        // untagged 查询语义=标签与介绍都空; 这里要"缺任一即算未整理", 故全量取回后过滤
        const all = store.queryAll({ layer: onlyLibrary ? 'library' : undefined, q: undefined, untagged: false, includeTrash: false });
        const miss = all.filter((it) => it.layer !== 'negative' && ((!it.tags || it.tags.length === 0) || !it.desc));
        const total = miss.length;
        const end = Math.min(total, offset + limit);
        const page = miss.slice(offset, end);
        const lines = page.map((it, i) => {
          const lackTag = !it.tags || it.tags.length === 0;
          const lackDesc = !it.desc;
          const lack = lackTag && lackDesc ? '缺标签+介绍' : lackTag ? '缺标签' : '缺介绍';
          return `${offset + i + 1}. [${it.layer === 'library' ? '收藏' : '候选'}] ${lack} ${it.path || ''}`;
        });
        const scopeTxt = onlyLibrary ? '收藏文件夹' : '全部(候选+收藏)';
        const more = total > end ? `\n(还有 ${total - end} 张, 想看更多请传 offset=${end} 继续翻页)` : '';
        return {
          ok: true,
          msg: total === 0
            ? `🎉 ${scopeTxt}里的图都整理好了(都带标签和介绍)`
            : `未整理完的图(${scopeTxt}): 共 ${total} 张, 显示第 ${offset + 1}-${end} 张:\n${lines.join('\n')}${more}\n想补的用 sticker_tag 打标/写介绍(图路径就是上面返回的)。`,
        };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const scheduleTimerTool = defineTool({
    name: 'schedule_timer',
    description: '给自己(当前 QQ 会话)安排定时任务: 到点后系统会把 prompt 作为新消息注入本会话, 你会带着上下文处理并回复到 QQ。kind=once(一次性, 默认)或 daily(每天固定时刻)。once 用 seconds(N 秒后, ≥30) 或 atTime(今天 HH:MM, 已过则明天); daily 必填 atTime(HH:MM)。seconds 与 atTime 至少给一个。同一会话同一时刻的每日任务不要重复建。',
    parameters: {
      kind: { type: 'string', enum: ['once', 'daily'], description: 'once=一次性(默认); daily=每天固定时刻' },
      seconds: { type: 'integer', description: '多少秒后触发(仅 once; ≥30)' },
      atTime: { type: 'string', description: '几点几分 24h 制 HH:MM(如 08:30; once 且无 seconds 时=今天该点已过则明天; daily 必填)' },
      prompt: { type: 'string', required: true, description: '到点后注入本会话的提示内容(≤800字), 写清要你做什么' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `定时失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      const _sess = findSessionRec(channelOf(exec as never), exec);
      if (!_sess) return { ok: false, msg: '未找到当前 QQ 会话(通道未就绪), 请稍后重试' };
      const ch = _sess.ch;
      const rec = _sess.rec;
      try {
        const store = getScheduleStore(ch.manager.scheduleDataDir);
        const r = store.add({
          kind: (args.kind as 'once' | 'daily' | undefined) ?? undefined,
          scope: rec.scope,
          peerId: rec.peerId,
          seconds: args.seconds,
          atTime: args.atTime,
          prompt: args.prompt,
        });
        if (!r.ok || !r.id) return { ok: false, msg: r.error ?? '创建失败' };
        const job = store.get(r.id);
        let whenDesc = '';
        if (job) {
          if (job.kind === 'daily') {
            whenDesc = `每天 ${job.atTime}`;
          } else {
            const nf = store.nextFireAt(job);
            whenDesc = nf ? new Date(nf).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '稍后';
          }
        }
        return { ok: true, msg: `✅ 已创建${job?.kind === 'daily' ? '每日' : '一次性'}定时任务(id=${r.id}, ${whenDesc}触发)。到点我会自动收到提示并处理。可用 schedule_cancel 查看/取消。` };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const scheduleCancelTool = defineTool({
    name: 'schedule_cancel',
    description: '取消/删除当前会话的定时任务。不带 id 调用会列出本会话全部定时任务(id+时间+内容)供挑选; 带 id 则删除该任务。',
    parameters: {
      id: { type: 'string', description: '要删除的任务 id(不填=列出本会话所有定时任务)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.msg }],
    },
    async execute(args, exec) {
      const _sess = findSessionRec(channelOf(exec as never), exec);
      if (!_sess) return { ok: false, msg: '未找到当前 QQ 会话(通道未就绪), 请稍后重试' };
      const ch = _sess.ch;
      const rec = _sess.rec;
      const store = getScheduleStore(ch.manager.scheduleDataDir);
      if (!args.id) {
        const mine = store.list().filter(j => j.scope === rec.scope && j.peerId === rec.peerId);
        if (mine.length === 0) return { ok: true, msg: '本会话暂无定时任务。' };
        const lines = mine.map(j => {
          const when = j.kind === 'daily'
            ? `每天 ${j.atTime}`
            : j.dueAt
              ? new Date(j.dueAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
              : '';
          return `- id=${j.id} ${j.kind === 'daily' ? '每日' : '一次性'} ${when}${j.enabled ? '' : ' [已停用]'} | ${(j.prompt ?? '').slice(0, 60)}`;
        });
        return { ok: true, msg: `本会话定时任务共 ${mine.length} 条:\n${lines.join('\n')}\n要删除哪条, 请带对应 id 再调用 schedule_cancel。` };
      }
      const job = store.get(args.id);
      if (!job || job.scope !== rec.scope || job.peerId !== rec.peerId) {
        return { ok: false, msg: `任务 ${args.id} 不存在或不属于本会话` };
      }
      store.remove(args.id);
      return { ok: true, msg: `🗑️ 已删除定时任务 ${args.id}` };
    },
  });

  // text_break: 专用"打断正文"工具(2026-09-05, 主人定) —— 零副作用、零查询、近零 token。
  // 机制: 把回复正文拆成多个文本块、块间调用本工具, QQ 端就会把每块作为独立一条消息发出
  // (工具调用 = 天然断点)。本工具不做事: 输入任意(留空即可), 返回空, 仅用于中断文本流。
  // ⚠️ 数量不限制: 连发条数由「出站方式」控制(适配主动默认=同一条入站消息前5条被动回复、
  //   第6条起自动转主动), 工具本身无 5 条限制; 5 条上限是旧「被动回复同一 msg」的 QQ 限制, 已由适配主动解决。
  const textBreakTool = defineTool({
    name: 'text_break',
    description: '打断正文实现"逐条发送": 想逐字/逐句卖萌或把长话拆成多条连发时, 把内容拆成几个文本块, 每块之间调用一次本工具(参数随便填个占位值即可), 对方就会收到分割的多条消息。工具本身无任何副作用, 不会发东西。拆多少条都行, 没有 5 条限制(连发保护由出站方式自动处理: 前5条带引用、之后自动转独立消息, 不会被吞)。',
    parameters: {
      next: { type: 'string', required: true, description: '占位参数: 随便填一个值(如 "." 或下一段内容), 工具不读它, 只用于打断文本流' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true } },
      },
      render: () => [{ type: 'text' as const, text: '' }],
    },
    async execute() {
      return { ok: true }; // 纯打断, 无实质结果
    },
  });

  // reply_gate: 回复闸门(实验, 2026-09-05, 主人设想: 让 AI"自主判定要不要回", 判定不吃瓜时由宿主硬终止回合,
  // 实现"真·静默吃瓜"。机制参考 dsh-task-control: agent.cancel({kind:'user'},{keepInbox:true}) 立即切断当前回合输出)。
  // ⚠️ 描述只讲两个分支的效果, 不给场景规则——选哪个由模型按当前对话氛围自行权衡(写死规则会导致静默率过高)。
  const replyGateTool = defineTool({
    name: 'reply_gate',
    description: '回复闸门: 开始回复前先调用它, 决定本回合开口还是静默。传 reply:true → 正常继续, 按当前对话决定说什么; 传 reply:false → 本回合立即静默终止, 你不会再输出任何内容(这条消息就像没发生过)。选 true 还是 false 由你根据当前对话自己判断: 觉得该回应就 true, 觉得安静待着更好就 false。',
    parameters: {
      reply: { type: 'boolean', required: true, description: 'true=正常开口回复; false=静默终止本回合(不再输出任何内容)' },
      reason: { type: 'string', required: true, description: '简短判定理由, 如"未@不插嘴" / "被@需回复" / "私聊"' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          stopped: { type: 'boolean', required: true },
        },
      },
      render: (_a, v: { ok: boolean; stopped: boolean }) => [
        { type: 'text' as const, text: v.stopped ? '(已静默: 本回合终止, 不再回复)' : '' },
      ],
    },
    async execute(args, exec) {
      if (args.reply === false) {
        try {
          const agent = (exec as unknown as { agent?: unknown }).agent as
            | { cancel?: (kind: unknown, opts?: unknown) => unknown }
            | undefined;
          if (agent && typeof agent.cancel === 'function') {
            agent.cancel({ kind: 'user' }, { keepInbox: true });
          }
        } catch {
          /* cancel 抛错也按静默处理 */
        }
        return { ok: true, stopped: true };
      }
      return { ok: true, stopped: false };
    },
  });

  // outbound_mode: 出站模式开关(2026-09-07, 主人定) —— 让 AI 自己决定三档(不含 nothink!)
  // ⚠️ 安全边界: nothink(完全不思考)禁止 AI 自切(防锁死, 主人只能在设置页配; 唤醒走 /outmode 斜杠)。
  // 切换走 outbound-mode-switch 注册表 → live 热生效 + settings 持久化 → dock/设置一致。
  const outboundModeTool = defineTool({
    name: 'outbound_mode',
    description:
      '出站模式开关(自己决定, 热更新不用重启): adaptive=适配主动(默认: 真人消息前5条带引用、连发自动转独立消息不被QQ吞); detail=详细主动(聊天同 adaptive, 额外把工具调用/工具结果也推到QQ —— 主人要看进度时用, 消息会变多, 用完切回); passive=被动(始终回最后一条, 连发约4~5条后被QQ吞); silent=完全不出站(照常思考但不发, 潜水观察)。nothink 那档只能主人在设置页配。' +
      '\n怎么选: 正常聊天/被@→adaptive · 主人要看工具进度→detail · 想保持引用感→passive · 判断不该在群里说话→silent',
    parameters: {
      mode: { type: 'string', required: true, enum: ['adaptive', 'detail', 'passive', 'silent'], description: '目标模式: adaptive(默认推荐) / detail(详细主动: 连工具调用一起推) / passive / silent' },
      reason: { type: 'string', required: true, description: '为什么切到这档(简短理由)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true }, mode: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string; mode: string }) => [
        { type: 'text' as const, text: v.ok ? `(出站模式 → ${v.mode})` : `切换失败: ${v.msg}` },
      ],
    },
    async execute(args, exec) {
      if (args.mode !== 'adaptive' && args.mode !== 'detail' && args.mode !== 'passive' && args.mode !== 'silent') {
        return { ok: false, msg: '只允许 adaptive/detail/passive/silent(nothink 需主人在设置页配置)', mode: String(args.mode ?? '') };
      }
      // 多实例修复(2026-09-11): 按当前会话所属实例(ns)切换 —— 原全局单例 writer 会被多实例覆盖,
      // 导致切到别的实例的 config(dock 显示与实际不符)。
      let ns: string | undefined;
      try {
        const _sess0 = findSessionRec(channelOf(exec as never), exec as never);
        ns = _sess0?.ch.manager.settingsNs;
      } catch { /* 解析失败则交给 switchOutboundMode 单实例兜底 */ }
      const r = await switchOutboundMode(args.mode, ns);
      if (!r.ok) return { ok: false, msg: r.msg, mode: r.mode };
      // 切换成功后用 bot 直发确认消息(绕过出站路由): 即使切到 silent(不出站)/被动,
      // 主人也一定能收到"模式已切换"的通知(与 send_media 同款工具直发通道, 不受 outboundMode 拦截)。
      const MODE_LABEL: Record<string, string> = {
        adaptive: '适配主动(推荐默认): 真人消息前5条带引用回你, 连发自动转独立消息',
        detail: '详细主动: 聊天同适配主动, 额外把工具调用/工具结果也推给你(看进度用)',
        passive: '被动: 始终回复你那条(连发约4~5条后被QQ吞)',
        silent: '完全不出站: 照常思考但这条回复不发出(潜水观察用; web上仍可对话)',
      };
      try {
        const _sess = findSessionRec(channelOf(exec as never), exec as never);
        if (_sess) {
          const confirm = `⇄ 出站模式已切换: **${r.mode}**\n${MODE_LABEL[r.mode] ?? ''}\n(由 outbound_mode 工具切换, bot 直发确认)`;
          await _sess.ch.sender.sendMarkdown(_sess.rec.replyTarget, confirm);
        }
      } catch (err) {
        diag(`outbound_mode 确认消息直发失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return { ok: true, msg: r.msg, mode: r.mode };
    },
  });

  // ── QQ 群管理工具组(2026-09-05, P2; 依赖 config.groupAdmin.enabled + 机器人=群管理员) ──
  // 危险写操作(审批/禁言)仅按主人指示执行(工具描述写死约束); owners 白名单接入留待后续,
  // 官方未开放能力(踢人/成员列表)由 client FEATURE_GATES 返回人话, 不在本层重复。
  // 目标群解析(2026-09-05 主人定): QQ 群会话 → 当前群; web/非群会话 → config.groupAdmin.manageGroup
  // ("对话里管一个群"不依赖会话形态; 多群管理走设置 UI⑥ P3)。
  // ⚠️ 升级 0.1.2-rc.1 后补强(2026-09-05): web 直连 agent 可能不在 SessionManager 会话表里,
  //    findSessionRec 失败 → 旧逻辑直接 return undefined, manageGroup 兜底形同虚设。
  //    改为: 找不到会话也回退到全局桥 manager(groupAdmin.enabled 且 manageGroup 非空即可用)。
  function groupAdminOf(exec: unknown): { client: NonNullable<SessionManager['groupAdmin']>; gid?: string } | undefined {
    try {
      const s = findSessionRec(channelOf(exec as never), exec as never);
      if (s) {
        const client = s.ch.manager.groupAdmin;
        if (!client) return undefined;
        const t = s.rec.replyTarget;
        const gid = t && t.scope === 'group'
          ? t.targetId
          : s.ch.manager.manageGroup || undefined;
        return { client, gid };
      }
      // 会话表无此 agent(web 直连等): 遍历全局桥, 找第一个"群管理开启 + 配了 manageGroup"的实例
      for (const b of channelBridges) {
        try {
          const client = b.manager.groupAdmin;
          if (!client) continue;
          const mg = b.manager.manageGroup;
          if (mg) return { client, gid: mg };
        } catch { /* 跳过坏桥 */ }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  const listJoinRequestsTool = defineTool({
    name: 'group_join_requests',
    description: '群管理(读): 看待审批入群申请(**默认只给本页 5 条**, 用 page 翻页; 同一人重复申请只留最新)。传 gid 可查指定群, 不填=当前群/manageGroup。仅主人要求时调用; 需开启"QQ群管理"且机器人为群管理员。跨群审批请显式带 gid。' +
      '\n示例: {gid:"<群openid>"} · {gid:"<群openid>", page:2} · {limit:20 看全}',
    parameters: {
      gid: { type: 'string', description: '目标群 openid(可选)。不填=当前会话群或 manageGroup' },
      page: { type: 'integer', description: '第几页(默认 1)' },
      limit: { type: 'integer', description: '本页条数 1~20(默认 5; 要一次看全可传 20)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      const ga = groupAdminOf(exec);
      if (!ga) return { ok: false, msg: '群管理未开启(设置→QQ群管理)或非群会话' };
      const gid = args.gid || ga.gid;
      if (!gid) return { ok: false, msg: '当前不是群会话且未指定 gid, 无法确定目标群' };
      const r = await ga.client.listJoinRequests(gid);
      if (!r.ok) return { ok: false, msg: r.err.human };
      // 补群名(官方 info 接口, 失败不阻断)
      let gname = '';
      try {
        const gi = await ga.client.getGroupInfo(gid);
        if (gi.ok && gi.data?.group_name) gname = gi.data.group_name;
      } catch { /* 群名失败不影响 */ }
      const raw = r.data.list;
      if (raw.length === 0) return { ok: true, msg: `当前没有待审批的入群申请 ✓(群 ${gname ? `「${gname}」` : ''}${gid})` };
      // 去重(2026-09-12 主人要求): 同一人反复申请只留**最新**一条 —— 官方列表按时间倒序, 故首次出现即最新
      const seen = new Set<string>();
      const list = raw.filter((j) => {
        const key = String(j.member_openid ?? '');
        if (key === '' || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      // 分页(2026-09-12 token 瘦身): 默认只回 5 条, 其余用 page 翻
      const lim = Math.max(1, Math.min(20, Math.round(Number(args.limit)) || 5));
      const totalPages = Math.max(1, Math.ceil(list.length / lim));
      const page = Math.min(Math.max(1, Math.round(Number(args.page)) || 1), totalPages);
      const start = (page - 1) * lim;
      const slice = list.slice(start, start + lim);
      const head = `入群申请 共 ${raw.length} 条(去重后 ${list.length} 条 · 第 ${page}/${totalPages} 页 · 每页 ${lim} 条) 群 ${gname ? `「${gname}」` : ''}${gid}:`;
      const lines = slice.map((j, i) => `${start + i + 1}. ${j.username ?? '?'} (${j.member_openid}) 来源:${j.apply_source ?? '?'} 验证:${verifyHuman(j.verify_info) || '-'}${j.risk_tips ? ` ⚠️${j.risk_tips}` : ''}`);
      const more = list.length > start + slice.length ? `\n（还有 ${list.length - start - slice.length} 条 → 再调本工具传 page=${page + 1}）` : '';
      return { ok: true, msg: `${head}\n${lines.join('\n')}${more}` };
    },
  });

  const approveJoinTool = defineTool({
    name: 'group_approve_join',
    description:
      '群管理(写,危险): 审批入群申请(approve 放行 / decline 拒绝可带理由), 支持批量 member_openids。仅主人明确要求时调用; 调用前先用 group_join_requests 核对申请人。⚠️跨群审批务必显式传 gid(不传=当前会话所在群, 会批错群)。' +
      '\n示例: {gid:"<群openid>", member_openids:["<id1>","<id2>"], op:"approve", reason:"-"} · 拒绝: op:"decline", reason:"答非所问"',
    parameters: {
      gid: { type: 'string', description: '目标群 openid(可选)。不填=当前会话群或 manageGroup; 填了则审批指定群的申请' },
      member_openids: { type: 'array', description: '批量审批: 申请人 member_openid 数组(来自 group_join_requests), 一次批多人' },
      member_openid: { type: 'string', description: '单个申请人 member_openid(批量时可不填)' },
      op: { type: 'string', required: true, enum: ['approve', 'decline'], description: 'approve 放行 / decline 拒绝' },
      reason: { type: 'string', required: true, description: '拒绝理由(decline 时填; approve 或不需要可填 "-")' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      const ga = groupAdminOf(exec);
      if (!ga) return { ok: false, msg: '群管理未开启或非群会话' };
      const gid = args.gid || ga.gid;
      if (!gid) return { ok: false, msg: '当前不是群会话且未指定 gid' };
      const targets = Array.isArray(args.member_openids) && args.member_openids.length
        ? args.member_openids
        : (args.member_openid ? [args.member_openid] : []);
      if (targets.length === 0) return { ok: false, msg: '请提供要审批的 member_openid(可多个)' };
      // join_request_id 官方审批必填(缺省报 40103007): 先拉列表按 member_openid 匹配自动补上
      const listR = await ga.client.listJoinRequests(gid);
      if (!listR.ok) return { ok: false, msg: listR.err.human };
      const list = listR.data.list ?? [];
      const results: string[] = [];
      let failed = 0;
      for (const midRaw of targets) {
        const mid = String(midRaw);
        const found = list.find((j) => j.member_openid === mid);
        const r = await ga.client.approveJoinRequest(gid, mid, args.op as 'approve' | 'decline', {
          ...(found ? { join_request_id: String(found.join_request_id ?? '') } : {}),
          ...(args.op === 'decline' && String(args.reason ?? '') && String(args.reason) !== '-'
            ? { reject_reason: String(args.reason) }
            : {}),
        });
        if (r.ok) {
          results.push(`${String(mid).slice(0, 10)}… ${args.op === 'approve' ? '✅放行' : '已拒绝'}${found ? `(${String(found.username ?? '')})` : ''}`);
        } else {
          failed++;
          results.push(`${String(mid).slice(0, 10)}… ❌ ${r.err.human}`);
        }
      }
      if (failed === 0) {
        return { ok: true, msg: `${args.op === 'approve' ? '✅ 已全部放行' : '已全部拒绝'} ${targets.length} 人:\n${results.join('\n')}` };
      }
      return { ok: failed === targets.length ? false : true, msg: `${targets.length - failed}/${targets.length} 成功:\n${results.join('\n')}` };
    },
  });

  /**
   * 入群申请「自动审批」(2026-09-12 主人要求): 给一组关键词 —— **验证消息命中的程序直接放行, 不命中的直接拒绝**。
   * ⚠️ 基于**官方待审列表**(`join_request_list`), **不是**本地 pending 流水 —— 后者含已处理/重复事件, 照着批会报错。
   * ⚠️ 拒绝不可逆: 默认直接执行(主人风格), 想先看结果传 `dry_run=true`。
   * 拒绝理由一律中性(默认"答非所问"), **绝不写暗号/答案/内部判据**。
   */
  const autoApproveJoinTool = defineTool({
    name: 'group_join_auto',
    description: '群管理(写,危险,**仅主人明确要求时调用**): 按关键词批量审批入群申请 —— 验证消息**命中任一关键词的放行**, 其余直接拒绝。基于官方待审列表(不含本地历史流水)。拒绝不可逆; 想先看结果传 dry_run=true。' +
      '\n示例: {gid:"<群openid>", keywords:["早饭"], rejectReason:"答非所问"} · 只放行不拒: {..., rejectUnmatched:false} · 预览: {..., dry_run:true}',
    parameters: {
      gid: { type: 'string', description: '目标群 openid(可选; 不填=当前会话群/manageGroup)' },
      keywords: { type: 'array', items: { type: 'string' }, required: true, description: '放行关键词(任一命中即放行; 不区分大小写)' },
      rejectUnmatched: { type: 'boolean', description: 'true(默认)=未命中的一律拒绝; false=只放行命中的, 其余不动' },
      rejectReason: { type: 'string', description: '拒绝理由(默认"答非所问"; 不要写暗号/答案)' },
      dry_run: { type: 'boolean', description: 'true=只返回"将放行/拒绝哪些人", 不执行' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      const ga = groupAdminOf(exec);
      if (!ga) return { ok: false, msg: '群管理未开启(设置→QQ群管理)或非群会话' };
      const gid = String(args.gid || ga.gid || '');
      if (!gid) return { ok: false, msg: '当前不是群会话且未指定 gid, 无法确定目标群' };
      const kws = (Array.isArray(args.keywords) ? args.keywords : [])
        .map((k) => String(k).trim().toLowerCase())
        .filter(Boolean);
      if (kws.length === 0) return { ok: false, msg: 'keywords 至少给一个(放行关键词)' };
      const r = await ga.client.listJoinRequests(gid);
      if (!r.ok) return { ok: false, msg: r.err.human };
      const raw = r.data.list;
      if (raw.length === 0) return { ok: true, msg: '当前没有待审批的入群申请 ✓(无需自动审批)' };
      // 同一人重复申请只留最新(官方列表按时间倒序 → 首次出现即最新)
      const seen = new Set<string>();
      const list = raw.filter((j) => {
        const k = String(j.member_openid ?? '');
        if (k === '' || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const hitList: typeof list = [];
      const missList: typeof list = [];
      for (const j of list) {
        const text = verifyHuman(j.verify_info).toLowerCase();
        (kws.some((k) => text.includes(k)) ? hitList : missList).push(j);
      }
      const rejectUnmatched = args.rejectUnmatched !== false;
      const nameOf = (j: (typeof list)[number]): string => `${j.username ?? '?'}(…${String(j.member_openid).slice(-4)})`;
      if (args.dry_run === true) {
        return {
          ok: true,
          msg: `【dry-run, 未执行】待审 ${list.length} 条(去重后):\n` +
            `将放行 ${hitList.length} 人: ${hitList.slice(0, 5).map(nameOf).join('、') || '(无)'}\n` +
            `将拒绝 ${rejectUnmatched ? missList.length : 0} 人: ${rejectUnmatched ? (missList.slice(0, 5).map(nameOf).join('、') || '(无)') : '(已关闭)'}`,
        };
      }
      let okA = 0; let failA = 0; let okD = 0; let failD = 0;
      const errs: string[] = [];
      for (const j of hitList) {
        const rr = await ga.client.approveJoinRequest(gid, String(j.member_openid), 'approve', {
          join_request_id: String(j.join_request_id ?? ''),
        });
        if (rr.ok) okA++; else { failA++; errs.push(`${nameOf(j)} 放行失败: ${rr.err.human}`); }
      }
      if (rejectUnmatched) {
        const reason = String(args.rejectReason ?? '').trim() || '答非所问';
        for (const j of missList) {
          const rr = await ga.client.approveJoinRequest(gid, String(j.member_openid), 'decline', {
            join_request_id: String(j.join_request_id ?? ''),
            reject_reason: reason,
          });
          if (rr.ok) okD++; else { failD++; errs.push(`${nameOf(j)} 拒绝失败: ${rr.err.human}`); }
        }
      }
      return {
        ok: true,
        msg: [
          `✅ 自动审批完成: 放行 ${okA}/${hitList.length}${rejectUnmatched ? ` · 拒绝 ${okD}/${missList.length}` : ''}(待审共 ${list.length} 条)`,
          hitList.length ? `放行: ${hitList.slice(0, 5).map(nameOf).join('、')}${hitList.length > 5 ? ` …等 ${hitList.length} 人` : ''}` : '',
          rejectUnmatched && missList.length ? `拒绝: ${missList.slice(0, 5).map(nameOf).join('、')}${missList.length > 5 ? ` …等 ${missList.length} 人` : ''}` : '',
          errs.length ? `⚠️ 失败 ${failA + failD} 条: ${errs.slice(0, 3).join('; ')}` : '',
        ].filter(Boolean).join('\n'),
      };
    },
  });

  const sessionListTool = defineTool({
    name: 'session_list',
    description: '会话(读): 列出全部活跃会话(范围/peer/群名/活跃时间), 用于跨会话寻址。**默认 peer/sender 只给尾号**(省 token); 需要完整 openid 时传 full=true。',
    parameters: {
      full: { type: 'boolean', description: 'true=给完整 openid; 默认 false(只给尾号, 寻址用群名/备注即可)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      const full = args?.full === true;
      const lines: string[] = [];
      // 遍历全部已注册实例(module 级注册表, 重启后仍可枚举; 不依赖 channelBridges)
      const managers = managersOf();
      if (managers.length === 0) {
        const ch = channelOf(exec as never);
        const manager = ch?.manager;
        if (manager) managers.push(manager);
      }
      if (managers.length === 0) return { ok: false, msg: '找不到会话管理器实例(无已注册实例)' };
      let n = 0;
      for (const manager of managers) {
        const list = manager.listSessions();
        const ns = manager.settingsNs;
        // 群名映射(注册表 {cwd}/.qqbot/groups.json: gid → {name}) —— 让 AI 能用"群名"寻址, 不必抄 openid
        // 群名取自**数据根**注册表({dataRoot}/.qqbot/groups.json, 本机=cwd\dshqqbot\.qqbot) —— 2026-09-12 修正:
        // 以前用 manager.cwd(=**工作目录** <工作目录>) 读, 拿到的是旧位置那份, 群名过时
        // (「群C」显示成「AI（旧备注）」)、新群(群B)整个缺席。
        let reg: Record<string, { name?: string }> = {};
        try {
          reg = JSON.parse(readFileSync(groupRegistryPath(manager.dataRoot), 'utf8')) as Record<string, { name?: string }>;
        } catch { reg = {}; }
        for (const s of list) {
          n++;
          const label = s.scope === 'group' && reg[s.peerId]?.name ? ` "${reg[s.peerId]!.name}"` : '';
          // 2026-09-12 token 瘦身(主人定): **默认只给 peer/sender 尾号** —— 完整 32 位 openid 每行 20+ token,
          // 而寻址用"群名/备注"就够(broadcast_send / target_group 都支持按名解析); 要完整 id 传 full=true。
          const peerShown = full ? s.peerId : '…' + String(s.peerId).slice(-4);
          const senderShown = full ? s.senderId : '…' + String(s.senderId).slice(-4);
          lines.push(`${n}. [${s.scope}]${ns !== 'im-qqbot' ? `(${ns})` : ''} peer=${peerShown}${label} sender=${senderShown} id=${s.sessionId}${s.agentPreset ? ` (${s.agentPreset})` : ''} 活跃=${new Date(s.lastActivity).toLocaleTimeString()}`);
        }
        // 潜在会话: 群注册表里的群可能还没 getOrCreate(无活跃记录), 但 sessionId 可确定性算出
        try {
          const ids = new Set(list.map((s) => s.sessionId));
          for (const gid of Object.keys(reg ?? {})) {
            const sid = manager.sessionIdFor('group', gid);
            if (!ids.has(sid)) lines.push(`[潜在群] ${reg[gid]?.name ?? ''} peer=${gid} id=${sid} 活跃=未创建`);
          }
        } catch { /* 注册表异常则跳过 */ }
      }
      if (lines.length === 0) return { ok: true, msg: '当前无活跃会话, 也无已注册群' };
      return { ok: true, msg: `会话 ${lines.length} 个:\n${lines.join('\n')}` };
    },
  });

  /**
   * 群发目标解析(2026-09-12): 完整 openid 直接用; 否则按**群名/备注**模糊匹配
   * (注册表 {cwd}/.qqbot/groups.json + 各实例活跃会话)。命中 0 个或多个 → 只回候选清单,
   * **绝不猜着发**(这是"默认不 dry-run"还能安全的原因)。
   */
  function resolveBroadcastTargets(rawTargets: string[], root: string): { targets: broadcastQueue.BroadcastTarget[]; error?: string } {
    const isOpenid = (s: string): boolean => /^[A-Za-z0-9_-]{20,40}$/.test(s);
    // 合并多份 groups.json：同一目标**按 lastAt 最新者胜**。
    // ⚠️ 2026-09-12 实测踩到：旧位置的注册表(`{cwd}/.qqbot/groups.json`)还在、名字是过时的 ——
    // 同一个群在旧文件里叫「AI（旧备注）」，在 dataRoot 那份里才叫「群C」；
    // 而「群B」只存在于 dataRoot 那份里，只读旧文件就完全查不到。
    const known = new Map<string, { scope: 'group' | 'c2c'; peerId: string; name: string; lastAt: number }>();
    const add = (scope: 'group' | 'c2c', peerId: string, name: string, lastAt = 0): void => {
      const k = `${scope}:${peerId}`;
      const cur = known.get(k);
      if (!cur) { known.set(k, { scope, peerId, name, lastAt }); return; }
      if (lastAt > cur.lastAt) { cur.lastAt = lastAt; if (name) cur.name = name; return; }
      if (!cur.name && name) cur.name = name;
    };
    const readReg = (dir: string): void => {
      try {
        const reg = JSON.parse(readFileSync(groupRegistryPath(dir), 'utf8')) as Record<string, { name?: string; lastAt?: number }>;
        for (const [gid, v] of Object.entries(reg ?? {})) add('group', gid, String(v?.name ?? ''), Number(v?.lastAt ?? 0));
      } catch { /* 该目录没有注册表则跳过 */ }
    };
    const managers = managersOf();
    const dirs = new Set<string>();
    // 只认**数据根**：manager.dataRoot = dataRootOf(config) = config.dataRoot(=cwd\dshqqbot) ——
    // 数据目录早就定好了, 不该再去 cwd 捞旧注册表(2026-09-12 主人指正: 就是 cwd\dshqqbot, 别绕)。
    for (const m of managers) dirs.add(m.dataRoot);
    dirs.add(root);
    for (const d of dirs) readReg(d);
    // 🗂 自定义分组(dock「📇 群组管理 → 🗂 分组」; 2026-09-12 起由浏览器搬到 host) → **与主人共用同一份**:
    // 主人在面板上点几下分的组, AI 直接写分组名就能群发。结构: [{ id, name, members:['group:xxx'|'c2c:yyy'] }]
    const targetGroups = new Map<string, string[]>();
    for (const d of dirs) {
      try {
        const o = JSON.parse(readFileSync(join(d, '.qqbot', 'target-groups.json'), 'utf8')) as { groups?: Array<{ name?: string; members?: string[] }> };
        for (const g of (Array.isArray(o?.groups) ? o.groups : [])) {
          if (g?.name && Array.isArray(g.members) && g.members.length > 0) targetGroups.set(String(g.name), g.members.map(String));
        }
      } catch { /* 该数据根没有分组文件则跳过 */ }
    }
    for (const m of managers) {
      try {
        for (const s of m.listSessions()) add(s.scope as 'group' | 'c2c', s.peerId, '');
      } catch { /* ignore */ }
    }
    const all = [...known.values()];

    const targets: broadcastQueue.BroadcastTarget[] = [];
    for (const raw of rawTargets) {
      // ① 分组名(优先于群名): "群友" 或 "分组:群友" → 展开成组内全部目标(与 dock 同一份分组数据)
      const gname = raw.replace(/^分组[:：]\s*/u, '');
      const members = targetGroups.get(raw) ?? targetGroups.get(gname);
      if (members) {
        for (const m of members) {
          const mm = /^(group|c2c):(.+)$/i.exec(m);
          if (!mm) continue;
          const scope = mm[1]!.toLowerCase() === 'c2c' ? ('c2c' as const) : ('group' as const);
          const peerId = mm[2]!.trim();
          const hit = all.find((x) => x.scope === scope && x.peerId === peerId);
          targets.push({ scope, peerId, ...(hit?.name ? { name: hit.name } : {}) });
        }
        continue;
      }
      const prefixed = /^(group|c2c):(.+)$/i.exec(raw);
      if (prefixed) {
        const scope = prefixed[1]!.toLowerCase() === 'c2c' ? ('c2c' as const) : ('group' as const);
        const peerId = prefixed[2]!.trim();
        const hit = all.find((x) => x.scope === scope && x.peerId === peerId);
        targets.push({ scope, peerId, ...(hit?.name ? { name: hit.name } : {}) });
        continue;
      }
      if (isOpenid(raw)) {
        const hit = all.find((x) => x.peerId === raw);
        targets.push({ scope: hit?.scope ?? 'group', peerId: raw, ...(hit?.name ? { name: hit.name } : {}) });
        continue;
      }
      const kw = raw.toLowerCase();
      const hits = [...new Map(all.filter((x) => x.name && x.name.toLowerCase().includes(kw)).map((h) => [h.peerId, h])).values()];
      if (hits.length === 1) {
        const h = hits[0]!;
        targets.push({ scope: h.scope, peerId: h.peerId, ...(h.name ? { name: h.name } : {}) });
      } else if (hits.length === 0) {
        const list = all.filter((x) => x.name).map((x) => `· ${x.name} — ${x.peerId}`).join('\n');
        return { targets: [], error: `没找到叫「${raw}」的群/私聊。已知目标:\n${list || '(暂无带备注的目标, 请用完整 openid)'}\n\n请用上面的名字或完整 openid 再调一次。` };
      } else {
        const list = hits.map((x) => `· ${x.name} — ${x.peerId}`).join('\n');
        return { targets: [], error: `「${raw}」匹配到多个目标, 请指定一个:\n${list}` };
      }
    }
    return { targets: [...new Map(targets.map((t) => [`${t.scope}:${t.peerId}`, t])).values()] };
  }

  /** 群发任务 → 人话摘要(逐目标状态 + message_id + 失败原因 + 撤回提示) */
  function fmtBroadcastTask(t: broadcastQueue.BroadcastTask | undefined, fallbackId?: string): string {
    if (!t) return `任务不存在(可能已被清理); task_id=${fallbackId ?? '(未给)'}`;
    // 2026-09-12 token 瘦身: 逐目标明细最多列 5 个(超出只报数量), 免得一次群发 20 个目标把结果灌爆上下文
    const shownTargets = t.targets.slice(0, 5);
    const rows = shownTargets.map((tg) => {
      const r = t.results[tg.peerId];
      const who = tg.name ? `${tg.name}(${tg.peerId})` : tg.peerId;
      if (!r) return `· ${who} ⏳ 待发`;
      if (r.ok) return `· ${who} ✅ message_id=${r.message_id ?? '(无)'}`;
      return `· ${who} ❌ ${r.err ?? '失败'}(已重试 ${t.retries[tg.peerId] ?? 0} 次)`;
    });
    if (t.targets.length > shownTargets.length) rows.push(`…还有 ${t.targets.length - shownTargets.length} 个目标(省略)`);
    const okN = t.targets.filter((tg) => t.results[tg.peerId]?.ok).length;
    const done = t.state === 'done' || t.state === 'partial_failed' || t.state === 'cancelled';
    const head = done
      ? `群发${t.state === 'done' ? '完成' : t.state === 'cancelled' ? '已取消' : '部分失败'}: ${okN}/${t.targets.length} 成功 task_id=${t.task_id}`
      : `群发进行中(${t.state}): ${okN}/${t.targets.length} 已成功 task_id=${t.task_id} —— 后台队列会继续推进, 稍后用 action="status" 查`;
    return [
      head,
      ...rows,
      okN > 0 ? `（2 分钟内可撤回：action="recall", task_id="${t.task_id}", targets=[要撤的目标]）` : '',
    ].filter(Boolean).join('\n');
  }

  /**
   * 群发工具(2026-09-12 主人要求): 把插件现成的**广播队列**(features/broadcast.ts)接给 agent。
   * 设计(主人定): **默认直接发**, 不做 dry-run 预览 —— 主人当场指挥、自己就是发起人, 多一轮确认纯属烧 token;
   *   只有"按群名解析"命中 0 个/多个候选时才回一轮(那是必要信息, 不猜着发);
   *   护栏 = 工具描述写死"仅主人明确要求时调用" + **2 分钟撤回窗口**(返回 task_id 与 message_id)。
   * 白拿的队列能力: 串行逐目标、失败指数退避重试 3 次、任务落盘 {dataRoot}/.qqbot/broadcast-tasks.json、与 dock 面板同一份任务。
   * ⚠️ 不支持文件/图片群发(QQ 上传接口按群隔离 + 占主动消息配额), 资源请在正文放链接。
   */
  const broadcastSendTool = defineTool({
    name: 'broadcast_send',
    description:
      '群发(写,高影响,**仅主人明确要求时调用**): 同一段内容一次发到多个 QQ 群/私聊, 走插件广播队列(串行+失败重试, 与 dock「📤 群发 · 广播」同一份任务, 2 分钟内可逐目标撤回)。targets 写**分组名/群名或备注**或完整 openid; 名字有歧义时只列候选让你确认, 不猜着发。默认直接发送(dry_run=true 才预览)。不支持发文件/图片 —— 资源把链接写进正文。' +
      '\n最小示例(照抄改值):\n' +
      '· 发分组 {targets:["群友"], text:"早上好呀各位～"}\n' +
      '· 发指定群 {targets:["群A","群B"], text:"公告:…"}\n' +
      '· 撤回/查进度 {action:"recall", task_id:"bc-xxx", targets:["群友"]} / {action:"status", task_id:"bc-xxx"}',
    parameters: {
      targets: { type: 'array', items: { type: 'string' }, required: true, description: '目标: 分组名(如"群友") / 群名或群备注(模糊匹配) / 完整 openid(32位) / "group:xxx" / "c2c:xxx"' },
      text: { type: 'string', description: '群发内容(text ≤2000 字 / markdown ≤8000 字); 链接直接写在里面' },
      type: { type: 'string', enum: ['text', 'markdown'], description: '默认 text(纯文本最稳); markdown 需模板权限(已开通)' },
      dry_run: { type: 'boolean', description: 'true=只预览"发给谁+内容"; 默认 false 直接发' },
      action: { type: 'string', enum: ['send', 'recall', 'status'], description: '默认 send; recall=撤回(需 task_id+targets, 2 分钟内); status=查进度' },
      task_id: { type: 'string', description: 'recall/status 用的任务 id(从发送结果里拿)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      const a = args as { targets?: unknown; text?: unknown; type?: unknown; dry_run?: unknown; action?: unknown; task_id?: unknown };
      const ga = groupAdminOf(exec as never);
      const ch = channelOf(exec as never);
      // ⚠️ 数据根 ≠ 工作目录: manager.dataRoot = dataRootOf(config)(本机=<cwd>\AI\dshqqbot),
      // 而 manager.cwd = config.cwd(本机=<cwd>\AI)。2026-09-12 主人实测发现我一开始写成了 cwd,
      // 结果广播任务落到 AI\.qqbot\(旧位置), dock 在 dshqqbot\.qqbot\ 里根本看不到。
      const root = ch?.manager?.dataRoot ?? managersOf()[0]?.dataRoot ?? managersOf()[0]?.cwd;
      if (!root) return { ok: false, msg: '找不到数据根(无已注册实例)' };
      if (!ga) return { ok: false, msg: '群管理未开启(设置页→QQ群管理): 群发要走官方接口, 需要机器人凭据' };
      const action = String(a.action ?? 'send');
      const rawTargets = Array.isArray(a.targets) ? (a.targets as unknown[]).map((t) => String(t).trim()).filter(Boolean) : [];
      if (rawTargets.length === 0) return { ok: false, msg: 'targets 至少给一个(群名或 openid)' };

      if (action === 'status') {
        const t = a.task_id ? broadcastQueue.getTask(root, String(a.task_id)) : undefined;
        if (!t) return { ok: false, msg: '没找到该任务(或没传 task_id)' };
        return { ok: true, msg: fmtBroadcastTask(t) };
      }

      const resolved = resolveBroadcastTargets(rawTargets, root);
      if (resolved.error) return { ok: false, msg: resolved.error };

      if (action === 'recall') {
        const taskId = String(a.task_id ?? '');
        if (!taskId) return { ok: false, msg: 'recall 需要 task_id(从发送结果里拿)' };
        const out: string[] = [];
        for (const tg of resolved.targets) {
          const r = await broadcastQueue.recallTaskMessage(root, taskId, tg.peerId, ga.client);
          out.push(`${r.ok ? '✅ 已撤回' : '❌ 撤回失败'} ${tg.name ?? ''}(${tg.peerId})${r.err ? ' — ' + r.err : ''}`);
        }
        return { ok: true, msg: out.join('\n') };
      }

      // ── send ──
      const text = String(a.text ?? '');
      const type: 'text' | 'markdown' = a.type === 'markdown' ? 'markdown' : 'text';
      const limit = type === 'markdown' ? 8000 : 2000;
      if (!text.trim()) return { ok: false, msg: 'text 必填(要群发的内容)' };
      if (text.length > limit) return { ok: false, msg: `内容过长: ${text.length} 字(${type} 上限 ${limit} 字)` };
      if (resolved.targets.length > 20) return { ok: false, msg: `目标太多(${resolved.targets.length} 个), 单次最多 20 个` };

      if (a.dry_run === true) {
        return {
          ok: true,
          msg: `【dry-run, 未发送】将发到 ${resolved.targets.length} 个目标:\n` +
            resolved.targets.slice(0, 5).map((t) => `· ${t.name ?? '(无备注)'}`).join('\n') +
            (resolved.targets.length > 5 ? `\n…还有 ${resolved.targets.length - 5} 个(省略)` : '') +
            `\n\n内容(${type}, ${text.length} 字):\n${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`,
        };
      }

      const task = broadcastQueue.createTask(root, { type, content: text, targets: resolved.targets, created_by: 'agent' });
      broadcastQueue.confirmTask(root, task.task_id);
      // 同步推进: 每次一个目标, 最多等 ~20 秒; 目标多/网络慢时交给 host 的定时器继续, 用 action=status 查。
      // 目标之间隔 1.5s —— 群发是**主动消息**, 官方频控 Bot 维度 60/qpm(认证)/30/qpm(未认证),
      // 留余量给被动回复与别的推送(原来无间隔, 目标一多会瞬时打满额度)。
      const STEP_MS = 1500;
      const deadline = Date.now() + 20_000;
      let cur = broadcastQueue.getTask(root, task.task_id);
      while (cur && (cur.state === 'queued' || cur.state === 'sending') && Date.now() < deadline) {
        cur = await broadcastQueue.advanceTask(root, task.task_id, ga.client);
        if (cur && (cur.state === 'queued' || cur.state === 'sending') && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, STEP_MS));
        }
      }
      return { ok: true, msg: fmtBroadcastTask(cur, task.task_id) };
    },
  });

  /**
   * 目标分组管理(2026-09-12 主人要求"AI 也要能编辑分组"):
   * 读写的就是 dock「📇 群组管理 → 🗂 分组」那份 host 数据({dataRoot}/.qqbot/target-groups.json),
   * 所以 AI 建/改的分组主人刷新面板就能看到; 反过来主人分的组, AI 直接拿来群发(targets 写分组名)。
   */
  const targetGroupTool = defineTool({
    name: 'target_group',
    description:
      '目标分组管理(与 dock「📇 群组管理 → 🗂 分组」共用同一份数据, 改完主人刷新面板就能看到): 查看/新建/改名/删除分组, 或把目标加进/移出分组。建好后 broadcast_send 的 targets 直接写**分组名**即可群发。改动类动作仅主人明确要求时调用; 重名/找不到会明确报错。' +
      '\n最小示例: {action:"list"} · {action:"create", name:"开发群"} · {action:"add", name:"群友", targets:["群A"]} · {action:"remove", name:"群友", targets:["群B"]}',
    parameters: {
      action: { type: 'string', enum: ['list', 'create', 'rename', 'delete', 'add', 'remove'], required: true, description: 'list=查看全部分组 / create=新建 / rename=改名 / delete=删除 / add=把 targets 加进分组 / remove=把 targets 移出分组' },
      name: { type: 'string', description: '分组名(除 list 外必填)' },
      new_name: { type: 'string', description: 'rename 时的新分组名' },
      targets: { type: 'array', items: { type: 'string' }, description: 'add/remove 的目标(群名/群备注/完整 openid/分组名 均可, 写法同 broadcast_send)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      const a = args as { action?: unknown; name?: unknown; new_name?: unknown; targets?: unknown };
      const ch = channelOf(exec as never);
      const root = ch?.manager?.dataRoot ?? managersOf()[0]?.dataRoot ?? managersOf()[0]?.cwd;
      if (!root) return { ok: false, msg: '找不到数据根(无已注册实例)' };
      const file = join(root, '.qqbot', 'target-groups.json');
      type TG = { id?: string; name?: string; members?: string[] };
      const read = (): TG[] => {
        try {
          const o = JSON.parse(readFileSync(file, 'utf8')) as { groups?: TG[] };
          return Array.isArray(o?.groups) ? o.groups : [];
        } catch { return []; }
      };
      const save = (groups: TG[]): void => {
        try {
          mkdirSync(join(root, '.qqbot'), { recursive: true });
          writeFileSync(file, JSON.stringify({ groups }, null, 1), 'utf8');
        } catch { /* 落盘失败: 内存结果照常返回, 主人可重试 */ }
      };
      const fmt = (g: TG): string => {
        const ms = g.members ?? [];
        const tail = ms.slice(0, 6).map((m) => '…' + String(m).replace(/^[a-z]+:/i, '').slice(-4)).join(', ');
        return `· ${g.name}(${ms.length})${ms.length ? ' — ' + tail + (ms.length > 6 ? ' …' : '') : ''}`;
      };

      const action = String(a.action ?? 'list');
      const name = String(a.name ?? '').trim();
      let groups = read();

      if (action === 'list') {
        if (groups.length === 0) return { ok: true, msg: '当前没有任何分组(dock「📇 群组管理 → 🗂 分组」可新建, 也可以让我建)' };
        return { ok: true, msg: `分组 ${groups.length} 个:\n${groups.map(fmt).join('\n')}` };
      }
      if (name === '') return { ok: false, msg: `${action} 需要 name(分组名)` };
      const idx = groups.findIndex((g) => String(g.name ?? '') === name);

      if (action === 'create') {
        if (idx >= 0) return { ok: false, msg: `分组「${name}」已经存在了` };
        groups.push({ id: 'tg-' + Date.now().toString(36), name, members: [] });
        save(groups);
        return { ok: true, msg: `✅ 已新建分组「${name}」(空组) —— 可以用 action=add 加目标, 或让主人在面板勾选加入` };
      }
      if (idx < 0) return { ok: false, msg: `找不到分组「${name}」。现有: ${groups.map((g) => g.name).join('、') || '(无)'}` };

      if (action === 'rename') {
        const nn = String(a.new_name ?? '').trim();
        if (nn === '') return { ok: false, msg: 'rename 需要 new_name' };
        if (groups.some((g) => String(g.name ?? '') === nn)) return { ok: false, msg: `已经有个分组叫「${nn}」了` };
        groups[idx]!.name = nn;
        save(groups);
        return { ok: true, msg: `✅ 分组「${name}」已改名为「${nn}」` };
      }
      if (action === 'delete') {
        const n = (groups[idx]!.members ?? []).length;
        groups = groups.filter((_, i) => i !== idx);
        save(groups);
        return { ok: true, msg: `✅ 已删除分组「${name}」(${n} 个成员; 只是取消分组, 不影响这些群/人本身)` };
      }
      if (action === 'add' || action === 'remove') {
        const rawTargets = Array.isArray(a.targets) ? (a.targets as unknown[]).map((t) => String(t).trim()).filter(Boolean) : [];
        if (rawTargets.length === 0) return { ok: false, msg: `${action} 需要 targets(至少一个)` };
        const resolved = resolveBroadcastTargets(rawTargets, root);
        if (resolved.error) return { ok: false, msg: resolved.error };
        const cur = new Set(groups[idx]!.members ?? []);
        const before = cur.size;
        for (const t of resolved.targets) {
          const k = `${t.scope}:${t.peerId}`;
          if (action === 'add') cur.add(k);
          else cur.delete(k);
        }
        groups[idx]!.members = [...cur];
        save(groups);
        const delta = action === 'add' ? cur.size - before : before - cur.size;
        return {
          ok: true,
          msg: `✅ 分组「${name}」${action === 'add' ? '加入' : '移出'} ${delta} 个目标, 现共 ${cur.size} 个${delta < resolved.targets.length ? '(重复的已跳过)' : ''}\n${resolved.targets.slice(0, 5).map((t) => '· ' + (t.name || t.peerId)).join('\n')}${resolved.targets.length > 5 ? `\n…还有 ${resolved.targets.length - 5} 个(省略)` : ''}`,
        };
      }
      return { ok: false, msg: `未知 action: ${action}` };
    },
  });

  /** 发到目标 QQ 群/私聊: 若给了 media 先发图(用目标 manager 归属的 sender), 再发带来源文本; 无 sender 则 groupAdmin 文本兜底 */
  async function sendQQWithMedia(
    manager: SessionManager,
    scope: 'group' | 'c2c',
    peer: string,
    body: string,
    media: string,
    exec: unknown,
  ): Promise<string> {
    const ch = channelBridges.find((b) => b.manager === manager);
    const sent: string[] = [];
    if (media) {
      if (ch?.sender) {
        try {
          const src = /^https?:\/\//i.test(media) ? { url: media } : { localPath: media };
          await ch.sender.sendMedia({ scope, targetId: peer }, 'image', src);
          sent.push('🖼️图');
        } catch {
          sent.push('⚠️发图失败');
        }
      } else {
        sent.push('⚠️无发送通道');
      }
    }
    const ga = groupAdminOf(exec as never);
    if (ga) {
      if (scope === 'c2c') {
        // c2c 主动推送必须走官方 is_wakeup 召回通道(30天窗), 自建 REST sendC2cText 无 is_wakeup
        // → 被动回复窗口外不投递(web LLM 已唤醒但 QQ 收不到, 2026-09-10 主人实测 bug)。
        // 优先 ch.sender.sendC2cWakeup(SDK sendWakeup); 无 sender 才退自建 REST。
        if (ch?.sender && typeof ch.sender.sendC2cWakeup === 'function') {
          try {
            await ch.sender.sendC2cWakeup({ scope, targetId: peer }, body);
            sent.push('📨已发到QQ 私聊');
          } catch (err) {
            sent.push(`⚠️QQ私聊发送失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          const sr = await ga.client.sendC2cText(peer, body);
          sent.push(sr.ok ? '📨已发到QQ 私聊(降级)' : `⚠️QQ发送失败: ${sr.err.human}`);
        }
      } else {
        const sr = await ga.client.sendGroupText(peer, body);
        sent.push(sr.ok ? '📨已发到QQ 群' : `⚠️QQ发送失败: ${sr.err.human}`);
      }
    } else {
      sent.push('⚠️群管理未开启');
    }
    return `；${sent.join(' ')}`;
  }

  const sessionWakeTool = defineTool({
    name: 'session_wake',
    description:
      '跨会话(写,谨慎,**仅主人明确要求时调用**): 向指定会话发一条消息。mode=wake(默认)唤醒对方 LLM; mode=append 只写上下文不唤醒(省 token 的喇叭模式)。同时经 QQ 通道把消息发到该会话绑定的群/私聊。目标用 session_id(见 session_list) 或 peer_id+scope。' +
      '\n最小示例(照抄改值):\n' +
      '· 唤醒单发 {session_id:"<uuid>", text:"帮我看下这个"}\n' +
      '· 跨群喇叭不唤醒 {peer_id:"<群openid>", scope:"group", text:"公告:…", mode:"append"}\n' +
      '· 批量(每项自带 text) {batch:[{peer_id:"<g1>",scope:"group",text:"A"},{peer_id:"<g2>",scope:"group",text:"B",media:"D:/pic.png"}]} ← 用 batch 时**不要再传顶层 text**',
    parameters: {
      session_id: { type: 'string', description: '目标会话 id(完整 sessionId, 来自 session_list)' },
      peer_id: { type: 'string', description: '或按 peer 寻址: 群 openid/私聊 openid(需带 scope)' },
      scope: { type: 'string', enum: ['group', 'c2c'], description: 'peer_id 寻址时的范围(group=群 / c2c=私聊)' },
      text: { type: 'string', description: '要发送的消息内容(单发必填; 用 batch 时**不要**传这个, 每项自带 text)' },
      mode: { type: 'string', enum: ['wake', 'append'], description: 'wake=唤醒 LLM 开回合(默认); append=只追加上下文不唤醒(省 token, 喇叭模式)' },
      send_qq: { type: 'boolean', description: '是否同时发到绑定的 QQ 群/私聊(给人看, 默认 true)。false=只处理 LLM 侧不走 QQ 通道' },
      media: { type: 'string', description: '跨群发图: 图片本地路径或 http(s) URL, 随消息发到目标群(需 send_qq=true)' },
      batch: { type: 'array', description: '批量模式(2026-09-10): 一次向多个会话各发不同文本。每项: {session_id 或 peer_id+scope, text, mode?, send_qq?, media?}。单发参数与 batch 二选一, batch 优先。', items: {
        type: 'object', additionalProperties: false, properties: {
          session_id: { type: 'string', description: '目标会话 id' },
          peer_id: { type: 'string', description: '或 peer 寻址: 群/私聊 openid' },
          scope: { type: 'string', enum: ['group', 'c2c'], description: 'peer 寻址范围' },
          text: { type: 'string', required: true, description: '该会话要发的消息内容' },
          mode: { type: 'string', enum: ['wake', 'append'], description: '默认 wake' },
          send_qq: { type: 'boolean', description: '默认 true' },
          media: { type: 'string', description: '该会话随消息发的图片' },
        },
      } },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      // 来源标注(便于对方直接会话): 优先当前执行 agent 的 id(=会话 id); 再取当前会话记录;
      // 再回退 groupAdmin 的 hub 会话; 最后 'web'
      const from = (() => {
        try {
          const aid = (exec.agent as { id?: unknown } | undefined)?.id;
          if (typeof aid === 'string' && aid.length >= 8) return aid.slice(0, 8) + '…';
          const ch0 = channelOf(exec as never);
          const src = findSessionRec(ch0, exec as never);
          if (src?.rec?.sessionId) return src.rec.sessionId.slice(0, 8) + '…';
        } catch { /* 忽略 */ }
        return 'web';
      })();
      const map: Record<string, string> = {
        ok: '✅ 已发送并唤醒',
        'no-session': `❌ 会话不存在: 目标会话不在任何已注册实例中(或已重建/换绑)`,
        'no-followup': '❌ 该会话 agent 不支持 followup 唤醒',
        'no-append': '❌ 该会话 agent 不支持上下文追加',
        'no-agent': '❌ 找不到目标会话 agent',
        busy: '⏳ 目标会话正忙(回合进行中且无安全注入通道)',
        fail: '❌ 处理异常',
      };
      /** 单条发送(单发与 batch 共用): one={session_id?|peer_id?+scope?, text, mode?, send_qq?, media?} */
      const sendOne = async (one: Record<string, unknown>): Promise<string> => {
        const text = String(one.text || '');
        if (!text) return '❌ 缺少 text —— 单发请传顶层 text; 用 batch 时**每项自带 text**(顶层 text 不必传, 传了也不算错)。最小示例见本工具描述';
        const body = `【来自会话 ${from}】\n${text}${one.media ? `\n[附带图片: ${one.media}]` : ''}`;
        const sid = String(one.session_id || '');
        if (sid) {
          // ① session_id 寻址: module 级注册表跨全部实例精确命中(重启后仍可查)
          const manager = findManagerBySessionId(sid);
          if (!manager) return `❌ 会话不存在: ${sid.slice(0, 8)}…(不在任何已注册实例)`;
          const mode = String(one.mode || 'wake');
          let r: string;
          if (mode === 'append') {
            const rec0 = manager.findBySessionId(sid);
            const targetAgent = rec0?.agent
              ?? manager.findHostAgent(sid)?.agent
              ?? (await manager.resumeHostAgent(sid).catch(() => undefined))?.agent;
            if (!targetAgent) r = 'no-session';
            else r = await safeAppendUserMessage(targetAgent, body, loggerLike(exec as never));
          } else {
            r = await wakeSessionAgent(manager, sid, loggerLike(exec as never), body);
          }
          let extra = '';
          if (one.send_qq !== false) {
            // 目标 peer: ⚠️ 不能只问 findManagerBySessionId 返回的 manager——它可能经 findHostAgent 命中
            // 错误实例(宿主 registry 全局), 导致 rec=undefined → 静默不发(2026-09-10 04:35 实测)。
            let qScope: 'group' | 'c2c' | undefined;
            let qPeer = '';
            let ownerManager: SessionManager | undefined;
            for (const m of managersOf()) {
              try {
                const r2 = m.findBySessionId(sid);
                if (r2) { ownerManager = m; qScope = r2.scope; qPeer = r2.peerId; break; }
              } catch { /* 单实例异常跳过 */ }
            }
            if (!ownerManager) {
              for (const m of managersOf()) {
                try {
                  const raw = readFileSync(groupRegistryPath(m.cwd), 'utf8');
                  const reg = JSON.parse(raw) as Record<string, unknown>;
                  for (const gid of Object.keys(reg ?? {})) {
                    if (m.sessionIdFor('group', gid) === sid) { ownerManager = m; qScope = 'group'; qPeer = gid; break; }
                  }
                  if (ownerManager) break;
                } catch { /* 无注册表则跳过 */ }
              }
            }
            if (ownerManager && qScope && qPeer) {
              extra = await sendQQWithMedia(ownerManager, qScope, qPeer, body, String(one.media || ''), exec as never);
            } else {
              const diag = `未找到目标会话的 QQ peer(findBySessionId 与群注册表均 miss, sid=${sid.slice(0, 8)}…)`;
              try { loggerLike(exec as never).warn(`[session_wake] ${diag}`); } catch { /* */ }
              extra = `；⚠️${diag}`;
            }
          }
          return `${map[r] ?? r} (${sid.slice(0, 8)}…)${extra}`;
        }
        // ② peer 寻址
        const peer = String(one.peer_id || '');
        const sc = String(one.scope || '') as 'group' | 'c2c';
        if (!peer || !sc) return '请给 session_id, 或 scope+peer_id';
        let manager = findManagerByPeer(sc, peer);
        if (!manager) {
          const curCh = channelOf(exec as never);
          if (curCh?.manager && curCh.manager.findByPeer(sc, peer)) manager = curCh.manager;
          else if (curCh?.manager) manager = curCh.manager;
        }
        if (!manager) return '找不到会话管理器实例(无已注册实例)';
        let rec = manager.findByPeer(sc, peer);
        if (!rec) {
          if (sc === 'c2c') {
            return `❌ 未找到该私聊对象的真实会话(${peer.slice(0, 8)}…): 请先让对方主动私聊本 bot 一次(dock「💬聊天」里能直接发), 或用 session_id 寻址。原因: openid 按 bot 应用隔离, 乱建会话会发到错误实例`;
          }
          rec = await manager.getOrCreate(sc, peer, 'master', { scope: sc, targetId: peer });
          if (!rec) return `会话创建失败: ${sc} ${peer.slice(0, 8)}…`;
        }
        const sid2 = rec.sessionId;
        const mode2 = String(one.mode || 'wake');
        let r: string;
        if (mode2 === 'append') {
          r = rec.agent
            ? await safeAppendUserMessage(rec.agent, body, loggerLike(exec as never))
            : 'no-session';
        } else {
          r = await wakeSessionAgent(manager, sid2, loggerLike(exec as never), body);
        }
        let extra = '';
        if (one.send_qq !== false) {
          extra = await sendQQWithMedia(manager, sc, peer, body, String(one.media || ''), exec as never);
        }
        return `${map[r] ?? r} (${sid2.slice(0, 8)}…)${extra}`;
      };
      // batch 优先(2026-09-10 主人: 多参数=一次多个会话各发不同文本)
      if (Array.isArray(args.batch) && args.batch.length > 0) {
        const results: string[] = [];
        for (const item of args.batch) {
          if (!item || typeof item !== 'object') { results.push('❌ batch 项无效'); continue; }
          try { results.push(await sendOne(item as Record<string, unknown>)); } catch (e) { results.push(`❌ 发送异常: ${String((e as Error)?.message || e)}`); }
        }
        return { ok: results.every((x) => x.startsWith('✅')), msg: `批量 ${results.length} 条:\n` + results.map((x, i) => `${i + 1}. ${x}`).join('\n') };
      }
      const oneR = await sendOne(args as Record<string, unknown>);
      return { ok: oneR.startsWith('✅'), msg: oneR };
    },
  });

  const muteStateTool = defineTool({
    name: 'group_mute_state',
    description: '群管理(读): 查看当前群禁言状态(全员模式 + 正在禁言中的成员及到期时间)。仅主人要求时调用。',
    parameters: {
      gid: { type: 'string', description: '目标群 openid(可选; 不填=当前会话群/manageGroup)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      const ga = groupAdminOf(exec);
      if (!ga) return { ok: false, msg: '群管理未开启或非群会话' };
      const gid = String(args.gid ?? '').trim() || ga.gid || '';
      if (!gid) return { ok: false, msg: '当前不是群会话且未指定 gid, 无法确定目标群' };
      const r = await ga.client.getMuteState(gid);
      if (!r.ok) return { ok: false, msg: r.err.human };
      const mode = r.data.global_rule?.mode ?? 'none';
      const members = r.data.members ?? [];
      const lines = members.map((m) => `${m.username ?? String(m.member_openid).slice(0, 10)}… 禁言至 ${m.mute_expire_at ?? '?'}`);
      return { ok: true, msg: `全员禁言: ${mode === 'always' ? '开启' : mode === 'schedule' ? '定时' : '关闭'}\n禁言中 ${members.length} 人:\n${lines.length ? lines.join('\n') : '(无)'}` };
    },
  });

  const muteMemberTool = defineTool({
    name: 'group_mute_member',
    description: '群管理(写,危险): 禁言/解除群成员(**可批量, 单次最多 20 人**)。action=mute 禁言(seconds 秒, 默认600); unmute=解除。只能禁普通成员(群主/管理员禁不了)。' +
      '\n想按昵称禁言先用 id_lookup 拿 openid; 仅主人明确要求时调用。' +
      '\n示例: {member_openids:["<openid>"], action:"mute", seconds:600}',
    parameters: {
      gid: { type: 'string', description: '目标群 openid(可选; 不填=当前会话群/manageGroup)' },
      member_openids: { type: 'array', items: { type: 'string' }, required: true, description: '目标成员 openid 数组(只禁 1 个也传数组; ≤20 个; 可先用 id_lookup 按昵称查)' },
      action: { type: 'string', required: true, enum: ['mute', 'unmute'], description: 'mute 禁言 / unmute 解除' },
      seconds: { type: 'number', required: true, description: '禁言秒数(mute 时; 不需要可填 600)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      const ga = groupAdminOf(exec);
      if (!ga) return { ok: false, msg: '群管理未开启或非群会话' };
      const gid = String(args.gid ?? '').trim() || ga.gid || '';
      if (!gid) return { ok: false, msg: '当前不是群会话且未指定 gid, 无法确定目标群' };
      const secs = Math.max(1, Math.min(30 * 86400, Math.round(Number(args.seconds ?? 600))));
      const pad = (n: number): string => String(n).padStart(2, '0');
      const expire = args.action === 'mute' ? new Date(Date.now() + secs * 1000) : null;
      const rfc = expire
        ? `${expire.getFullYear()}-${pad(expire.getMonth() + 1)}-${pad(expire.getDate())}T${pad(expire.getHours())}:${pad(expire.getMinutes())}:${pad(expire.getSeconds())}+08:00`
        : null;
      const all = (Array.isArray(args.member_openids) ? args.member_openids : [])
        .map((v) => String(v).trim()).filter(Boolean)
        .map((v) => (v.startsWith('<@') && v.endsWith('>') ? v.slice(2, -1) : v)) // 容错: 直接贴 <@openid> 也认
        .filter((v, i, arr) => arr.indexOf(v) === i);
      if (all.length === 0) return { ok: false, msg: 'member_openids 至少给一个 openid' };
      const ids = all.slice(0, 20); // 官方单次 ≤20 人
      let okCount = 0; const errs: string[] = [];
      for (const id of ids) {
        const rr = await ga.client.setMemberMute(gid, id, rfc);
        if (rr.ok) okCount++; else errs.push(`…${id.slice(-4)}: ${rr.err.human}`);
        if (ids.length > 1) await new Promise((res) => setTimeout(res, 120)); // 略停, 别撞频控
      }
      if (okCount === 0) return { ok: false, msg: errs[0] ?? '禁言失败' };
      const over = all.length > 20 ? ` (超出 20 人的 ${all.length - 20} 个已忽略, 请分两次)` : '';
      const failNote = errs.length ? ` · 失败 ${errs.length} 人(${errs.slice(0, 3).join('; ')})` : '';
      return {
        ok: true,
        msg: args.action === 'mute'
          ? `✅ 已禁言 ${okCount}/${ids.length} 人, ${Math.round(secs / 60)} 分钟后自动解除${failNote}${over}`
          : `✅ 已解除禁言 ${okCount}/${ids.length} 人${failNote}${over}`,
      };
    },
  });

  /**
   * 昵称/群名 → openid(2026-09-12 主人要求) —— AI 想**主动 @ 一个没 @ 过她的人**、或按名字禁言时,
   * 必须先拿到 openid 才能写出 `<@openid>`。官方「群成员列表」未开放(调用得 11253),
   * 所以数据源是: ①本地群成员台账 `{dataRoot}/表情包/group-members.jsonl`(在群里发过言的人 + 入群申请写入的人)
   * ②群注册表 groups.json(群名 → 群 openid)。
   * ⚠️ 从没发过言、没申请过入群的人查不到 —— 官方不给名单导致的硬限制, 不是 bug。
   */
  const idLookupTool = defineTool({
    name: 'id_lookup',
    description: '按**昵称/群名**查 openid(主动 @ 人、禁言、跨群发消息前用它拿 id)。**支持一次查多个名字**。' +
      '\n数据源: 群注册表(群名) + 本地群成员台账(在群里发过言/申请过入群的人)。' +
      '\n⚠️ 从没发过言、没申请过入群的人查不到(官方群成员列表接口未开放)。' +
      '\n示例: {names:["小云","阿水"]} · {names:["小云"], gid:"<群openid>"} · {names:["测试群"], kind:"group"}',
    parameters: {
      names: { type: 'array', items: { type: 'string' }, required: true, description: '一个或多个昵称/群名片段(最多 10 个; 单个也传数组; 空格分隔=多词全命中)' },
      gid: { type: 'string', description: '限定某个群的成员(可选; 不填=查全部已知群)' },
      kind: { type: 'string', enum: ['member', 'group', 'all'], description: 'member=只查人(默认) / group=只查群 / all=都查' },
      limit: { type: 'number', description: '**每个**名字最多返回几条(1~10, 默认 3)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args) {
      const raw = Array.isArray(args.names) ? args.names : (args.names ?? (args as { name?: unknown }).name);
      const kws = (Array.isArray(raw) ? raw : [raw])
        .map((v) => String(v ?? '').trim().toLowerCase()).filter(Boolean).slice(0, 10);
      if (kws.length === 0) return { ok: false, msg: 'names 至少给一个昵称' };
      const wantGid = String(args.gid ?? '').trim();
      const kind = String(args.kind ?? 'member');
      const limit = Math.max(1, Math.min(10, Math.round(Number(args.limit ?? 3))));
      const roots = new Set<string>();
      for (const m of managersOf()) roots.add(m.dataRoot);
      // 群注册表(gid → 群名/最近活跃): 多个 dataRoot 聚合, lastAt 新者胜
      const groups = new Map<string, { name: string; lastAt: number }>();
      for (const root of roots) {
        try {
          const reg = JSON.parse(readFileSync(groupRegistryPath(root), 'utf8')) as Record<string, { name?: string; lastAt?: number }>;
          for (const [gid, v] of Object.entries(reg ?? {})) {
            const name = String(v?.name ?? '');
            const lastAt = Number(v?.lastAt ?? 0);
            const cur = groups.get(gid);
            if (!cur || lastAt > cur.lastAt) groups.set(gid, { name: name || cur?.name || '', lastAt });
          }
        } catch { /* 该 root 没有注册表 */ }
      }
      // 台账只读一次(按词重复读纯浪费), 按 openid 合并群列表
      const people = new Map<string, { name: string; gids: Set<string>; lastSeen: number; count: number }>();
      if (kind !== 'group') {
        for (const root of roots) {
          try {
            for (const m of readGroupMembers(join(root, '表情包'), wantGid || undefined)) {
              const cur = people.get(m.mid);
              if (!cur) { people.set(m.mid, { name: m.name ?? '', gids: new Set([m.gid]), lastSeen: m.lastSeen, count: m.count }); continue; }
              cur.gids.add(m.gid);
              if (m.lastSeen > cur.lastSeen) { cur.lastSeen = m.lastSeen; if (m.name) cur.name = m.name; }
              cur.count += m.count;
            }
          } catch { /* 无台账则跳过 */ }
        }
      }
      const gName = (gid: string): string => groups.get(gid)?.name || `群…${gid.slice(-4)}`;
      const out: string[] = [];
      for (const kw of kws) {
        let hit = 0;
        if (kind !== 'group') {
          const matched = [...people.entries()]
            .filter(([, v]) => v.name.toLowerCase().includes(kw))
            .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
            .slice(0, limit);
          for (const [mid, v] of matched) {
            out.push(`${v.name} ${mid}  在: ${[...v.gids].map(gName).join(', ')}`);
            hit++;
          }
        }
        if (kind !== 'member') {
          for (const [gid, v] of groups) {
            if (hit >= limit) break;
            if (!v.name.toLowerCase().includes(kw)) continue;
            out.push(`群 ${v.name} ${gid}`);
            hit++;
          }
        }
        if (hit === 0) out.push(`${kw} → 没查到(台账只记发过言 / 申请过入群的人)`);
      }
      return { ok: true, msg: out.join('\n') };
    },
  });
  // tools_reload: 热刷新 QQ 通道工具(2026-09-08, 主人建议)——AI 自己写完扩展工具后,
  // 调本工具即可让新扩展注册进当前会话(等价于 /tools-reload 斜杠), 不再依赖主人手发。
  const toolsReloadTool = defineTool({
    name: 'tools_reload',
    description: '热刷新 QQ 通道工具: 重新扫描并注册扩展目录(.qqbot-extensions/tools)里的用户工具+重载内置工具。写完/更新扩展工具后调用一次, 下条消息即可用新工具(等价于 /tools-reload)。开发/装配用, 平时不需要调。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(_args, exec) {
      const sess = findSessionRec(channelOf(exec as never), exec);
      if (!sess) return { ok: false, msg: '未找到当前 QQ 会话(通道未就绪), 请稍后重试' };
      try {
        const summary = await sess.ch.manager.reloadAllChannelTools();
        return { ok: true, msg: summary };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  // quote_view: 查看引用内容(2026-09-13 主人定, 省 token) ——
  //   引用原文超过 60 字时, 入站上下文只给**前 60 字**, 全文落在
  //   `{dataRoot}/.qqbot/quote-cache.json`(**每会话最多 10 条**), 需要时用本工具取完整原文。
  //   ⚠️ 工具描述**刻意写四个字**(主人要求): 描述进 system prompt, 越短越省。
  const quoteViewTool = defineTool({
    name: 'quote_view',
    description: '查看引用内容',
    parameters: {
      idx: { type: 'integer', description: '引用编号(默认最新一条)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          msg: { type: 'string', required: true },
          text: { type: 'string' },
        },
      },
      render: (_a, v: { ok: boolean; msg: string; text?: string }) => [
        { type: 'text' as const, text: v.ok ? (v.text || '') : `查询失败: ${v.msg}` },
      ],
    },
    async execute(args, exec) {
      try {
        const s = findSessionRec(channelOf(exec as never), exec as never);
        const mgr = s?.ch?.manager as unknown as { dataRoot?: string } | undefined;
        const rec = s?.rec as unknown as { scope?: string; peerId?: string } | undefined;
        const dataRoot = String(mgr?.dataRoot || '');
        if (!dataRoot || !rec?.scope || !rec?.peerId) return { ok: false, msg: '未找到当前 QQ 会话' };
        const rawIdx = (args as { idx?: number }).idx;
        const idx = typeof rawIdx === 'number' && Number.isFinite(rawIdx) ? rawIdx : undefined;
        const e = getQuote(dataRoot, `${rec.scope}:${rec.peerId}`, idx);
        if (!e) return { ok: false, msg: '没有缓存的引用(短引用不缓存; 或这条引用是更早的、已被 10 条上限挤掉)' };
        return { ok: true, msg: `引用#${e.id}`, text: `引用#${e.id}${e.sender ? `（${e.sender}）` : ''}: ${e.text}` };
      } catch (err) {
        return { ok: false, msg: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  // people_memo: 群友小传（2026-09-13 主人定）—— 文字版好感度的本体。
  //   记一行(同一人一天最多一条) / 查看 / 删除（群里一句"别记人家"就删）。描述刻意写短。
  const peopleMemoTool = defineTool({
    name: 'people_memo',
    description: '群友小传: 记一行/查看/删除(只写旁人能复述的事实)',
    parameters: {
      who: { type: 'string', required: true, description: '群友昵称或 openid' },
      line: { type: 'string', description: '要记的一行; 不传=只看' },
      del: { type: 'boolean', description: 'true=删掉这个人的小传' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.msg }],
    },
    async execute(args, exec) {
      try {
        const a = args as { who?: string; line?: string; del?: boolean };
        const s = findSessionRec(channelOf(exec as never), exec as never);
        const mgr = s?.ch?.manager as unknown as { dataRoot?: string } | undefined;
        const rec = s?.rec as unknown as { scope?: string; peerId?: string } | undefined;
        const dataRoot = String(mgr?.dataRoot || '');
        if (!dataRoot) return { ok: false, msg: '未找到当前会话的数据根' };
        // who → openid: 优先在群成员台账里按昵称找
        let key = String(a.who || '').trim();
        if (!/^[0-9A-Fa-f]{16,}$/.test(key) && rec?.scope === 'group' && rec.peerId) {
          try {
            const dataDir = join(dataRoot, '表情包');
            const mems = readGroupMembers(dataDir, rec.peerId) || [];
            const hit = mems.find((m) => m && m.name === key) || mems.find((m) => m && typeof m.name === 'string' && m.name.includes(key));
            if (hit && hit.mid) key = hit.mid;
          } catch { /* 用昵称兜底当 key */ }
        }
        if (a.del) {
          const r = deleteMemo(dataRoot, key);
          return { ok: r.ok, msg: r.ok ? '好, 已经把 ' + a.who + ' 那份小传删掉了, 以后也不记他' : r.msg };
        }
        if (a.line) {
          const r = appendMemoLine(dataRoot, key, a.line, { name: a.who, force: false });
          return { ok: r.ok, msg: r.ok ? '记下了: ' + a.line.slice(0, 60) : r.msg };
        }
        const cur = readMemo(dataRoot, key);
        if (cur) return { ok: true, msg: cur.slice(0, 1200) };
        const all = listMemos(dataRoot);
        return { ok: true, msg: '还没有 ' + a.who + ' 的小传。现有 ' + all.length + ' 份: ' + all.slice(0, 8).map((x) => x.key).join(', ') };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  // 逐个注册并记录结果(便于线上定位是哪个工具失败)
  const toolDefs: Array<{ name: string; tool: unknown }> = [
    { name: 'send_media', tool: sendMediaTool },
    { name: 'recall_message', tool: recallTool },
    { name: 'text_break', tool: textBreakTool },
    { name: 'quote_view', tool: quoteViewTool },
    { name: 'people_memo', tool: peopleMemoTool },
    { name: 'tools_reload', tool: toolsReloadTool },
    { name: 'reply_gate', tool: replyGateTool },
    { name: 'outbound_mode', tool: outboundModeTool },
    { name: 'group_join_requests', tool: listJoinRequestsTool },
    { name: 'group_approve_join', tool: approveJoinTool },
    { name: 'group_join_auto', tool: autoApproveJoinTool },
    { name: 'group_mute_state', tool: muteStateTool },
    { name: 'group_mute_member', tool: muteMemberTool },
    { name: 'id_lookup', tool: idLookupTool },
    { name: 'session_list', tool: sessionListTool },
    { name: 'session_wake', tool: sessionWakeTool },
    { name: 'broadcast_send', tool: broadcastSendTool },
    { name: 'target_group', tool: targetGroupTool },
    { name: 'list_stickers', tool: listStickersTool },
    { name: 'sticker_tag', tool: tagStickerTool },
    { name: 'sticker_delete', tool: deleteStickerTool },
    { name: 'sticker_restore', tool: restoreStickerTool },
    { name: 'sticker_stats', tool: statsStickerTool },
    { name: 'sticker_untagged', tool: untaggedStickerTool },
    { name: 'schedule_timer', tool: scheduleTimerTool },
    { name: 'schedule_cancel', tool: scheduleCancelTool },
  ];
  for (const t of toolDefs) {
    try {
      ctx.tools.register(t.tool as never);
      ctx.logger?.info?.(`[channel-tools] 已注册: ${t.name}`);
      diag(`注册成功: ${t.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 重复注册(already registered)= 幂等全量重跑的正常现象, 静默跳过不刷日志
      if (/already registered/i.test(msg)) {
        diag(`注册幂等跳过(已存在): ${t.name}`);
        continue;
      }
      ctx.logger?.warn?.(`[channel-tools] 注册失败 ${t.name}: ${msg}`);
      diag(`注册失败: ${t.name} → ${msg}`);
    }
  }

  // ── P4.2 用户扩展工具: 扫描 {cwd}/.qqbot-extensions/tools/ 并注册 ──
  // 扩展文件 run(args, env) 可拿: { cwd, manager, sender, replyTarget, logger }
  // (调用方 session-manager 已 await mountChannelTools, 此处 await 加载不影响时序)。
  try {
    const qqCh = (() => {
      try { return (ctx as unknown as { get?: (n: string) => unknown }).get?.('qqChannel') as QQChannel | undefined; } catch { return undefined; }
    })();
    // 扫描根解析: 扩展目录挂在插件数据根(dataRoot=config.dataRoot||cwd), 与工作区其他文件分离。
    //  ①agent ctx qqChannel; ②全局桥(热刷/自愈路径 ctx 可能无 qqChannel); ③ctx.cwd; ④进程 cwd
    const bridgeCh = channelBridges.length ? channelBridges[channelBridges.length - 1] : undefined;
    const extRoot = (qqCh?.manager?.dataRoot as string | undefined)
      || (bridgeCh?.manager?.dataRoot as string | undefined)
      || (qqCh?.manager?.cwd as string | undefined)
      || (bridgeCh?.manager?.cwd as string | undefined)
      || (ctx as { cwd?: string }).cwd
      || process.cwd();
    const workCwd = (qqCh?.manager?.cwd as string | undefined)
      || (bridgeCh?.manager?.cwd as string | undefined)
      || (ctx as { cwd?: string }).cwd
      || process.cwd();
    const defs = await loadExtensionTools(extRoot, (ctx.logger ?? console) as Parameters<typeof loadExtensionTools>[1]);
    extDiag(`apply extRoot=${extRoot} defs=${defs.length} qqCh=${!!qqCh} bridge=${!!bridgeCh}`);
    for (const def of defs) {
      try {
        const tool = defineTool({
          name: def.name,
          description: def.description + ' (用户扩展工具)',
          parameters: def.inputSchema as never,
          output: {
            schema: {
              type: 'object', additionalProperties: false,
              properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
            },
            render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
          },
          async execute(args, exec) {
            const sess = findSessionRec(channelOf(exec as never), exec as never);
            const env: Record<string, unknown> = {
              cwd: workCwd, // 注入给扩展工具的工作目录保持 agent cwd(扫描根已用数据根)
              manager: sess?.ch.manager,
              sender: sess?.ch.sender,
              replyTarget: sess?.rec.replyTarget,
              exec,
            };
            try {
              const r = await def.run(args as Record<string, unknown>, env) as { ok?: boolean; msg?: string } | string | undefined | null;
              if (r && typeof r === 'object') return { ok: r.ok === true, msg: String(r.msg ?? 'done') };
              return { ok: true, msg: r === undefined || r === null ? 'done' : String(r) };
            } catch (err) {
              return { ok: false, msg: err instanceof Error ? err.message : String(err) };
            }
          },
        });
        ctx.tools.register(tool as never);
        ctx.logger?.info?.(`[channel-tools] 已注册扩展工具: ${def.name}`);
        diag(`扩展工具注册成功: ${def.name}`);
        extDiag(`注册成功: ${def.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already registered/i.test(msg)) {
          extDiag(`already registered: ${def.name}`);
          continue;
        }
        ctx.logger?.warn?.(`[channel-tools] 扩展工具注册失败 ${def.name}: ${msg}`);
        diag(`扩展工具注册失败: ${def.name} → ${msg}`);
        extDiag(`注册失败: ${def.name} → ${msg}`);
      }
    }
  } catch (err) {
    ctx.logger?.warn?.(`[channel-tools] 扩展工具加载异常(已忽略): ${err instanceof Error ? err.message : String(err)}`);
    extDiag(`加载异常: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * host 面板用(2026-09-13 主人要的「让ai写」按钮):
 * **照抄定时任务的做法** —— 伪造一条消息直接调 handleInbound 唤醒该群/私聊的 AI 回合
 * (见 features/scheduler.ts fireTask: 与 SDK 消息同形, messageId 空 → 出站自动走主动推送;
 *  senderName 用中性名、不打假 (@you), 防污染主人交互记忆)。
 *
 * 为什么不复用高层轮子: wakeSessionAgent 要先配"群组管理器会话"; injectSynthetic 是塞聚合窗口(要等人停口);
 *  而面板按钮要的是**立刻触发** —— 与"定时任务到点必须触发回合"同理, 直调 handleInbound 最贴合。
 *
 * host 半边(settings-host.js) 通过 import('@zaofan/dsh-qqbot/channel-tools') 调用(manager 只在插件侧)。
 */
export async function askAiToWriteSamples(
  ns: string,
  scope: 'group' | 'c2c',
  peerId: string,
): Promise<{ ok: boolean; msg: string }> {
  try {
    const managers = managersOf();
    if (managers.length === 0) return { ok: false, msg: '还没有活跃的机器人实例' };
    const nsOf = (m: unknown): string => String((m as { settingsNs?: string })?.settingsNs ?? '');
    const mgr = managers.find((m) => nsOf(m) === ns) ?? managers[0];
    if (!mgr) return { ok: false, msg: '找不到该机器人实例' };
    if (!peerId) return { ok: false, msg: '请先在面板上方选一个群/私聊目标' };
    const cfg = (mgr as unknown as { config?: unknown }).config;
    if (!cfg) return { ok: false, msg: '该实例配置未就绪' };
    const root = (mgr as unknown as { dataRoot?: string }).dataRoot || '';
    const prompt = [
      '【样例库维护】主人点了面板上的「让ai写(有聊天记录最好)」, 请你来维护本地小模型的"开口标准"样例库。',
      `· 样例库(你要写的): ${root}\\.qqbot\\value-samples.jsonl —— 一行一条 {"m":"群消息文本","y":1} / y=0; 1=你会想接话, 0=你不会理`,
      `· 评分记录(你来读): ${root}\\.qqbot\\value-scores.jsonl —— 一行一条 JSON, 字段: text=消息原文, score=本地小模型给的分, worth=是否判值得接, min=本会话门槛, gate=当时生效的模式(block=低分不唤醒/log=只记录不拦), conf=置信度(越接近1越有把握), mention=是否被@, top=最近邻样例, agg=聚合条数`,
      '做法: ①读评分记录最近 100~200 条(用文件工具) ②挑出标注可疑的 —— 尤其 conf<0.5(地图上没这类样本)、mention=true 却 worth=false(被点名却没打算回)、内容与分数明显不符的',
      '③对照真人群聊语境, 提炼 20~40 条新样例 ④用文件工具把它们**追加**写入样例库(不要覆盖整库) ⑤回报加了几条、都补了哪类。',
      '样例写法(一行一条 JSON): {"m":"消息文本","y":1或0} —— y=1 她会想接话(提问/求助/@她/她接得住的梗) / y=0 她不会理(群友互聊/短应答/表情)。',
    ].join('\n');
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const fakeMsg = {
      kind: scope,
      senderId: scope === 'c2c' ? peerId : 'master',
      senderName: '样例库维护',
      content: `[面板任务 ${ts}] ${prompt}`,
      messageId: '',
      timestamp: now.toISOString(),
      groupOpenid: scope === 'group' ? peerId : undefined,
      msgType: 0,
      attachments: undefined,
    };
    const noop = (): void => {};
    const logger = { info: noop, warn: noop, debug: noop, error: noop } as unknown as Parameters<typeof handleInbound>[3];
    await handleInbound(fakeMsg, mgr, cfg as Parameters<typeof handleInbound>[2], logger, undefined);
    return { ok: true, msg: `已伪造一条消息唤醒 ${scope === 'group' ? '群' : '私聊'} …${peerId.slice(-6)} 的 AI 回合, 稍等她回复 ✧` };
  } catch (e) {
    return { ok: false, msg: `异常: ${e instanceof Error ? e.message : String(e)}` };
  }
}
