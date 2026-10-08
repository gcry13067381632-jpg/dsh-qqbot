# 扩展工具示例（`examples/ext-tools/`）

这些文件是给 `{数据根}/.qqbot-extensions/tools/` 用的**扩展工具**示例 —— 复制过去即可生效
（`tools_reload` / 重启宿主后由插件扫描加载）。

## vote.mjs — 群投票（演示「按钮回调」）

| 步骤 | 说明 |
|---|---|
| 安装 | 复制 `vote.mjs` 到 `{数据根}/.qqbot-extensions/tools/` |
| 使用 | 让 AI 调一次 `vote` 工具（题目 + `\|` 分隔的选项），它会发一张带按钮的卡片 |
| 点击 | 点下去 = 一票；同一人重复点只记第一次；每次点击都有回执文本 |
| 数据 | `{数据根}/.qqbot-extensions/tools/data/vote.json`（插件升级/重装不丢） |

## 写自己的「按钮回调」工具，只要记住三件事

1. **发卡前登记卡片**（不登记 = 按钮点了没人认）：
   ```js
   env.registerInteractionCard({
     cardId, buttonIds: ['o0', 'o1'],
     expireAt: Date.now() + 86400_000,   // 可选，缺省 7 天
   });
   ```
2. **按钮 data 用 `ext:` 前缀**，三段式且与登记值完全一致：
   ```js
   { action: { type: 1, permission: { type: 2 }, data: `ext:${你的工具名}:${cardId}:${buttonId}` } }
   ```
   `type: 1` 才是回调按钮（0=跳转、2=指令都不产生回调事件）。
3. **导出 `onInteraction(ctx, info)`**：
   ```js
   export default {
     name: 'mytool', run(args, env) {…},
     async onInteraction(ctx, info) {
       // info: { cardId, buttonId, buttonLabel, clickedBefore, event }
       // ctx.performer: { openid, name, isOwner }   ← 点击者身份
       // ctx 与 run() 的 env 是同一套能力（emit/store/api/appendWake…）
       return '已处理 ✅';   // 非空字符串 = 发给点击者的回执
     },
   };
   ```

## 边界（插件侧保证的）

- 不是 `ext:` 前缀、或查不到登记记录 / 已过期 → 插件**不消费**该事件（交回原有兜底，最后只 ack）；
- 钩子抛错不会影响其它链路，点击者会收到一句 `⚠️ 处理失败：…`；
- 按钮回调的 ack 由插件统一做（不用管 `PUT /interactions/{id}`）；
- 注册表是纯旁路：**写失败也不影响发卡**，只是这张卡的按钮点了没反应。
