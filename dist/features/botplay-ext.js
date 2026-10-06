/**
 * botplay-ext.ts — botplay「自定义事件」扩展模块运行时(2026-10-05)
 *
 * 动机(主人 2026-10-05):
 *   现有 botplay 编辑器只有 3 种按钮行为(reply_text / jump_url / command)+ 三档 llmEffect,
 *   "点一次回一句死文本"。想要的事件往往带**状态**(谁签到过、签了几个、能不能结束)与
 *   **越权判定**(结束按钮只有主人能点), 编辑器表达不了 —— 于是让 AI 直接写一个 JS 模块,
 *   事件 JSON 里用 `file` 字段挂上去, 模块用下面这套钩子/上下文自己实现逻辑。
 *
 * 目录(沿用 channel-tools 扩展工具那一套的 extRoot 思路, 见 loadExtensionTools):
 *   {dataRoot}/.qqbot-extensions/botplay/<file>.mjs
 *   —— 挂在**数据根**下, 与 node_modules 分离 ⇒ 插件 npm 升级/重装**永不覆盖**主人的扩展资产。
 *   同名工具/命令两套扩展已经在用 {dataRoot}/.qqbot-extensions/{tools,commands}, botplay 是第三套。
 *
 * 模块契约(ESM, default 导出或具名导出都行):
 *   export default {
 *     name: '签到统计',                    // 可选, 只用于面板显示
 *     onInit(ctx)   { … },                 // 模块首次被某个卡片实例加载时调用(注册按钮 / 建状态)
 *     onClick(ctx, info) { … },            // 某按钮被点击时调用; 返回字符串(非空)则当普通文本回给点击者
 *     onTick(ctx)   { … },                 // 可选: 每分钟被扫一次(卡片仍有效期内); 不想用就不写
 *     onExpire(ctx) { … },                 // 可选: 卡片过期被回收时
 *     onDispose(ctx) { … },                // 可选: 卡片关闭/热重载/插件卸载时, 收尾清理
 *   };
 *   ⚠️ 钩子全部 fail-soft: 抛错只记日志 + 记进诊断, 不影响 QQ 正常聊天、不影响其它事件。
 *
 * ctx 能力(这是本功能的核心价值 —— 编辑器回调给不了的都给到):
 *   · 卡片:   ctx.card() 读写正文 markdown / 按钮列表; 返回 true ⇒ 点击完自动**重发卡片刷新按钮**
 *   · 发消息: ctx.emit 文本(支持 <@openid>) / ctx.markdown / ctx.image / ctx.at  (走插件既有出站链路)
 *   · 持久化: ctx.store.load() / save(obj)  —— 落到数据根下, 升级插件不丢
 *   · 查询:   ctx.user.openid/name/isOwner, ctx.owners, ctx.info.clickedBefore, ctx.peer, ctx.event
 *   · 权限:   模块自己在 onClick 里判 ctx.user.isOwner / ctx.owners.includes(openid) 后决定放不放行
 *             (QQ 客户端侧的按钮权限仍由事件 JSON 的 perm 决定, 默认 all=谁都能点, 细粒度交模块)
 *   · 运行时: ctx.reloadSelf() 热重载自己, ctx.log(...) 落日志
 *
 * 热重载: 模块 URL 带 `?v=<mtime>`(与 extension-store 同款 cache-bust, 见 fileVersion 注释里
 *   那次内存泄漏的坑), 文件一改下次解析卡片就自动加载新版本 —— 不用重启宿主、不用重启插件。
 *
 * 为什么这里要把"卡片状态"做成可控对象而不是直接改 ev.buttons:
 *   ev 是**现读文件**的 live 配置对象, 就地改会污染配置(还会被下一次读取覆盖)。
 *   ⇒ 每次发卡抽一份"实例卡片状态"(contentText/buttons/buttonsPerRow/dirty), 事件配置只读。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
/** 自定义事件模块根目录名(相对数据根) */
export const BOTPLAY_EXT_SUBDIR = join('.qqbot-extensions', 'botplay');
/** 模块自有状态文件目录名(相对自定义事件模块根; 与 .mjs 同屋, 升级/重装都不动) */
export const BOTPLAY_EXT_DATA_SUBDIR = 'data';
/** 自定义事件模块根目录绝对路径 */
export function botplayExtDir(dataRoot) {
    return join(dataRoot, BOTPLAY_EXT_SUBDIR);
}
/** 某个模块的状态文件绝对路径 */
export function botplayExtStatePath(dataRoot, file) {
    return join(dataRoot, BOTPLAY_EXT_SUBDIR, BOTPLAY_EXT_DATA_SUBDIR, `${file}.json`);
}
/** 构造一个卡片实例的 ctx(每次 resolveCard / onClick 都 new 一个, 保证 user 是最新的点击人) */
export function makeExtContext(deps, ev, cardId, clicker) {
    const stateFile = botplayExtStatePath(deps.dataRoot, ev.file);
    /** 统一入口：模块要"进 AI 上下文"时转给注入的回调（没注入就返回 false，不抛错） */
    const runLlmEffect = async (mode, text) => {
        const t = String(text ?? '').trim();
        if (!t)
            return false;
        if (typeof deps.onLlmAppend !== 'function') {
            deps.logger.warn?.('[botplay-ext] 本次未注入 onLlmAppend，append 请求被忽略');
            return false;
        }
        try {
            return (await deps.onLlmAppend(mode, t)) === true;
        }
        catch (err) {
            deps.logger.warn?.(`[botplay-ext] ${ev.file} append 失败: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    };
    const openid = clicker?.openid ?? '';
    return {
        event: {
            id: ev.id,
            name: ev.name,
            file: ev.file,
            maxClicks: Number(ev.maxClicks ?? 0) || 0,
            expireSec: Number(ev.expireSec ?? 600) || 600,
            scope: ev.scope,
            peerId: ev.peerId,
        },
        cardId,
        clicked: clicker?.clickedBefore ?? 0,
        get user() {
            return {
                openid,
                name: openid ? deps.memberName(openid) : '',
                pureName: openid ? deps.memberName(openid) : '',
                isOwner: !!openid && deps.owners.includes(openid),
            };
        },
        owners: deps.owners.slice(),
        /** 只读：bot AppID（卡片可拿它 + appSecret 自己换 token 调官方 API） */
        get appId() {
            try {
                return String((deps.credentialsGetter?.() || {}).appId || '');
            }
            catch {
                return '';
            }
        },
        /** 只读：bot AppSecret（同上；卡片是代码，直接给钥匙而不是包能力） */
        get appSecret() {
            try {
                return String((deps.credentialsGetter?.() || {}).appSecret || '');
            }
            catch {
                return '';
            }
        },
        /**
         * 静默进入 AI 上下文：作为一条 user/message 追加进会话，不唤醒 AI。
         *   复用框架 llmEffect 的 append_silent 档；AI 下一轮自然能看到。
         */
        appendSilent: (text) => runLlmEffect('append_silent', text),
        /**
         * 记录并唤醒 AI：追加进会话后触发一次 AI 回合（AI 可能回话/发群消息）。
         *   复用 llmEffect 的 append_wake 档。⚠️ 耗 token，别在高频点击里无脑调。
         */
        appendWake: (text) => runLlmEffect('append_wake', text),
        /** 带 token 的官方 API 调用（框架拿 token；模块只管 path） */
        api: async (path, opts) => {
            if (typeof deps.onApiCall !== 'function') {
                return { ok: false, err: { code: 'NO_API', human: '本次运行未注入 onApiCall，API 调用不可用' } };
            }
            return deps.onApiCall((opts && opts.method) || 'GET', path, opts ? opts.body : undefined);
        },
        dir: botplayExtDir(deps.dataRoot),
        store: {
            load() {
                try {
                    const raw = readFileSync(stateFile, 'utf8');
                    const o = JSON.parse(raw);
                    return o && typeof o === 'object' ? o : null;
                }
                catch {
                    return null; // 文件不存在/坏 → 当空状态(fail-soft)
                }
            },
            save(data) {
                try {
                    mkdirSync(dirname(stateFile), { recursive: true });
                    const tmp = `${stateFile}.tmp-${Date.now()}`;
                    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
                    renameSync(tmp, stateFile); // 原子写(tmp+rename, 仿 chat-ledger/botplay-store)
                    return true;
                }
                catch (err) {
                    deps.logger.warn?.(`[botplay-ext] ${ev.file} 状态写入失败: ${err instanceof Error ? err.message : String(err)}`);
                    return false;
                }
            },
            path: () => stateFile,
        },
        card() {
            return deps.cardState;
        },
        emit: (text, at) => {
            const ids = at === undefined ? [] : (Array.isArray(at) ? at : [at]);
            const prefix = ids.filter(Boolean).map((id) => `<@${id}> `).join('');
            return deps.emit(prefix + String(text ?? ''));
        },
        markdown: (content) => deps.markdown(String(content ?? '')),
        image: (source) => deps.image(source),
        text: (t) => (typeof deps.text === 'function' ? deps.text(String(t ?? '')) : Promise.resolve(false)),
        media: (kind, source) => (typeof deps.media === 'function' ? deps.media(kind, source) : Promise.resolve(false)),
        voice: (source) => (typeof deps.media === 'function' ? deps.media('voice', source) : Promise.resolve(false)),
        video: (source) => (typeof deps.media === 'function' ? deps.media('video', source) : Promise.resolve(false)),
        file: (source) => (typeof deps.media === 'function' ? deps.media('file', source) : Promise.resolve(false)),
        markdownCard: (c, kb) => (typeof deps.markdownCard === 'function' ? deps.markdownCard(String(c ?? ''), kb) : Promise.resolve(false)),
        at: (id) => `<@${String(id ?? '')}>`,
        kernel: deps.kernel,
        getMember: (id) => {
            const nm = deps.memberName(String(id ?? ''));
            return { openid: String(id ?? ''), name: nm, pureName: nm };
        },
        clickCount: (buttonId) => deps.clickCount(buttonId),
        reloadSelf: () => deps.reloadSelf(),
        log: (...args) => {
            try {
                deps.logger.info?.(`[botplay-ext:${ev.file}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
            }
            catch { /* 日志失败无所谓 */ }
        },
    };
}
// ─────────────────────────── 诊断日志(面板可见) ───────────────────────────
/**
 * 扩展诊断落盘: {dataRoot}/.qqbot-extensions/botplay/botplay-ext.log
 * 为什么单独一个文件: 事件加载/点击是**宿主进程内的静默失败**高发区(模块语法错、
 * 钩子抛错、路径不对), 全埋进 logger 时面板/主人根本看不到; 落个文件, 面板能读、主人能看。
 */
export function appendExtDiag(dataRoot, line) {
    try {
        const dir = botplayExtDir(dataRoot);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, 'botplay-ext.log'), `[${new Date().toISOString()}] ${line}\n`, 'utf8');
    }
    catch { /* 诊断失败绝不抛 */ }
}
/** 读诊断尾部 N 行(面板用) */
export function readExtDiagTail(dataRoot, limit = 40) {
    try {
        const p = join(botplayExtDir(dataRoot), 'botplay-ext.log');
        if (!existsSync(p))
            return [];
        const lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
        return lines.slice(-Math.max(1, Math.min(500, limit)));
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=botplay-ext.js.map