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
import { appendFileSync, existsSync, statSync } from 'node:fs';
import type { SessionManager } from './session/session-manager.js';
import type { QQBotSender } from './transport/outbound-buffer.js';
import { getStickerStore } from './features/sticker-store.js';
import { autoTagImage } from './features/sticker-tagger.js';
import { isStickerGateDenied } from './features/sticker-gate.js';
import { getScheduleStore } from './features/schedule-store.js';

/** 诊断日志路径: 默认关闭; 需要排查时设环境变量 QQBOT_DIAG_FILE 指向日志文件 */
const DIAG_FILE = process.env.QQBOT_DIAG_FILE || '';
/** 大文件异步发送阈值: 本地文件 >= 5MB 时走后台任务(SDK 分片上传耗时, 避免阻塞 LLM 回合) */
const FILE_ASYNC_MIN = 5 * 1024 * 1024;
let bgSeq = 0;
function fmtMB(n: number): string { return (n / 1048576).toFixed(1) + 'MB'; }
/** 把后台任务结果作为 user/message 写回会话(不唤醒, 与入群申请通知同款; 失败静默) */
function notifySession(sess: unknown, text: string): void {
  try {
    const session = sess as { append?: (t: string, d: unknown, o?: unknown) => unknown };
    if (!session || typeof session.append !== 'function') return;
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
    } else {
      diag(`channelOf: 无 agent.ctx (agent=${typeof agent}${agent ? ` keys=${Object.keys(agent).slice(0, 8).join(',')}` : ''})`);
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
    const rec = c.manager.findByAgent(exec.agent as never);
    return rec ? { ch: c, rec } as { ch: QQChannel; rec: SessionRec } : undefined;
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
export function apply(ctx: Context): void {
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
            const sess = ((rec.agent as { session?: unknown } | undefined)?.session);
            void ch.sender.sendMedia(rec.replyTarget, args.kind as never, { localPath: lp } as never)
              .then((r) => {
                notifySession(sess, '[系统] 后台任务 #' + seq + ' 完成：已发送 ' + fname + '(' + fmtMB(st.size) + ')。');
                if (r && r.id) {
                  try {
                    const store = getStickerStore(ch.manager.stickerDataDir);
                    const sid = lookupId(store, lp);
                    if (sid) store.markUsed(sid);
                  } catch { /* 统计失败不影响发送 */ }
                }
                diag('bgSend #' + seq + ' ok ' + fname);
              })
              .catch((e) => {
                const msg = e instanceof Error ? e.message : String(e);
                notifySession(sess, '[系统] 后台任务 #' + seq + ' 失败：' + msg + '（未发送完成, 可重试或改用小文件）');
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
    description: '(只读,不发图)查本地表情包库,返回图片本地绝对路径+标签+详细描述。当你被@且语境适合回一张表情包/梗图(对方发图想接梗、自嘲、庆祝、吐槽)时,先调用它搜库;每张的"描述"会说明画面和适合的场合,据此挑最贴切的一张,再用 send_media(kind=image,source=该本地路径) 发 0~1 张。纪律:无强语境或拿不准→不查也不发;描述与想表达不合→只发文字。query 可为空(返回最近收藏)。',
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
    description: '给表情包打标/收藏一条龙。sticker=要处理的图:群消息里那张图的图片URL(自动匹配库里),或本地绝对路径,或list_stickers返回的路径。图已在库→直接更新它的标签/描述;图不在库→若vision=true(默认)会先自动识图生成草稿并收藏入库,然后应用你给的tags/desc(给了就覆盖草稿)。tags=逗号分隔中文短标签(内容/情绪/用途);desc=一句中文描述(画面+情绪+适合场合)。想跳过识图(省视觉额度)可传vision=false,只在图已在库时打标。',
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
    description: '查看表情包库概况(共多少张/各分区数量/没打标的/占多少空间),需要了解库存或整理时用。',
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
    description: '查看表情包里"还没整理完"的图(缺标签或缺介绍)。参数 a: 1=全部(候选+收藏), 2=只看收藏(正式文件夹)。可选 limit(每批条数, 默认20, 上限100)、offset(跳过前N条, 翻页用)。返回清单, 供你挑几张用 sticker_tag 补标签/写介绍, 把库整理干净。',
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
    description: '群管理(读): 查看当前群待审批的入群申请列表(申请人/验证消息/来源/风险提示)。仅主人要求时调用。需在设置开启"QQ群管理"且机器人为群管理员。',
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
      if (!ga) return { ok: false, msg: '群管理未开启(设置→QQ群管理)或非群会话' };
      if (!ga.gid) return { ok: false, msg: '当前不是群会话, 无法确定目标群' };
      const r = await ga.client.listJoinRequests(ga.gid);
      if (!r.ok) return { ok: false, msg: r.err.human };
      const list = r.data.list;
      if (list.length === 0) return { ok: true, msg: '当前没有待审批的入群申请 ✓' };
      const lines = list.map((j, i) => `${i + 1}. ${j.username ?? '?'} (${String(j.member_openid).slice(0, 10)}…) 来源:${j.apply_source ?? '?'} 验证:${j.verify_info?.verify_message ?? j.verify_info?.method ?? '-'}${j.risk_tips ? ` ⚠️${j.risk_tips}` : ''}`);
      return { ok: true, msg: `入群申请 ${list.length} 条:\n${lines.join('\n')}` };
    },
  });

  const approveJoinTool = defineTool({
    name: 'group_approve_join',
    description: '群管理(写,危险): 审批入群申请。approve=放行 / decline=拒绝(可带理由)。仅主人明确要求时调用; 调用前建议先 group_join_requests 核对申请人。',
    parameters: {
      member_openid: { type: 'string', required: true, description: '申请人 member_openid(来自 group_join_requests)' },
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
      if (!ga.gid) return { ok: false, msg: '当前不是群会话' };
      // join_request_id 官方审批必填(缺省报 40103007): 先拉列表按 member_openid 匹配自动补上
      const listR = await ga.client.listJoinRequests(ga.gid);
      if (!listR.ok) return { ok: false, msg: listR.err.human };
      const found = (listR.data.list ?? []).find((j) => j.member_openid === args.member_openid);
      const r = await ga.client.approveJoinRequest(ga.gid, args.member_openid, args.op as 'approve' | 'decline', {
        ...(found ? { join_request_id: found.join_request_id } : {}),
        ...(args.op === 'decline' && String(args.reason ?? '') && String(args.reason) !== '-'
          ? { reject_reason: String(args.reason) }
          : {}),
      });
      if (!r.ok) return { ok: false, msg: r.err.human };
      return { ok: true, msg: args.op === 'approve' ? '✅ 已放行该入群申请' : '已拒绝该入群申请' };
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

  // 逐个注册并记录结果(便于线上定位是哪个工具失败)
  const toolDefs: Array<{ name: string; tool: unknown }> = [
    { name: 'send_media', tool: sendMediaTool },
    { name: 'recall_message', tool: recallTool },
    { name: 'text_break', tool: textBreakTool },
    { name: 'reply_gate', tool: replyGateTool },
    { name: 'group_join_requests', tool: listJoinRequestsTool },
    { name: 'group_approve_join', tool: approveJoinTool },
    { name: 'group_mute_state', tool: muteStateTool },
    { name: 'group_mute_member', tool: muteMemberTool },
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
}
