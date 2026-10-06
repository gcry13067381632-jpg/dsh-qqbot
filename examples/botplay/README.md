# botplay 自定义事件 · 示例模块

> 这些是**可以直接跑的示例**，用来当骨架改。它们只依赖 botplay 事件契约里的 `ctx`，
> 不 import 插件内部任何东西 —— 所以复制到哪儿都能用。

## 用法（三步）

```powershell
# ① 把示例复制到你的数据根（不确定数据根在哪？面板账号列表里有"数据目录"）
#    典型路径：{数据根}/.qqbot-extensions/botplay/
Copy-Item .\checkin-stats.mjs "D:\你的数据根\.qqbot-extensions\botplay\"
```

```
# ② 登记一个 botplay 事件（面板「🎮 互动事件」→ 新建 / 或直接改 botplay-events.json）
{ "id": "checkin-stats", "name": "签到人数统计", "perm": { "type": "all" }, "file": "checkin-stats.mjs" }
```

```
# ③ 在群里发卡
/botplay checkin-stats
```

> 💡 模块目录在**数据根**下（不是插件包内）⇒ **插件升级/重装永不覆盖它**。
> 模块自己的状态写在同目录 `data/<模块文件名>.json`，同样不丢。

## 示例清单

| 文件 | 教什么 |
|---|---|
| **`checkin-stats.mjs`** | 两个按钮（谁都能点 / 只有主人能点）、每人限一次、按 `ctx.cardId` 分轮、结算时 `ctx.emit` 公布 + **`ctx.appendWake` 唤醒 AI**、卡片超时自动结算 |

## `checkin-stats.mjs` 值得学的四点

1. **★ 按钮级权限只能自己判**
   botplay 的 `perm` 是**整张卡片**一个，做不到"按钮 1 谁都能点、按钮 2 只有主人能点"。
   ⇒ 示例的做法：事件 `perm` 设 `all`，细粒度权限**在 `onClick` 里用 `ctx.user.isOwner` /
   `ctx.owners.includes(...)` 自己判**。这是最容易踩的坑。

2. **别动不动重发整张卡**
   点「签到」只**记录 + 回一句**，不重发卡片（重发既刷屏、又可能撞 QQ 发卡限频）；
   名单在「结束」时统一公布就够。只有真要刷新按钮状态时才 `ctx.card().dirty = true`。

3. **状态按 `ctx.cardId` 分轮**
   同一模块被多张卡片实例共享（模块级变量只有一份）⇒ 用 `cardId` 做 key 存状态，
   换卡即换轮，不会串上一轮的名单。

4. **`ctx.appendWake` 要用在刀刃上**
   它会把一段文本写进会话**并唤醒一次 AI 回合** —— 所以只在**真正出结果的那一刻**调
   （结算 / 超时），高频点击里绝不要调（烧 token）。失败要包 try/catch，别拖累卡片流程。

## 完整契约

- 模块钩子与 `ctx` 全量能力：见插件包内 `dist/features/botplay-ext.ts` 头部注释，
  或在线文档《用户手册》的「🤖 botplay 自定义事件」一章
- 宿主服务（想用 `ctx.kernel` / `env.ctx` 玩更花的）：见 `docs/host-services.md`
