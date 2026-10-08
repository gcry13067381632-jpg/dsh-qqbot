import { loadExtensionTools } from './extension-store.js';
import { lookupExtToolCard, parseExtToolButtonData } from './ext-tool-cards.js';
/**
 * 「这张卡的这个按钮，有哪些人点过」—— 内存态，仅用于给模块一个 `clickedBefore` 提示。
 * ⚠️ 重启即丢；**权威判重请模块自己用 `ctx.store` 落盘**（别把这个当账本）。
 */
const clickedMemory = new Map();
function noteClicked(cardId, buttonId, openid) {
    const key = `${cardId}:${buttonId}`;
    let set = clickedMemory.get(key);
    const before = !!set && set.has(openid);
    if (!set) {
        set = new Set();
        clickedMemory.set(key, set);
    }
    set.add(openid);
    // 防御：单按钮最多记 5000 人（正常远达不到）
    if (set.size > 5000)
        clickedMemory.delete(key);
    return before;
}
export function createExtToolInteractionController(deps) {
    const { dataRoot, logger, makeCtx, sendReceipt } = deps;
    return {
        async handleInteraction(event, replyTarget) {
            const e = event;
            // ① 只看按钮回调
            if (e?.data?.type !== 11)
                return false;
            const parsed = parseExtToolButtonData(e.data?.resolved?.button_data);
            if (!parsed)
                return false; // 不是我们的前缀：零打扰
            const { toolName, cardId, buttonId } = parsed;
            // ② 查注册表（谁发的、按钮属于谁、过期没）
            const hit = lookupExtToolCard(dataRoot, { toolName, cardId, buttonId });
            if (!hit) {
                // 未登记/已过期/按钮不属于该卡 → 不消费（交回原有兜底；最后仍只 ack）
                logger.debug?.(`[ext-tool-btn] 未命中注册表 tool=${toolName} card=${cardId} btn=${buttonId}`);
                return false;
            }
            // ③ 找模块 + 它的 onInteraction
            let mod;
            try {
                const defs = await loadExtensionTools(dataRoot, logger);
                mod = defs.find((d) => d.name === toolName);
            }
            catch (err) {
                logger.warn(`[ext-tool-btn] 加载扩展工具失败: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (!mod || typeof mod.onInteraction !== 'function') {
                logger.warn(`[ext-tool-btn] 工具「${toolName}」不存在或未导出 onInteraction → 不消费`);
                return false;
            }
            // ④ 点击者身份：群聊看 group_member_openid，单聊看 user_openid
            const openid = String(e.group_member_openid ?? e.user_openid ?? '');
            const scope = e.group_member_openid ? 'group' : 'c2c';
            const peerId = scope === 'group' ? String(hit.targetId || e.group_openid || '') : openid;
            const clickedBefore = noteClicked(cardId, buttonId, openid);
            // ⑤ 组 ctx 并调用（抛错=未消费，但给点击者一句回执，别让人干等）
            let ctx;
            try {
                ctx = makeCtx({
                    toolName,
                    replyTarget,
                    actor: { openid, name: '', isOwner: false }, // name/isOwner 由 makeCtx 内部按 owners 补齐
                    scope,
                    peerId,
                    clickedBefore,
                });
            }
            catch (err) {
                logger.warn(`[ext-tool-btn] 组 ctx 失败: ${err instanceof Error ? err.message : String(err)}`);
                return false;
            }
            const info = {
                cardId,
                buttonId,
                buttonLabel: String(e.data?.resolved?.button_label ?? ''),
                clickedBefore,
                event,
            };
            try {
                const out = await mod.onInteraction(ctx, info);
                const text = typeof out === 'string' ? out.trim() : '';
                if (text)
                    await sendReceipt(replyTarget, text);
                logger.info(`[ext-tool-btn] 已派发 tool=${toolName} card=${cardId} btn=${buttonId} openid=${openid.slice(0, 8)}…`);
                return true;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn(`[ext-tool-btn] onInteraction 异常 tool=${toolName}: ${msg}`);
                // 钩子挂了：给点击者一句实话（这条不算消费成功，但既然点了我们的卡，就该有反馈）
                try {
                    await sendReceipt(replyTarget, `⚠️ 处理失败：${msg.slice(0, 120)}`);
                }
                catch { /* ignore */ }
                return false;
            }
        },
    };
}
//# sourceMappingURL=ext-tool-interaction.js.map