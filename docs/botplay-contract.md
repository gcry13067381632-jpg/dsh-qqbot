<!-- botplay「自定义事件」契约正文。点面板「🤖 让 AI 写」时会被拼进提示词发给会话。 -->
<!-- 占位符由 settings-host.js 的 botplayContractLines() 运行时替换： -->
<!--   {{EXT_DIR}} 模块目录(数据根下)   {{EVENTS_FILE}} 事件登记文件   {{NS}} 账号实例 id -->
<!-- 改本文件即改契约（不必动 settings-host.js）；改完重启宿主生效。 -->
<!-- 格式：一行 = 契约里的一段文本，顺序即渲染顺序。 -->

1) 模块文件放：{{EXT_DIR}}\\<文件名>.mjs（文件名只能用字母/数字/._@- ; 必须 .mjs/.js/.cjs）
   这个目录在**数据根**下（不是插件包内），插件升级/重装都不会覆盖主人的扩展。
2) 模块用 ESM 导出钩子（export default {...} 或具名导出都行；至少要有一个钩子）：
   export default {
     name: "签到统计",
     onInit(ctx)            {},  // 卡片实例首次加载时调一次：注册按钮/初始化
     onClick(ctx, info)     {},  // 某按钮被点击：info={buttonId,buttonLabel,clickedBefore}；返回非空字符串=回给点击者
     onTick(ctx)            {},  // 可选：预留钩子(当前版本框架不调用, 写了不会被触发)
     onExpire(ctx)          {},  // 可选：卡片超时被回收时
     onDispose(ctx)         {},  // 可选：卡片关闭/热重载/插件卸载时收尾
   };
3) ctx 能力（够用就好，别过度设计）：
   · ctx.event   = {id,name,file,maxClicks,expireSec,scope,peerId}  事件元信息(只读)
   · ctx.cardId  = 本卡片实例 id(只读)
   · ctx.user    = {openid,name,pureName,isOwner}  点击人（onInit 里 openid 为空、isOwner=false）
   · ctx.owners  = 主人 openid 白名单数组（判定"只有主人能点"用 ctx.user.isOwner 或 ctx.owners.includes(...)）
   · ctx.card()  = {contentText, buttons, buttonsPerRow, dirty}  读写本实例卡片正文与按钮；
                   buttons 每项 {id,label,visitedLabel,style,botAction:{type:"reply_text"|"jump_url",text,url}}；
                   **动过按钮/正文就把 dirty 置 true**（框架随后自动重发卡片刷新按钮，比如"已签到"状态）。
   · ctx.emit(text, at?)  发普通文本到本卡片所在会话（at 可传 openid / openid[] 来 @ 人；文本里也可写 <@openid>）
   · ctx.markdown(md)     发 markdown（卡片正文那种富文本）
   · ctx.image({url}|{localPath})  发图片
   · ctx.store.load() / ctx.store.save(obj)  持久化自有状态（落 \\data\\<文件名>.json，升级不丢）
   · ctx.getMember(openid) / ctx.clickCount(buttonId?)  查昵称 / 查本卡片该按钮被点次数
   · ctx.clicked  本次点击前该按钮已被点次数；ctx.log(...)  写日志（面板可见）
   · ctx.reloadSelf()  热重载自己（一般不用，面板有按钮）
   · ctx.appendSilent(text)  **静默进 AI 上下文**：把 text 作为一条用户消息写进本会话，**不唤醒** AI。
                             AI 下一轮自然能看到（适合「记录一下刚才发生了什么」）。
   · ctx.appendWake(text)    **记录并唤醒 AI**：写进会话后**触发一次 AI 回合**（它会回话/干活）。
                             ★★ 这是【万能钥匙】★★ —— AI 手里拿着插件的**全部工具**：
                             发富媒体(图/文件/语音)、禁言、查群成员、入群审批、定时任务、
                             群发/分组、图库、会话列表与唤醒、搜网页、读写文件、跑命令……
                             所以：**模块自己做不到、或做起来很绕的事，写句话让 AI 去做就行**。
                             例：ctx.appendWake('请把这次签到结果整理成一张表格发到群里')
                             ⚠️ 会消耗 token，别在高频点击里无脑调。
   · 模块还能用什么：模块是 .mjs、跑在宿主 Node 进程里 ⇒ 可以 import node:fs / node:child_process / fetch，
                     **自己就能读写文件、跑命令、联网**（这是能力也是风险：只跑自己信任的代码）。
                     需要「经 AI」才能做的（识图/搜网页/开浏览器/用插件工具）⇒ 走 ctx.appendWake。
   · ctx.api(path, {method, body})  【带 token 的官方 API 调用】—— 模块自己 fetch 拿不到
                     appSecret，所以由框架代拿 access_token（带 per-appId 缓存 + 并发单飞）。
                     path 不含 host，形如 /v2/groups/{group_openid}/members/{member_openid}；
                     method 默认 GET，可 GET/POST/PATCH/DELETE；body 是普通 JSON 对象。
                     返回 { ok:true, data } 或 { ok:false, err:{code,human} }（human 已是人话）。
                     例：查某人昵称 ——
                       const r = await ctx.api(`/v2/groups/${gid}/members/${mid}`);
                       if (r.ok) nickname = r.data.username;
                     ⚠️ 官方未开放的接口会返回错误码（如 11253=无权限），自己判 err.code，别当异常。
                     ⚠️ 需要 groupAdmin.enabled=true（否则返回 NO_CLIENT）。
   · ctx.appId / ctx.appSecret  ★【钥匙】★ —— 卡片是代码，所以直接把 bot 凭证给你：
                     拿它自己换 access_token，就能调任意官方接口（不经宿主/插件）。
                     例：
                       const tok = await (await fetch("https://bots.qq.com/app/getAppAccessToken", {
                         method: "POST", headers: { "content-type": "application/json" },
                         body: JSON.stringify({ appId: ctx.appId, clientSecret: ctx.appSecret }),
                       })).json();   // -> { access_token, expires_in }
                       const j = await (await fetch("https://api.bot.qq.com/v2/groups/" + gid + "/members/" + mid, {
                         headers: { authorization: "QQBot " + tok.access_token },
                       })).json();   // -> { username?, code? }
                     ⚠️ token 约 2 小时有效，自己缓存（模块级变量即可）；
                     ⚠️ 未开放接口返回 code（如 11253=应用无接口访问权限），自己判、别当异常。
   权限：QQ 客户端侧的按钮权限由事件 JSON 的 perm 决定（建议 all=谁都能点），
         "这个按钮谁能点"由模块自己在 onClick 里判 isOwner/owners 后决定（例如结束按钮非主人就 ctx.emit 提示无权限）。
