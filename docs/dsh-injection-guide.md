# dsh 0.1.5 动态提示词注入经验（参考文档）

> 2026-09-11 考古定稿。解决「升级 dsh 到 v0.1.5-rc.1 后，群守则（可编辑指令）注入失效，AI 感知不到」的完整结论与可行实现。
> 适用：任何想在 dsh 0.1.5 运行时把「动态、可热更新、按会话/agent 分流」的指令注入模型上下文的插件作者。

---

## 1. 背景

旧版 dsh-qqbot 用 `ctx.systemPrompt.context()` 注入群守则，升级 dsh 0.1.5 后彻底失效：
- system/message 里只有「人设」（persona），群守则/探针内容 0 命中；
- 反复试过 `section()`（agent scope / 宿主 scope）、`context()`（agent scope / 宿主 scope），AI 都感知不到。

## 2. 考古结论（为什么 section / context 不行）

### 2.1 persona 是 complete section → 运行时 section 全被丢弃

`dsh-persona` 用 `ctx.systemPrompt.section({ name: PERSONA_PREFIX/SUFFIX, ... })` 注册人格。
`SystemPrompt.assemble()` 末尾逻辑（`@deepseek-ai/dsh-system-prompt`）：

```
if (completeSection === void 0 && !runtimeContextSuppressed) return transformed;
return { ...transformed, sections: completeSection === void 0 ? transformed.sections : [completeSection], ... }
```

即：**只要存在一个 `complete: true` 的 section（persona 往往是），assemble 后 sections 只保留它**，
运行时注册的任何其他 section（探针/群守则/记忆纪律）**全被丢弃**。
→ 会话日志的 system/message 永远只有人设。**这是 section 注入在 0.1.5 下失效的根本原因。**

### 2.2 context() 快照链路实际不记录

`systemPrompt.context()` 注册的贡献会进入 `assembly.contexts`，但 agent-loop 用
`RuntimeContextProjection.project()`（`dsh-agent-loop`）把它变成持久 user-role 快照时，
**实测不触发**：会话 user/message 里没有任何注入快照（只出现在 AI 自己的工具/回复里）。
因此 context() 在 0.1.5 下也不可靠。

> 记忆插件「能看到记忆上下文」可能是其另一条注入路径（工具/侧边栏/agent 会话注入），
> 不是 systemPrompt.context 快照。

### 2.3 正解：agent/pre-step 直注（官方 agent-instructions 模式）

官方 `@deepseek-ai/dsh-agent-instructions`（deepseek-harness/packages/context/agent-instructions）
**不用** systemPrompt.section/context，而是：

```ts
ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next) => {
  const decision = await next()
  // ...构造带来源的 user message(createUserMessage, 带 source.kind)
  // 去重: 本次 messages 或会话 surface 已有同内容 → 靠 KV cache, 不重复
  // 折入: 紧随 claimed batch 之后
  const lastClaimedIndex = decision.messages.findLastIndex(m => messages.includes(m))
  const entered = decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired)
  return { ...decision, messages: entered }
})
```

要点：
- `agent/pre-step` 是 agent-loop 的 waterfall，payload 带 `{ agent, messages, turn, step, signal }`；
- 折入的 user message **直接进模型请求**（绕开 assemble 的 complete 过滤），随后被 append 成
  持久 user/message 历史；
- **去重靠 KV cache**：同 ns+同内容在本次 messages 或 surface 历史里已有 → 不重复注入，
  模型从历史读取（KV cache 命中）；内容变化（热更新）→ 注入新版。
- 每条注入带 `<system-reminder> ... </system-reminder>` 包装，AI 感知为系统提醒。

## 3. 三种注入方式对比（0.1.5）

| 方式 | 是否被 complete 过滤 | 是否进模型请求 | 结论 |
|---|---|---|---|
| `systemPrompt.section()`（运行时） | ✅ 被过滤（只留 persona） | 否 | ❌ 不可用 |
| `systemPrompt.context()`（快照） | 不过滤 | 实测不记录 | ❌ 不可用 |
| `agent/pre-step` 直注（user/message） | 无关（直接折入请求） | ✅ | ✅ **正解** |

## 4. dsh-qqbot 实现要点（session-manager.ensureGroupRules）

- **宿主根 ctx 监听** `agent/pre-step`（`(this.ctx.root ?? this.ctx).on(...)`），幂等只装一次；
- **cwd 分流（通用，不写死实例名）**：只对本实例 `config.cwd` 匹配的 agent 注入本实例
  `config.settingsNs` 的群守则；其他 agent（别的实例/项目/web）一律不注入：
  ```ts
  private nsForCwd(cwd: string): string {
    const selfCwd = String(this.config.cwd ?? '').trim().replace(/[\\/]+$/, '')
    const ns = String(this.config.settingsNs ?? '').trim() || 'im-qqbot'
    if (!selfCwd) return ns
    const norm = String(cwd ?? '').replace(/[\\/]+$/, '')
    if (norm === selfCwd || norm.startsWith(selfCwd + '\\') || norm.startsWith(selfCwd + '/')) return ns
    return ''
  }
  ```
- **热更新**：每回合现读 `settings.yaml` 对应 ns 的 `groupPrompt`（SettingsReader fresh 读）；
- **固定规则 + 群守则** 拼成一条 `<system-reminder>` user message；
- **去重**：本次 messages 或会话 surface 已有同 ns+同内容 → 靠 KV cache 不重复；变了才注入新版；
- **安全**：整个 pre-step 回调 try/catch，任何异常都原样返回 decision，绝不破坏请求。

## 5. 参考源码

- `deepseek-harness/packages/context/agent-instructions/src/index.ts`（正解模板）
- `deepseek-harness/packages/core/system-prompt/src/index.ts`（complete section 过滤逻辑）
- `@deepseek-ai/dsh-agent-loop`（agent/pre-step 事件、RuntimeContextProjection）
