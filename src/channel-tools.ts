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
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import type { SessionManager } from './session/session-manager.js';
import type { QQBotSender } from './transport/outbound-buffer.js';
import { getStickerStore } from './features/sticker-store.js';
import { autoTagImage } from './features/sticker-tagger.js';
import { isStickerGateDenied } from './features/sticker-gate.js';
import { getScheduleStore } from './features/schedule-store.js';
import { switchOutboundMode } from './features/outbound-mode-switch.js';
import { loadExtensionTools } from './features/extension-store.js';
import { verifyHuman, groupRegistryPath } from './api/group-admin.js';
import { wakeSessionAgent } from './features/group-hub.js';
import { managersOf, findManagerByPeer, findManagerBySessionId } from './features/session-registry.js';

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
  diag('stickerStoreOf: 回退 primary');
  return getStickerStore();
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
    description: '(QQ聊天加分项,气氛对就大胆用!)查本地表情包库,返回图片本地路径+标签+详细描述。想用图回应的时刻——对方发图(接梗/回图)、爆笑/自嘲/庆祝/被夸/共鸣/话题热闹——**先**调它按情绪关键词搜库(query可空=最近收藏), 从返回里挑最贴切的一张, 用 send_media(kind=image, source=该路径) 发出去(0~1张, 一次最多一张)。每张的"描述"写着画面和适用场合帮你挑准; 只有实在查不到贴切的, 才退而回纯文字。别老憋着——QQ 聊天带张好图比干巴巴文字生动多了。',
    parameters: {
      query: { type: 'string', description: '语义关键词(可空=最近收藏; 会匹配标签和描述)' },
      tag: { type: 'string', description: '标签过滤(可空)' },
      limit: { type: 'integer', description: '返回条数上限 1~20,默认5' },
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
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.floor(limitRaw ?? 5))) : 5;
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
    description: '(主动维护,别等用户开口!)看到"值得留"的图就调它收藏+打标: 群友发来有梗/好看/以后想用到的图(不管你这轮要不要发), 当场用 sticker_tag(传群消息里那张图的URL 或本地路径)收藏入库并给中文短标签+一句描述——图库越好用, 以后 list_stickers 越搜得到。已在库的图可改标签/描述; 缺标签或缺介绍的图(见 sticker_untagged)也用它补。tags=逗号分隔中文短标签(内容/情绪/用途, 如 爆笑,元气,打招呼); desc=一句"画面+情绪+适合场合"。想省视觉额度可传 vision=false(仅对已在库的图打标)。打标的意义: 你的表情包弹药库靠它养成, 不整理=好图烂在库里永远搜不到。',
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
            const r = store.importLocalFile(sticker);
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
    description: '出站模式开关(自己决定): 切换本 bot 向 QQ 发消息的方式, 保存即热更新(不用重启, dock与设置同步)。三档任选: adaptive=适配主动(默认推荐): 真人消息前5条带引用回你、连发自动转独立消息不被QQ吞; passive=被动: 始终回复最后一条(连发约4~5条后被QQ吞); silent=完全不出站: 照常思考但这条回复不发出(潜水观察用; web上仍可对话)。注意: 不提供 nothink(完全不思考)——那档只能由主人在设置页配置。根据当下场景选: 正常聊天/被@回应→adaptive; 想保持引用感→passive; 判断不该在群里说话(冷场/打扰)→silent。',
    parameters: {
      mode: { type: 'string', required: true, enum: ['adaptive', 'passive', 'silent'], description: '目标模式: adaptive(默认推荐) / passive / silent' },
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
      if (args.mode !== 'adaptive' && args.mode !== 'passive' && args.mode !== 'silent') {
        return { ok: false, msg: '只允许 adaptive/passive/silent(nothink 需主人在设置页配置)', mode: String(args.mode ?? '') };
      }
      const r = await switchOutboundMode(args.mode);
      if (!r.ok) return { ok: false, msg: r.msg, mode: r.mode };
      // 切换成功后用 bot 直发确认消息(绕过出站路由): 即使切到 silent(不出站)/被动,
      // 主人也一定能收到"模式已切换"的通知(与 send_media 同款工具直发通道, 不受 outboundMode 拦截)。
      const MODE_LABEL: Record<string, string> = {
        adaptive: '适配主动(推荐默认): 真人消息前5条带引用回你, 连发自动转独立消息',
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
    description: '群管理(读): 查看待审批的入群申请列表(申请人/验证消息/来源/风险提示)。默认查当前会话所在群/manageGroup; 也可传 gid 查指定群。仅主人要求时调用。需在设置开启"QQ群管理"且机器人为群管理员。',
    parameters: {
      gid: { type: 'string', description: '目标群 openid(可选)。不填=当前会话群或 manageGroup; 填了则查指定群的待审批列表' },
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
      const list = r.data.list;
      if (list.length === 0) return { ok: true, msg: '当前没有待审批的入群申请 ✓' };
      const lines = list.map((j, i) => `${i + 1}. ${j.username ?? '?'} (${j.member_openid}) 来源:${j.apply_source ?? '?'} 验证:${verifyHuman(j.verify_info) || '-'}${j.risk_tips ? ` ⚠️${j.risk_tips}` : ''}`);
      return { ok: true, msg: `入群申请 ${list.length} 条${args.gid ? `(群 …${gid.slice(-6)})` : ''}:\n${lines.join('\n')}` };
    },
  });

  const approveJoinTool = defineTool({
    name: 'group_approve_join',
    description: '群管理(写,危险): 审批入群申请。approve=放行 / decline=拒绝(可带理由)。支持批量: member_openids 数组一次批多人(优先); 也兼容单数 member_openid。仅主人明确要求时调用; 调用前建议先 group_join_requests 核对申请人。',
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

  const sessionListTool = defineTool({
    name: 'session_list',
    description: '会话(读): 列出本 bot 全部活跃会话(sessionId/范围/peer/最近活跃/预设), 用于跨会话寻址(找 session_wake 的目标 id)。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(_args, exec) {
      const tail = (s: string | undefined, n = 10): string => (s && s.length > n ? '…' + s.slice(-n) : (s ?? ''));
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
        for (const s of list) {
          n++;
          lines.push(`${n}. [${s.scope}]${ns !== 'im-qqbot' ? `(${ns})` : ''} peer=${tail(s.peerId)} sender=${tail(s.senderId, 8)} id=${s.sessionId}${s.agentPreset ? ` (${s.agentPreset})` : ''} 活跃=${new Date(s.lastActivity).toLocaleTimeString()}`);
        }
        // 潜在会话: 群注册表里的群可能还没 getOrCreate(无活跃记录), 但 sessionId 可确定性算出
        try {
          const raw = readFileSync(groupRegistryPath(manager.cwd), 'utf8');
          const reg = JSON.parse(raw) as Record<string, { name?: string }>;
          const ids = new Set(list.map((s) => s.sessionId));
          for (const gid of Object.keys(reg ?? {})) {
            const sid = manager.sessionIdFor('group', gid);
            if (!ids.has(sid)) lines.push(`[潜在群] ${reg[gid]?.name ?? ''}(${tail(gid)}) id=${sid} 活跃=未创建`);
          }
        } catch { /* 无注册表/读失败则跳过 */ }
      }
      if (lines.length === 0) return { ok: true, msg: '当前无活跃会话, 也无已注册群' };
      return { ok: true, msg: `会话 ${lines.length} 个:\n${lines.join('\n')}` };
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
      const sr = scope === 'group'
        ? await ga.client.sendGroupText(peer, body)
        : await ga.client.sendC2cText(peer, body);
      sent.push(sr.ok ? `📨已发到QQ ${scope === 'group' ? '群' : '私聊'}` : `⚠️QQ发送失败: ${sr.err.human}`);
    } else {
      sent.push('⚠️群管理未开启');
    }
    return `；${sent.join(' ')}`;
  }

  const sessionWakeTool = defineTool({
    name: 'session_wake',
    description: '跨会话(写,需谨慎): 向指定会话发送一条消息并唤醒该会话的 LLM(给 AI 看); 同时把带来源标注的消息通过 QQBot 通道发到该会话绑定的群/私聊(给人看)。可用 session_list 查目标 id; 也支持按 peerId(群/私聊) 寻址。仅主人明确要求时调用。',    parameters: {
      session_id: { type: 'string', description: '目标会话 id(完整 sessionId, 来自 session_list)' },
      peer_id: { type: 'string', description: '或按 peer 寻址: 群 openid/私聊 openid(需带 scope)' },
      scope: { type: 'string', enum: ['group', 'c2c'], description: 'peer_id 寻址时的范围(group=群 / c2c=私聊)' },
      text: { type: 'string', required: true, description: '要发送并唤醒 AI 的消息内容' },
      send_qq: { type: 'boolean', description: '是否同时发到绑定的 QQ 群/私聊(给人看, 默认 true)。false=只唤醒 LLM 不走 QQ 通道' },
      media: { type: 'string', description: '跨群发图: 图片本地路径或 http(s) URL, 随消息发到目标群(需 send_qq=true)' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(args, exec) {
      const text = String(args.text || '');
      if (!text) return { ok: false, msg: '缺少 text' };
      // 来源标注(便于对方直接会话): 优先当前执行 agent 的 id(=会话 id); 再取当前会话记录;
      // 再回退 groupAdmin 的 hub 会话; 最后 'web'
      let from = 'web';
      try {
        const aid = (exec.agent as { id?: unknown } | undefined)?.id;
        if (typeof aid === 'string' && aid.length >= 8) from = aid.slice(0, 8) + '…';
        else {
          const ch0 = channelOf(exec as never);
          const src = findSessionRec(ch0, exec as never);
          if (src?.rec?.sessionId) from = src.rec.sessionId.slice(0, 8) + '…';
        }
      } catch { /* 忽略 */ }
      const body = `【来自会话 ${from}】\n${text}${args.media ? `\n[附带图片: ${args.media}]` : ''}`;
      const map: Record<string, string> = {
        ok: '✅ 已发送并唤醒',
        'no-session': `❌ 会话不存在: 目标会话不在任何已注册实例中(或已重建/换绑)`,
        'no-followup': '❌ 该会话 agent 不支持 followup 唤醒',
        fail: '❌ 唤醒异常',
      };
      const sid = String(args.session_id || '');
      if (sid) {
        // ① session_id 寻址: module 级注册表跨全部实例精确命中(重启后仍可查)
        const manager = findManagerBySessionId(sid);
        if (!manager) return { ok: false, msg: `❌ 会话不存在: ${sid.slice(0, 8)}…(不在任何已注册实例)` };
        const r = await wakeSessionAgent(manager, sid, loggerLike(exec as never), body);
        let extra = '';
        if (args.send_qq !== false) {
          // 目标 peer: 活跃会话直接取记录; 潜在群(未创建)从群注册表按 sessionIdFor 反查
          let qScope: 'group' | 'c2c' | undefined;
          let qPeer = '';
          const rec = manager.findBySessionId(sid);
          if (rec) {
            qScope = rec.scope;
            qPeer = rec.peerId;
          } else {
            try {
              const raw = readFileSync(groupRegistryPath(manager.cwd), 'utf8');
              const reg = JSON.parse(raw) as Record<string, unknown>;
              for (const gid of Object.keys(reg ?? {})) {
                if (manager.sessionIdFor('group', gid) === sid) { qScope = 'group'; qPeer = gid; break; }
              }
            } catch { /* 无注册表则跳过 */ }
          }
          if (qScope && qPeer) {
            extra = await sendQQWithMedia(manager, qScope, qPeer, body, String(args.media || ''), exec as never);
          }
        }
        return { ok: r === 'ok', msg: `${map[r] ?? r} (${sid.slice(0, 8)}…)${extra}` };
      }
      // ② peer 寻址: registry 按 scope+peer 找目标实例(跨全部实例), 找不到回退任意实例
      const peer = String(args.peer_id || '');
      const sc = String(args.scope || '') as 'group' | 'c2c';
      if (!peer || !sc) return { ok: false, msg: '请给 session_id, 或 scope+peer_id' };
      let manager = findManagerByPeer(sc, peer);
      if (!manager) manager = managersOf()[0];
      if (!manager) return { ok: false, msg: '找不到会话管理器实例(无已注册实例)' };
      let rec = manager.findByPeer(sc, peer);
      if (!rec) {
        // 会话未创建(懒创建): 用主人身份 getOrCreate 建起来再唤醒(2026-09-10 主人定)
        rec = await manager.getOrCreate(sc, peer, 'master', { scope: sc, targetId: peer });
        if (!rec) return { ok: false, msg: `会话创建失败: ${sc} ${peer.slice(0, 8)}…` };
      }
      const sid2 = rec.sessionId;
      const r = await wakeSessionAgent(manager, sid2, loggerLike(exec as never), body);
      let extra = '';
      if (args.send_qq !== false) {
        extra = await sendQQWithMedia(manager, sc, peer, body, String(args.media || ''), exec as never);
      }
      return { ok: r === 'ok', msg: `${map[r] ?? r} (${sid2.slice(0, 8)}…)${extra}` };
    },
  });

  const muteStateTool = defineTool({
    name: 'group_mute_state',
    description: '群管理(读): 查看当前群禁言状态(全员模式 + 正在禁言中的成员及到期时间)。仅主人要求时调用。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, msg: { type: 'string', required: true } },
      },
      render: (_a, v: { ok: boolean; msg: string }) => [{ type: 'text' as const, text: v.ok ? v.msg : `失败: ${v.msg}` }],
    },
    async execute(_args, exec) {
      const ga = groupAdminOf(exec);
      if (!ga) return { ok: false, msg: '群管理未开启或非群会话' };
      if (!ga.gid) return { ok: false, msg: '当前不是群会话' };
      const r = await ga.client.getMuteState(ga.gid);
      if (!r.ok) return { ok: false, msg: r.err.human };
      const mode = r.data.global_rule?.mode ?? 'none';
      const members = r.data.members ?? [];
      const lines = members.map((m) => `${m.username ?? String(m.member_openid).slice(0, 10)}… 禁言至 ${m.mute_expire_at ?? '?'}`);
      return { ok: true, msg: `全员禁言: ${mode === 'always' ? '开启' : mode === 'schedule' ? '定时' : '关闭'}\n禁言中 ${members.length} 人:\n${lines.length ? lines.join('\n') : '(无)'}` };
    },
  });

  const muteMemberTool = defineTool({
    name: 'group_mute_member',
    description: '群管理(写,危险): 禁言/解除群成员。action=mute 禁言(seconds 秒, 默认600); unmute=立即解除。只能禁普通成员(群主/管理员禁不了)。仅主人明确要求时调用。',
    parameters: {
      member_openid: { type: 'string', required: true, description: '目标成员 member_openid' },
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
      if (!ga.gid) return { ok: false, msg: '当前不是群会话' };
      const secs = Math.max(1, Math.min(30 * 86400, Math.round(Number(args.seconds ?? 600))));
      const pad = (n: number): string => String(n).padStart(2, '0');
      const expire = args.action === 'mute' ? new Date(Date.now() + secs * 1000) : null;
      const rfc = expire
        ? `${expire.getFullYear()}-${pad(expire.getMonth() + 1)}-${pad(expire.getDate())}T${pad(expire.getHours())}:${pad(expire.getMinutes())}:${pad(expire.getSeconds())}+08:00`
        : null;
      const r = await ga.client.setMemberMute(ga.gid, args.member_openid, rfc);
      if (!r.ok) return { ok: false, msg: r.err.human };
      return { ok: true, msg: args.action === 'mute' ? `✅ 已禁言, ${Math.round(secs / 60)} 分钟后自动解除` : '已解除禁言' };
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

  // 逐个注册并记录结果(便于线上定位是哪个工具失败)
  const toolDefs: Array<{ name: string; tool: unknown }> = [
    { name: 'send_media', tool: sendMediaTool },
    { name: 'recall_message', tool: recallTool },
    { name: 'text_break', tool: textBreakTool },
    { name: 'tools_reload', tool: toolsReloadTool },
    { name: 'reply_gate', tool: replyGateTool },
    { name: 'outbound_mode', tool: outboundModeTool },
    { name: 'group_join_requests', tool: listJoinRequestsTool },
    { name: 'group_approve_join', tool: approveJoinTool },
    { name: 'group_mute_state', tool: muteStateTool },
    { name: 'group_mute_member', tool: muteMemberTool },
    { name: 'session_list', tool: sessionListTool },
    { name: 'session_wake', tool: sessionWakeTool },
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