4) 登记事件：编辑 {{EVENTS_FILE}}/botplay-events.json'}（ns={{NS}} 那个数据根），在 events 数组里加：
   { "id": "checkin-stats", "name": "签到统计", "file": "checkin-stats.mjs", "expireSec": 3600,
     "maxClicks": 0, "perm": { "type": "all", "userIds": [] }, "buttonsPerRow": 1 }
   ⚠️ buttons 可以留空数组 —— 按钮由模块 onInit 里 ctx.card().buttons 提供(少了也能回落成空)。
5) 改完怎么生效：
   · 面板：选中该事件 → 点「🔄 重载模块」（热重载，不用重启任何东西）→ 群里发 /botplay <事件id> 重新发卡
   · 或群聊里发斜杠命令触发；模块报错会显示在面板红色摘要里，也会落 botplay-ext.log
【botplay 自定义事件 · 写作请求】
── 参考资料 ──
── 如何注册成 botplay 事件 ──
── 环境信息 ──
bot appId: ${appId || '未配置'}
主人 openid: ${masterOpenid || '未配置'}
appSecret: ${hasSecret ? '已配置（位置：设置 → QQ 机器人）' : '未配置'}
数据根 dataRoot: ${dataRoot || '未配置'}
事件登记文件: {{EVENTS_FILE}}
当前会话: ${scope === 'group' ? '群' : '私聊'} ${peerId}
── 要求 ──
请按上面的契约写一个可直接用的自定义事件模块（写进 ${extDir || '{{EXT_DIR}}'}），并在 botplay-events.json 里登记对应事件（id/name/file）。
写完自己核对一遍语法；可以用 /botplay 事件id 在群里发卡试一下, 或让主人去面板点「🔄 重载模块」后再发卡。
content-type
content-length
cache-controlno-store
accept-rangesbytes
