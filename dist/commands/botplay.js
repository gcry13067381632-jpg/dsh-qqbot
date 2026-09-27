import { triggerBotplay, botplayCatalog, resolveCommandTarget, listBotplayEventsOfNs } from '../features/botplay.js';
export function botplayCommand({ config }) {
    return {
        name: 'botplay',
        description: '互动事件: /botplay 出目录卡片(点事件直接触发); /botplay 事件名 直接触发',
        usage: '/botplay [事件名]',
        handler: async (cmdCtx) => {
            const args = String((cmdCtx.command?.raw ?? '').trim());
            // 事件源(2026-09-10 修复): 优先取控制器的现读列表({dataRoot}/botplay-events.json, 支持热更),
            // 控制器未注册时才回退 config.botplayEvents(settings 层, M4.3 迁移后已清空)。
            const ns = (String(config.settingsNs ?? '').trim() || 'im-qqbot');
            const live = listBotplayEventsOfNs(ns);
            const events = live ?? (Array.isArray(config.botplayEvents) ? config.botplayEvents : []);
            const { target, triggererId } = resolveCommandTarget(cmdCtx);
            // 无参 → 发事件目录卡(点按钮直接触发; 事件多自动翻页)
            if (!args) {
                if (events.length === 0) {
                    return '🎮 还没有装配任何互动事件——到 dock「🎮 互动事件」或 Web 设置里装配后保存即可。';
                }
                if (!target.targetId)
                    return '无法定位当前会话, 请稍后再试~';
                const r = await botplayCatalog(ns, target, 0);
                return r.msg; // 成功时为空串(卡片已发); 失败才返回错误文本
            }
            // 精确匹配: 先 id 后 name(整串, 不模糊)
            const hit = events.find((e) => e.id === args || e.name === args);
            if (!hit) {
                return `找不到事件「${args}」——发 /botplay 看目录卡片(或精确名字/id)。`;
            }
            if (!target.targetId || !triggererId) {
                return '无法定位当前会话, 请稍后再试~';
            }
            const r = await triggerBotplay(ns, target, hit.id, triggererId);
            return r.msg;
        },
    };
}
//# sourceMappingURL=botplay.js.map