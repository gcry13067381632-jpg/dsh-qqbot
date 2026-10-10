# 扩展工具示例（`examples/ext-tools/`）

这些文件是给 `{数据根}/.qqbot-extensions/tools/` 用的**扩展工具**示例。

**自 v1.8.0 起：插件启动时会自动把它们铺进你的扩展目录**（`{数据根}/.qqbot-extensions/tools/`）——
**只补不存在**的文件、绝不覆盖你改过的，因此也不会重复搬。当然你也可以手动复制。
（热更新：写/改完发 `/tools-reload`；改**已有同名**工具时插件会自动热替换，无需重启宿主。）

## qq_send.mjs — 查 QQ 聊天对象 + 发消息（演示「跨通道工具」）

`expose: 'all'` 的样板：声明之后它**对所有会话可见**（含 web / 终端等非 QQ 通道），
靠 `env.qq` 账号包在那边**直接操作 QQ**（这就是"隔着通道指挥 QQ"）。

| 环节 | 说明 |
|---|---|
| 安装 | 插件自动铺（或手动把 `qq_send.mjs` 复制到 `{数据根}/.qqbot-extensions/tools/`） |
| 注册名 | `<原名>__<人设id>`，例 `qq_send__whale-girl`（⚠️ **工具名只能用 `[a-zA-Z0-9_-]`**） |
| 查询 | `action:"list"` → 列出已知群 / 私聊（带最近活跃时间），可用 `query` 过滤 |
| 发送 | `action:"send"` + `target`（openid **或群名/昵称**）+ `text`；按名字命中多个**绝不猜**，只回候选 |
| 连发 | `texts:[多条]`（内容不同）或 `text`+`count`（同一条重复 N 次），默认每条间隔 600ms 防 QQ 吞消息 |
| 发送链路 | 插件侧**被动优先**：先取目标会话最近的 `msgId` 走被动回复（不吃主动配额），失败自动去掉 `msgId` 转主动 |
| 前提 | 它走 `env.qq` ⇒ 必须声明 `expose: 'all'`，且对应人设实例在线 |

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
