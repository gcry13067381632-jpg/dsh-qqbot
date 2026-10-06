# 宿主服务清单（写扩展时 `env.ctx.get('…')` 能拿到什么）

> 这份清单是**从 dsh 源码里 harvest 的真实服务名**（`ctx.get("…")` 的所有出现），
> 不是猜的。供 `.qqbot-extensions/` 里的**你自己写的扩展**参考。
>
> 拿到 `ctx` 的入口：
> - 扩展工具 `tools/*.mjs` → `env.ctx`
> - 自定义命令 `commands/*.mjs` → `env.ctx`（v1.7.1+）
> - botplay 卡片 `botplay/*.mjs` → `ctx.kernel`（v1.7.1+；因为卡片那个对象自己就叫 `ctx`）
>
> ⚠️ 三条代价（详见《用户手册》）：① 形状跟随 dsh 版本，升级可能失效 —— **成品能力才是主路，
> `ctx` 是逃生舱**；② `register`/`on` 返回的 disposer **要自己收尾**，否则热重载会累积；
> ③ 全权限，别把 `ctx` 转手给不信任的代码。

## 怎么用

```js
// 探测某个服务在不在（拿不到返回 undefined，不会抛）
const sessions = env.ctx?.get?.('sessions');
if (sessions) { /* 用它 */ }
```

```js
// 一眼看清"本机此刻有哪些服务可用"
const ctx = env.ctx ?? env.kernel;
for (const n of ['sessions','tools','webServer','workspaceRegistry','llm','skills','jobs']) {
  console.log(n, ctx?.get?.(n) ? '✅' : '❌');
}
```

## 最常用的（写 QQ 扩展时优先看这些）

| 服务名 | 大致用途 |
|---|---|
| `sessions` | **会话服务**：读/建会话、拿会话对象（`session.append` 等） |
| `tools` | **工具注册表**：`ctx.get('tools').register(def)` 给 AI 加一个工具 |
| `webServer` | **注册 HTTP 路由**：`register({ kind:'exact', path, handler })`（面板/网页能点的那种） |
| `agents` | agent 注册表 |
| `sessionPersistence` | 会话持久化（列会话、读 header，**做批量体检/统计很有用**） |
| `sessionQuery` / `sessionTitle` | 会话查询 / 标题 |
| `llm` | LLM 调用面 |
| `settings` | 设置服务 |
| `approval` | 审批流（配合 QQ 远程审批） |
| `userQuestions` | AI 向用户提问（配合 QQ 答题卡） |
| `skills` | 技能（skills）注册/查询 |
| `subagents` | 子代理 |
| `jobs` | 后台任务 |
| `workspaces` / `workspaceFiles` | 工作区（侧边栏分组就是它） |
| `fs` / `shell` / `subprocess` | 文件/终端/子进程（也可以直接用 `node:fs` 等） |
| `credentials` | 凭据 |
| `sandbox` / `sandboxPolicy` / `permissionPresets` | 沙箱与权限策略 |
| `slots` | **UI 槽位**（client 侧用；插件往面板塞自定义区块） |
| `theme` / `locale` | 主题 / 语言 |
| `tokenMeter` | token 计量 |
| `loader` / `modules` / `pluginManager` / `pluginPackages` | 插件体系自身 |

## 完整清单（59 个，harvest 自 dsh 源码）

```
agentDefaultModel  agentPresets  agents  appExit  appReady  approval  attachments
chatFileMentions  cmdlineArgs  commandUi  configEditor  connection  conversation
credentials  deepseekAccount  deepseekLlmApiExtensions  feedbackUi  fs  inputTriggers
jobs  launchEnvironment  llm  loader  locale  modules  permissionPresets  pluginManager
pluginPackages  productAnalytics  profileContext  ptcRuntime  sandbox  sandboxPolicy
sessionPersistence  sessionProjectionCache  sessionProjections  sessionQuery  sessions
sessionTitle  settings  shell  sidebarRightTabs  skills  slots  spillStore
subagentModelSelection  subagents  subprocess  systemPrompt  theme  tokenMeter
toolResultPruner  tools  typertGateway  uiConversation  uiWorkspace  userQuestionPanels
userQuestions  webServer  workspaceFiles  workspaces
```

## 几个上手例子

```js
// ① 给 AI 新增一个工具（注册后 AI 就能调）
const dispose = env.ctx.get('tools')?.register({
  name: 'my_tool',
  description: '我自己的工具',
  schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
  async execute(args) { return { ok: true, msg: '收到 ' + args.text }; },
});
// ⚠️ dispose 要自己收尾（插件卸载/热重载时调用）

// ② 开一个自己的 HTTP 路由（配成面板能点的）
env.ctx.get('webServer')?.register({
  kind: 'exact', path: '/api/my-ext/ping',
  handler: (req, res) => { res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); },
});

// ③ 列最近会话（做统计/体检）
const list = await env.ctx.get('sessionPersistence')?.list?.();
```

## 和「成品能力」怎么选

| 你要做的事 | 用哪个 |
|---|---|
| 发消息 / 发图 / 发卡片 | **`env.markdown` / `env.image` / `env.markdownCard`**（成品，推荐） |
| 调官方 QQ 接口 | **`env.api(path)`**（成品，自带 token） |
| 存一点状态 | **`env.store.load/save`**（成品，升级不丢） |
| 进 AI 上下文 | **`env.appendSilent` / `env.appendWake`**（成品，带安全守卫） |
| 重启宿主 | **`env.restart()`**（成品，复用内置 `/bot-restart`） |
| 上面都没有的事儿 | **`env.ctx`（遥控器）** —— 逃生舱 |

> 成品能力**不会因为 dsh 升级而失效**；`ctx` 会。所以能用成品就别动遥控器。
