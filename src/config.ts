/**
 * dsh-im-qqbot 插件配置 Schema
 *
 * 配置入口: profile 的 cordis.patch.yml → im-qqbot config(改动热重载, 无需重启)。
 * Web 可视化设置: 注册 im-qqbot settings 命名空间(可编辑项 = EditableConfigSchema:
 * behavior / sticker.gates / injectRules), 用户层存 ~/.dsh/settings.yaml, live 生效。
 * ⚠️ 本地手改功能(配置化改造, 2026-09-03)。
 */
import Schema from '@deepseek-ai/schemastery';

export interface AccessControlConfig {
  /** C2C 访问模式 */
  c2cMode: 'open' | 'allowlist' | 'disabled';
  /** C2C 白名单（user openid） */
  c2cAllow: string[];
  /** 群聊访问模式 */
  groupMode: 'open' | 'allowlist' | 'disabled';
  /** 群聊白名单（group openid） */
  groupAllow: string[];
}

/** 延迟聚合(debounce)配置 — 独立于群冷却的另一套机制 */
export interface DebounceConfig {
  /** 总开关。true=消息先进"待派发窗口", 静默/攒够才一次派发; false=关(走原逻辑) */
  enabled: boolean;
  /** 最近说话者停止发言多少秒后触发一次派发(默认3)。0=不停顿(立即派发, 等效关掉静默等待) */
  silenceSec: number;
  /** 窗口内消息攒满多少条立即触发(默认10), 不等人停 */
  maxMsgs: number;
  /** @bot 消息是否也走延迟(默认true)。false=@到秒回(不聚合) */
  mentionDelayed: boolean;
}

/** 回复调度(冷却)配置 */
export interface BehaviorConfig {
  /** 群普通(未@)消息回复最小间隔(秒)。0=不限制; 默认60 */
  freeIntervalSec: number;
  /** 被@消息回复最小间隔(秒)。0=@总是立即回 */
  mentionIntervalSec: number;
  /** 私聊(C2C)回复最小间隔(秒)。0=不限制 */
  directIntervalSec: number;
  /** 延迟聚合(防连发只回第一句; 与上面三项冷却互不干扰) */
  debounce: DebounceConfig;
}

/** 表情包主动发送闸门(默认不限制; 总开关 enabled=false 一票关闭) */
export interface StickerGatesConfig {
  enabled: boolean;
  perTurnMax: number;
  perWindowSec: number;
  maxPerWindow: number;
  dailyBudgetPerGroup: number;
  dupTTLHours: number;
  activityWindowSec: number;
  activityMinMsgs: number;
  bannedGroups: string[];
  libRoots: string[];
}

export interface StickerConfig {
  /** 是否自动收藏群图片（默认开，只存本地不外发） */
  collectEnabled: boolean;
  /** 图库数据根目录（默认 {agent cwd}/表情包） */
  dataDir: string;
  /** 主动发送闸门(默认不限制) */
  gates: StickerGatesConfig;
  /** 新图自动打标总开关 */
  autoTagEnabled: boolean;
  /** 视觉CLI命令模板(含{img}占位); 空=自动探测本机视觉CLI(modlens等); 探测不到则不自动打标 */
  visionCli: string;
}

/** 条件注入规则 */
export interface InjectRuleConfig {
  id: string;
  name?: string;
  enabled: boolean;
  conditions: {
    hasImage: boolean;
    hasLink: boolean;
    contentRegex: string;
    contentKeywords: string[];
    matchScope: 'any' | 'all';
  };
  prompt: string;
}

/** 定时唤醒时刻任务(M3): 一条时刻记录, 挂在某个目标(群/人)下面 */
export interface ScheduledWakeTask {
  id: string;
  /** 每天触发时刻, 24h 本地时区 "HH:MM" */
  time: string;
  enabled: boolean;
  /** 可选: 指定这次想让她聊的方向(空=自由发挥) */
  prompt?: string;
}

/** 定时唤醒目标(M3): 一个群/一个人, 号码只填一次, 下面挂多条时刻任务(分组) */
export interface ScheduleTargetConfig {
  id: string;
  /** 可选: 显示名/备注(帮认这个群/人) */
  name?: string;
  /** 目标会话: group=群(group_openid) / c2c=私聊(用户 openid) */
  scope: 'group' | 'c2c';
  targetId: string;
  tasks: ScheduledWakeTask[];
}

export interface ScheduleConfig {
  targets: ScheduleTargetConfig[];
}

// ── botplay 互动事件装配器(2026-09-08, 设计见 参考文档/botplay互动事件装配器_设计完整稿.md) ──

/** botAction 行为类型: reply_text=回指定文本 | jump_url=跳转(官方action.type=0) | callback=仅回调结算无bot回复 | command=点击执行斜杠命令(host侧直发) */
export type BotplayActionType = 'reply_text' | 'jump_url' | 'callback' | 'command';

/** llmEffect.mode 三档: no_append=纯bot行为AI不知 / append_silent=记录不唤醒 / append_wake=记录并唤醒AI */
export type BotplayEffectMode = 'no_append' | 'append_silent' | 'append_wake';

/** perm.type: all=所有人 / triggerer=仅触发者本人 / owner=主人白名单 / users=指定openid列表 */
export type BotplayPermType = 'all' | 'triggerer' | 'owner' | 'users';

/** 一个按钮的完整定义 */
export interface BotplayButtonConfig {
  /** 按钮 id(回调 data 编码 事件id::按钮id; 建议 [a-zA-Z0-9_-] 避免分隔符冲突) */
  id: string;
  /** 按钮显示文字 */
  label: string;
  /** 点击后显示文字(visitedLabel), 留空=label */
  visitedLabel?: string;
  /** 0灰 1蓝 */
  style?: number;
  /** 点击后 bot(非LLM)直接做什么 */
  botAction: {
    type: BotplayActionType;
    /** reply_text 用(文本); command 用(斜杠命令名, 如 bot-status) */
    text?: string;
    /** jump_url 用 */
    url?: string;
  };
  /** 点击事件对 LLM 的影响(自定义三档) */
  llmEffect?: {
    mode: BotplayEffectMode;
    /** 自定义记录文本模板, 支持 {label} 占位; 空=默认可读描述 */
    contextText?: string;
  };
}

/** 一个可装配互动事件 */
export interface BotplayEventConfig {
  /** 事件唯一 id(斜杠触发用; 建议 [a-zA-Z0-9_-]) */
  id: string;
  /** 显示名(/botplay 列表显示) */
  name: string;
  /**
   * 卡片正文 markdown 模板(2026-09-10 M4): 支持 {name} 占位;
   * 空=默认模板(## 🎮 事件名 + 固定引导文案)。
   * 可嵌网络图 ![text #wpx #hpx](url); 按钮点击回调由按钮配置驱动。
   */
  contentText?: string;
  /** 接受点击数: 0=不限; N=单次触发实例最多点 N 次(点满失效) */
  maxClicks?: number;
  /** 发卡后有效期(秒): 超时按钮不再受理 */
  expireSec?: number;
  /** 每行几个按钮(Phase2: 1~5, 默认1=竖排; QQ 上限 5行×5钮) */
  buttonsPerRow?: number;
  /** 权限自定义(默认 all; triggerer=仅触发者本人) */
  perm?: {
    type: BotplayPermType;
    /** users 时填 openid 列表; owner 时可用(留空=取群主白名单) */
    userIds?: string[];
  };
  buttons: BotplayButtonConfig[];
}

/** QQ 群管理(2026-09-05): 总开关 + 主人 openid 白名单(空=不校验; 建议填主人与常用小号) */
export interface GroupAdminConfig {
  enabled: boolean;
  owners: string[];
  /**
   * 对话内"默认管理群"(group_openid): QQ 群会话里工具取当前群;
   * web/非群会话时工具回退用它 —— "对话里管一个群"不依赖会话形态(2026-09-05 主人定)。
   * 多群管理走设置 UI ⑥(P3 选群), 此字段只承载对话内单群。
   */
  manageGroup: string;
  /**
   * 订阅入群申请事件(GROUP_JOIN_REQUEST, intent GROUP_MEMBER_EVENT 1<<24)。
   * ⚠️ 涉及 gateway intents(连接建立时确定)→ **改后必须重启才生效**, 不是 live 热改。
   * 需要机器人为该群管理员才会推送; 若官方未授权该 intent, 连接可能被拒(4914/4915)。
   */
  watchJoinRequests: boolean;
  /** 收到新入群申请事件时是否在该群内发一条 bot 提醒消息(默认开; 需机器人=该群管理员) */
  notifyInGroup: boolean;
  /**
   * 群组管理器会话 id(2026-09-09 M2): 该机器人各群的"群事件"(入群申请/新成员加入/机器人被拉群)
   * 汇总注入到这一个会话(dock 群组管理 tab 一键设为当前 web 会话; 该会话须绑定某 QQ 群/私聊,
   * 注入姿势=whenIdle 回合空闲后 append user/message 不唤醒 —— web 流可见、不坏聊天记录)。
   * 配置了且注入成功 → 不再在该群内发提醒(统一收 hub, 避免重复打扰)。
   */
  hubSessionId: string;
  /** 群事件转发到群组管理器的开关(默认开; 置 false 后只在原群内提醒) */
  hubNotify: boolean;
  /**
   * 入群申请轮询(2026-09-09 主人定, 事件驱动的兜底):
   * 事件订阅依赖"机器人为群管理员"且可能漏推; 轮询定时拉取各群审批列表,
   * 攒够 minCount 个待审批就唤醒 LLM(伪造【审批轮询】入站消息走 handleInbound),
   * AI 按主人指令通过/拒绝 —— 不自动批, 唤醒后听主人的。
   */
  pollJoinRequests: {
    enabled: boolean;
    /** 轮询间隔(分钟), ≥1 */
    intervalMin: number;
    /** 待审批数 ≥ 此值才唤醒(攒批防打扰) */
    minCount: number;
    /** 达到阈值后是否唤醒 LLM(伪造入站消息; false=只落盘/通知, 不唤醒) */
    wakeLlm: boolean;
    /** 轮询到待审批时是否注入群组管理器会话(web 可见) */
    hubNotify: boolean;
    /** 是否同时在原群(普通群会话)发提醒。false=只注入群组管理器会话, 普通群不打扰 */
    notifyGroup: boolean;
    /** 是否唤醒普通群(申请所在群)会话的 AI(2026-09-11 主人要求与唤醒群管 AI 分开设置) */
    wakeGroup: boolean;
  };
}

/** Web 设置可编辑子集(不含 appId/appSecret 等敏感/底层字段) */
export interface EditableConfig {
  /** 插件数据根目录(可选; 缺省=cwd): 表情包/.qqbot/.qqbot-extensions 统一挂其下, 与工作区其他文件分离 */
  dataRoot?: string;
  behavior: BehaviorConfig;
  groupAdmin: GroupAdminConfig;
  sticker: {
    gates: StickerGatesConfig;
    /** 新图后台自动识图打标(消耗视觉额度; 默认关, 开=后台自动) */
    autoTagEnabled?: boolean;
    /** 视觉引擎命令模板(留空自动探测) */
    visionCli?: string;
  };
  injectRules: InjectRuleConfig[];
  /** 图片消息是否自动追加「看图」内置提示(默认 true)。关掉=不再注入「请把 URL 传给识图工具」那条
   *  —— 模型自己就能读图时可以关它。 */
  imageHint?: boolean;
  /** 引用消息总开关(默认 true): 开=入站消息带短消息号(台账索引) + 引用消息附原文 + 注入引用指令, 出站支持 [rf:短号] 标签 */
  messageReference?: boolean;
  /** 群聊常驻守则(默认含表情包礼仪; QQ 通道级注入, 跨 preset 不碰 persona) */
  groupPrompt?: string;
  /** 定时唤醒任务(M3) */
  schedule: ScheduleConfig;
  /** QQ 远程审批开关(live 热生效: 对"保存后的新审批请求"即时生效, 无需重启) */
  enableApprovals?: boolean;
  /** QQ 权限申请等待时长(ms), 超时自动拒绝 */
  approvalTimeoutMs?: number;
  /** 出站模式: adaptive=适配主动(默认; 前5次带msg_id被动回复后自动转主动), detail=详细主动(adaptive 发送行为 + 额外推送工具调用/结果), passive=全被动回复, silent=完全不出站(思考但不发), nothink=完全不思考(QQ入站不唤醒LLM, 仅记录; 仅设置页可配防自锁) */
  outboundMode?: 'adaptive' | 'active' | 'passive' | 'detail' | 'silent' | 'nothink';
  /** botplay 互动事件列表(dock「🎮 互动事件」装配器编辑; live 热更, 无需重启) */
  botplayEvents: BotplayEventConfig[];
}

/**
 * 群聊默认常驻守则(表情包礼仪, P2 品味层)。
 * 由 qqbot 通道注入 agentBody(scope=group 时), 所有走 QQ 的 preset 通用, 不修改任何 persona。
 */
export const DEFAULT_GROUP_PROMPT = [
  '【表情包礼仪】你有一座本地表情包库(群友存的图,带标签)。想用表情包回应时先调 list_stickers 搜库,命中后再用 send_media 发出,别发没把握的图。',
  '只在群里正热闹、情绪正浓时,才在回复末尾附 0~1 张:满屏哈哈/笑死(爆笑)、大家"确实/我也是"(共鸣)、有人抛梗你能接住(接梗)、有人当面夸你(被夸)、轻度吐槽可以接治愈/滑稽图。',
  '绝不发:冷场没人接话、正事/技术问答/找资源、吵架互怼中、对方难过或聊严肃事、私聊。',
  '出手前自检,缺一不发:①库里有 9 成贴切的图;②发出来群友会心一笑;③这轮没发过、今天这群没刷过图。',
  '把图删掉话照样完整;一次最多一张;发离谱/冒犯/色气/羞辱人的图=人设崩塌,永远不许。',
  '【提问卡片(ask_user_question)·QQ】在 QQ 会话里调用 ask_user_question 提问:选项会以按钮卡片发出,可点权限默认只绑「当前对话发起者本人」(群聊=刚与你对话的那位群友,私聊=对方),只有 TA 能点、别人点了会被拒,不会误答;同一问题会同步出现在 Web 浮层,任一端作答即结算、另一端自动失效。**可以显式指定某位群友来答(指定权限)**:把 <@对方openid> 直接写进本次提问的 question(或 header)文本里(例如 question 写成「<@对方openid> 要帮你找这个游戏吗?」),卡片权限就会精确绑给该 openid——只有 TA 能点;也可以先按【@ 人的方法】点名 TA 再提问(效果相同)。不确定该问谁、或想让对方自己答时才不写(保持默认给当前对话者)。',
].join('\n');

/**
 * 通道固定注入上下文(2026-09-09): 与可编辑群守则(groupPrompt)无关、无条件注入每个 QQ 会话,
 * 保证任何 AI/任何预设都会收到 QQ 通道的基础使用规则(即使群守则被清空/覆盖)。
 */
export const FIXED_CHANNEL_CONTEXT = [
  '【@ 人的方法】当你要对特定某人说话，在回复文本里直接写 <@对方openid>（无斜杠）就能在 QQ 群里 @ 到对方（高亮显示），例如 <@0123456789ABCDEF0123456789ABCDEF> 起床啦。如果别人@你，你用 @对方 回复；也可以主动 @别人。',
  '【富媒体】你在 QQ 里能真的发图/文件/语音/视频:在回复正文里写 MEDIA:image|路径(两端加英文方括号)即发图,file/voice/video 同理,标记不显示;想撤回自己的消息单独输出一行 RECALL(两端加英文方括号)。',
].join('\n');

/**
 * 引用消息能力说明(2026-09-13 主人定; 短消息号版): 开启 messageReference 时随群守则一起注入。
 * 教 AI ①入站消息带短"消息号"(如 #0913a) ②出站用 [rf:消息号] 引用对方。
 */
export const REFERENCE_CONTEXT = [
  '【引用消息】本群已开启引用能力(可在设置关闭): 每条入站消息都带一个"消息号"(形如 #0913a, 很短)。',
  '想让自己的回复"引用"某条消息: 在回复正文里写 [rf:消息号](两端加英文方括号), 如 [rf:0913a] —— 这条回复就会以"引用"形式发出, 对方能看到你引用了他那条消息。消息号就是入站消息标签里 # 后面那一小串。',
].join('\n');

// ── 共享字段子 schema(主 ConfigSchema 与 EditableConfigSchema 复用) ──

const debounceSchema = Schema.object({
  enabled: Schema.boolean().default(true).description('延迟聚合总开关(防"连发N句只回第一句": 消息先攒窗口, 人停口或攒够条数才一次综合回)'),
  silenceSec: Schema.number().min(0).default(3).description('最近说话者停止发言几秒后开口(默认3; 0=不停顿)'),
  maxMsgs: Schema.number().min(1).default(10).description('窗口攒满几条立即开口(默认10), 不等对方停'),
  mentionDelayed: Schema.boolean().default(true).description('@bot 消息是否也走延迟(默认是; 不勾=@到秒回)'),
}).default({
  enabled: true,
  silenceSec: 3,
  maxMsgs: 10,
  mentionDelayed: true,
}).description('延迟聚合(独立于冷却的另一套机制)');

const behaviorSchema = Schema.object({
  freeIntervalSec: Schema.number().min(0).default(60).description('群普通消息回复间隔(秒),0=不限制'),
  mentionIntervalSec: Schema.number().min(0).default(0).description('@bot回复间隔(秒),0=立即回'),
  directIntervalSec: Schema.number().min(0).default(0).description('私聊回复间隔(秒),0=不限制'),
  debounce: debounceSchema,
}).default({
  freeIntervalSec: 60,
  mentionIntervalSec: 0,
  directIntervalSec: 0,
  debounce: {
    enabled: true,
    silenceSec: 3,
    maxMsgs: 10,
    mentionDelayed: true,
  },
}).description('回复调度');

const stickerGatesSchema = Schema.object({
  enabled: Schema.boolean().default(false).description('闸门总开关,false=不限制'),
  perTurnMax: Schema.number().min(0).default(0).description('每轮最多发送张数,0=不限'),
  perWindowSec: Schema.number().min(0).default(600).description('频率窗口(秒)'),
  maxPerWindow: Schema.number().min(0).default(0).description('每窗口每群最多张数,0=不限'),
  dailyBudgetPerGroup: Schema.number().min(0).default(0).description('每群每日预算,0=不限'),
  dupTTLHours: Schema.number().min(0).default(0).description('同图去重(小时),0=关'),
  activityWindowSec: Schema.number().min(0).default(3600).description('活性窗口(秒)'),
  activityMinMsgs: Schema.number().min(0).default(0).description('活性窗口消息下限,0=不要求'),
  bannedGroups: Schema.array(Schema.string()).default([]).description('禁发群group_openid'),
  libRoots: Schema.array(Schema.string()).default([]).description('表情包路径白名单(追加)'),
}).default({
  enabled: false,
  perTurnMax: 0,
  perWindowSec: 600,
  maxPerWindow: 0,
  dailyBudgetPerGroup: 0,
  dupTTLHours: 0,
  activityWindowSec: 3600,
  activityMinMsgs: 0,
  bannedGroups: [],
  libRoots: [],
}).description('表情包主动发送闸门(默认不限制)');

const injectRuleItemSchema = Schema.object({
  id: Schema.string().required().description('规则ID'),
  name: Schema.string().description('规则名'),
  enabled: Schema.boolean().default(true).description('开关'),
  conditions: Schema.object({
    hasImage: Schema.boolean().default(false).description('消息含图片'),
    hasLink: Schema.boolean().default(false).description('消息含链接'),
    contentRegex: Schema.string().default('').description('正文正则,空=不启用'),
    contentKeywords: Schema.array(Schema.string()).default([]).description('关键词(任一命中)'),
    matchScope: Schema.union(['any', 'all']).default('any').description('any=任一命中;all=全部满足'),
  }),
  prompt: Schema.string().required().max(400).description('注入的系统提示文本(≤400字)'),
});

/** 一条时刻任务(挂在某个目标分组下) */
const scheduleTaskSchema = Schema.object({
  id: Schema.string().required().description('任务ID(唯一)'),
  time: Schema.string().required().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).description('每天触发时刻(24h本地时区 HH:MM)'),
  enabled: Schema.boolean().default(true).description('启用'),
  prompt: Schema.string().description('可选: 想让她聊的方向(空=自由发挥)'),
}).default({
  id: '',
  time: '09:00',
  enabled: true,
  prompt: '',
}).description('定时时刻');

/** 一个目标(群/人), 号码填一次, 下面挂多个时刻 */
const scheduleTargetSchema = Schema.object({
  id: Schema.string().required().description('目标ID(唯一)'),
  name: Schema.string().description('备注名(可选,帮认这个群/人)'),
  scope: Schema.union(['group', 'c2c']).default('group').description('group=群 / c2c=私聊'),
  targetId: Schema.string().required().description('目标: 群group_openid 或 用户openid'),
  tasks: Schema.array(scheduleTaskSchema).default([]).description('该目标下的定时时刻列表'),
}).default({
  id: '',
  name: '',
  scope: 'group',
  targetId: '',
  tasks: [],
}).description('定时目标(群/人)');

const scheduleSchema = Schema.object({
  targets: Schema.array(scheduleTargetSchema).default([]).description('定时目标列表(每个群/人一组,下面挂时刻)'),
}).default({ targets: [] }).description('定时唤醒(M3): 每天固定时刻主动找聊天');

// ── botplay 互动事件(schema, 2026-09-08) ──
const botplayActionSchema = Schema.object({
  type: Schema.union(['reply_text', 'jump_url', 'callback', 'command']).default('reply_text').description('行为类型: reply_text=回指定文本 / jump_url=跳转 / callback=仅结算 / command=点击执行斜杠命令(如 bot-status)'),
  text: Schema.string().default('').description('reply_text: 回复文本; command: 斜杠命令名(不带/, 如 bot-status)'),
  url: Schema.string().default('').description('jump_url: 跳转链接'),
}).default({ type: 'reply_text', text: '', url: '' }).description('按钮 bot(非LLM)动作');

const botplayEffectSchema = Schema.object({
  mode: Schema.union(['no_append', 'append_silent', 'append_wake']).default('no_append').description('LLM 三档影响: no_append=纯bot行为AI不知 / append_silent=记录进上下文不唤醒 / append_wake=记录并唤醒AI'),
  contextText: Schema.string().default('').description('自定义记录文本(支持 {label} 占位); 空=默认「bot 发送了卡片, 用户点击了按钮」'),
}).default({ mode: 'no_append', contextText: '' }).description('点击对 LLM 的影响');

const botplayButtonSchema = Schema.object({
  id: Schema.string().required().description('按钮 id(回调 data 编码 事件id::按钮id; 建议 [a-zA-Z0-9_-])'),
  label: Schema.string().required().description('按钮显示文字'),
  visitedLabel: Schema.string().description('点击后显示文字, 留空=label'),
  style: Schema.number().default(1).description('0灰 1蓝'),
  botAction: botplayActionSchema,
  llmEffect: botplayEffectSchema,
}).default({
  id: '', label: '', visitedLabel: '', style: 1,
  botAction: { type: 'reply_text', text: '', url: '' },
  llmEffect: { mode: 'no_append', contextText: '' },
}).description('按钮');

const botplayPermSchema = Schema.object({
  type: Schema.union(['all', 'triggerer', 'owner', 'users']).default('all').description('权限: all=所有人 / triggerer=仅触发者本人 / owner=主人白名单 / users=指定openid'),
  userIds: Schema.array(Schema.string()).default([]).description('users 时填 openid 列表'),
}).default({ type: 'all', userIds: [] }).description('权限');

const botplayEventSchema = Schema.object({
  id: Schema.string().required().description('事件唯一 id(斜杠 /botplay 触发用; 建议 [a-zA-Z0-9_-])'),
  name: Schema.string().required().description('事件显示名(/botplay 列表显示)'),
  contentText: Schema.string().default('').description('卡片正文 markdown 模板(空=默认模板; 支持 {name} 占位; 可嵌网络图 ![text #宽px #高px](url))'),
  maxClicks: Schema.number().default(0).description('接受点击数: 0=不限; N=单次触发最多点N次(点满失效)'),
  expireSec: Schema.number().default(600).description('发卡后有效期(秒), 超时按钮失效'),
  perm: botplayPermSchema,
  buttonsPerRow: Schema.number().min(1).max(5).default(1).description('每行几个按钮(1~5, 默认1竖排; QQ 上限 5行×5钮)'),
  buttons: Schema.array(botplayButtonSchema).default([]).description('按钮列表(QQ限制: 最多5行)'),
}).default({
  id: '', name: '', contentText: '', maxClicks: 0, expireSec: 600,
  perm: { type: 'all', userIds: [] },
  buttonsPerRow: 1,
  buttons: [],
}).description('botplay 互动事件');

/** Phase1 内置演示事件(仅当用户从未配置时生效; 保存后以用户配置为准) */
const DEMO_BOTPLAY_EVENTS: BotplayEventConfig[] = [
  {
    id: 'checkin',
    name: '签到',
    maxClicks: 0,
    expireSec: 600,
    perm: { type: 'triggerer', userIds: [] },
    buttons: [{
      id: 'b1',
      label: '✅ 签到',
      visitedLabel: '已签到',
      style: 1,
      botAction: { type: 'reply_text', text: '✅ 签到成功 +1 🎉', url: '' },
      llmEffect: { mode: 'no_append', contextText: '' },
    }],
  },
  {
    id: 'fortune',
    name: '今日运势',
    maxClicks: 0,
    expireSec: 600,
    perm: { type: 'triggerer', userIds: [] },
    buttons: [{
      id: 'b1',
      label: '🔮 抽一签',
      visitedLabel: '已抽取',
      style: 1,
      botAction: { type: 'callback', text: '', url: '' },
      llmEffect: { mode: 'append_wake', contextText: '用户点击了「{name}」的抽签按钮, 想看看今天的运势' },
    }],
  },
];

const groupAdminSchema = Schema.object({
  enabled: Schema.boolean().default(false).description('QQ 群管理总开关(入群审批/禁言等; 需机器人为群管理员)'),
  owners: Schema.array(Schema.string()).default([]).description('允许操作的主人 openid 白名单(空=不校验; 群管理操作仅建议主人使用)'),
  manageGroup: Schema.string().default('').description('对话内默认管理群 group_openid(web/非群会话时群工具用它; QQ 群会话自动用当前群)'),
  watchJoinRequests: Schema.boolean().default(false).description('订阅"入群申请"实时事件(GROUP_JOIN_REQUEST)并自动提醒(改后需重启生效)'),
  notifyInGroup: Schema.boolean().default(true).description('收到入群申请事件时, 在该群内发一条 bot 提醒(需机器人=群管理员)'),
  hubSessionId: Schema.string().default('').description('群组管理器会话 id: 各群群事件(入群申请/新成员加入/被拉群)汇总注入此会话(dock 群组管理 tab 一键设置; 须绑定某 QQ 群/私聊)'),
  hubNotify: Schema.boolean().default(true).description('群事件转发到群组管理器(默认开; 注入成功则不再群内提醒)'),
  pollJoinRequests: Schema.object({
    enabled: Schema.boolean().default(false).description('轮询入群申请总开关(事件驱动失效时的兜底: 定时拉取各群审批列表)'),
    intervalMin: Schema.number().min(1).default(5).description('每隔几分钟拉取一次审批列表(最小1分钟)'),
    minCount: Schema.number().min(1).default(2).description('待审批人数≥此值才唤醒 LLM 处理(攒够一批再报, 防打扰)'),
    wakeLlm: Schema.boolean().default(true).description('唤醒【群管会话】AI(注入群组管理器会话并唤醒, AI 起来处理审批)'),
    hubNotify: Schema.boolean().default(true).description('注入群管会话(web 可见, 不唤醒 AI; 与 wakeLlm 互斥——唤醒优先)'),
    notifyGroup: Schema.boolean().default(false).description('通知普通群(申请所在群会话 append 一条, web 可见, 不唤醒 AI)。默认关=普通群不打扰(2026-09-11 修: 原来写死 true 与注释矛盾)'),
    wakeGroup: Schema.boolean().default(false).description('唤醒【普通群】AI(申请所在群会话的 AI 起来处理审批; 2026-09-11 主人要求与唤醒群管 AI 分开设置)'),
  }).default({
    enabled: false,
    intervalMin: 5,
    minCount: 2,
    wakeLlm: true,
    hubNotify: true,
    notifyGroup: false,
    wakeGroup: false,
  }).description('入群申请轮询(事件兜底)'),
}).default({
  enabled: false,
  owners: [],
  manageGroup: '',
  watchJoinRequests: false,
  notifyInGroup: true,
  hubSessionId: '',
  hubNotify: true,
  pollJoinRequests: { enabled: false, intervalMin: 5, minCount: 2, wakeLlm: true, hubNotify: true, notifyGroup: false, wakeGroup: false },
}).description('QQ 群管理');

/** Web 设置页可编辑项的 schema(behavior/sticker.gates/injectRules/groupPrompt/schedule) */
export const EditableConfigSchema: Schema<EditableConfig> = Schema.object({
  dataRoot: Schema.string().description('插件数据根目录(可选; 缺省=cwd): 表情包/.qqbot/.qqbot-extensions 统一挂其下, 与工作区其他文件分离'),
  behavior: behaviorSchema,
  groupAdmin: groupAdminSchema,
  sticker: Schema.object({
    gates: stickerGatesSchema,
    autoTagEnabled: Schema.boolean().default(false).description('新图后台自动识图打标(耗视觉额度,默认关)'),
    visionCli: Schema.string().default('').description('视觉引擎命令模板(留空自动探测)'),
  }).description('表情包图库'),
  injectRules: Schema.array(injectRuleItemSchema).default([]).description('条件注入规则'),
  imageHint: Schema.boolean().default(true).description('图片消息自动追加「看图」内置提示(默认开; 关掉=不再注入那条「把 URL 传给识图工具」)'),
  messageReference: Schema.boolean().default(true).description('引用消息(默认开): 入站消息带短消息号 + 引用消息附原文 + 注入引用指令; 出站支持 [rf:短号] 标签引用对方消息'),
  groupPrompt: Schema.string().default(DEFAULT_GROUP_PROMPT).description('群聊常驻守则(默认含表情包礼仪;可清空关闭)'),
  schedule: scheduleSchema,
  enableApprovals: Schema.boolean().default(false).description('QQ 远程审批: dsh 权限申请发到 QQ, 用 /approve CODE 放行(保存后对新请求生效)'),
  approvalTimeoutMs: Schema.number().default(120000).description('QQ 权限申请等待时长(ms), 超时自动拒绝'),
  outboundMode: Schema.union(['adaptive', 'detail', 'active', 'passive', 'silent', 'nothink']).default('adaptive').description('出站模式: 适配主动(默认)=收到新消息后前5次带msg_id被动回复, 超出/无新消息自动转主动(保连发); 详细主动=与适配主动相同 + 额外把工具调用/工具结果也推到QQ(看进度用, 会更啰嗦); 被动=全程带回复id(连发受QQ上限); 完全不出站=思考但不发(静默); 完全不思考=QQ入站不唤醒LLM(仅记录, 仅设置页可配)'),
  botplayEvents: Schema.array(botplayEventSchema).default(DEMO_BOTPLAY_EVENTS as never).description('botplay 互动事件(dock🎮装配器编辑, 保存即热更; /botplay 触发发卡)'),
});

export interface ImQQBotConfig {
  /** QQ Bot AppID */
  appId: string;
  /** QQ Bot AppSecret */
  appSecret: string;
  /** dsh LLM 提供商名称 */
  provider?: string;
  /** 模型名称 */
  model?: string;
  /** Agent preset id */
  preset?: string;
  /** Agent 工作目录（缺省回落到进程 cwd） */
  cwd?: string;
  /** 插件数据根目录(可选): 表情包/.qqbot/扩展等数据统一挂其下, 不混进 cwd; 缺省=用 cwd(向后兼容)。设 cwd 下子目录(如 cwd/dshqqbot)即可把插件数据与工作区其他文件分开 */
  dataRoot?: string;
  /** Web 设置命名空间(多账号时每个实例唯一, 默认 im-qqbot; 同进程多实例必须互不相同) */
  settingsNs?: string;
  /** 是否启用群消息 @mention 门控 */
  requireMention: boolean;
  /** 群聊常驻守则(默认=表情包礼仪, 通道级注入; 空=关闭) */
  groupPrompt?: string;
  /** 私聊额外 system prompt */
  directPrompt?: string;
  /** 单条消息最大长度（QQ 限制约 5000 字符） */
  textChunkLimit: number;
  /** 是否启用流式输出（群聊始终不启用） */
  streaming: boolean;
  /** 每会话最大闲置时长(ms)，超时自动回收 */
  sessionIdleTimeout: number;
  /** 并发队列最大长度 */
  maxQueue: number;
  /** 处理超时(ms)，超时中断当前 LLM 调用 */
  processingTimeoutMs: number;
  /** 群历史缓冲条数 */
  historyLimit: number;
  /** 访问控制 */
  access: AccessControlConfig;
  /** 回复调度(冷却) */
  behavior: BehaviorConfig;
  /** 表情包图库 */
  sticker: StickerConfig;
  /** 条件注入规则 */
  injectRules: InjectRuleConfig[];
  /** 图片消息是否自动追加「看图」内置提示(默认 true)。关掉=不再注入「请把 URL 传给识图工具」那条
   *  —— 模型自己就能读图时可以关它。 */
  imageHint?: boolean;
  /** 引用消息总开关(默认 true): 开=入站消息带短消息号(台账索引) + 引用消息附原文 + 注入引用指令, 出站支持 [rf:短号] 标签 */
  messageReference?: boolean;
  /** 定时唤醒任务(M3) */
  schedule: ScheduleConfig;
  /** QQ 群管理(入群审批/禁言等; 需机器人=群管理员) */
  groupAdmin: GroupAdminConfig;
  /** 是否展示工具调用成功结果（工具错误始终展示） */
  showToolResults: boolean;
  /** 调试模式 */
  debug: boolean;
  /** 通过 QQ 接收并处理 dsh 的一次性权限申请(远程审批; 思路来源见 features/qq-approval.ts 头注) */
  enableApprovals: boolean;
  /** QQ 权限申请等待时长(ms), 超时自动拒绝 */
  approvalTimeoutMs: number;
  /** QQ 远程提问(ask_user_question → QQ 按钮卡片), 默认开; false=交回 Web UI */
  enableUserQuestions?: boolean;
  /** 出站模式: adaptive=适配主动(默认) / detail=详细主动(adaptive + 工具调用/结果推送) / active=旧全主动(兼容) / passive=全被动回复 / silent=完全不出站 / nothink=完全不思考(仅设置页可配) */
  outboundMode?: 'adaptive' | 'active' | 'passive' | 'detail' | 'silent' | 'nothink';
  /** botplay 互动事件列表(运行时 live, 与 settings 同源) */
  botplayEvents: BotplayEventConfig[];
}

export const ConfigSchema: Schema<ImQQBotConfig> = Schema.object({
  appId: Schema.string().default('').description('QQ Bot AppID'),
  appSecret: Schema.string().default('').description('QQ Bot AppSecret'),
  provider: Schema.string().description('LLM provider name'),
  model: Schema.string().description('Model name'),
  preset: Schema.string().description('Agent preset id'),
  cwd: Schema.string().description('Agent working directory'),
  dataRoot: Schema.string().description('插件数据根目录(可选; 缺省=cwd): 表情包/.qqbot/.qqbot-extensions 统一挂其下, 与工作区其他文件分离'),
  settingsNs: Schema.string().description('Web 设置命名空间(多账号时每实例唯一, 默认 im-qqbot)'),
  requireMention: Schema.boolean().default(true).description('群聊是否需要@bot触发'),
  groupPrompt: Schema.string().default(DEFAULT_GROUP_PROMPT).description('群聊常驻守则(默认表情包礼仪, 可清空关闭)'),
  directPrompt: Schema.string().description('私聊额外system prompt'),
  textChunkLimit: Schema.number().default(4500).description('单条消息最大字符数'),
  streaming: Schema.boolean().default(true).description('是否启用流式输出（群聊始终不启用）'),
  sessionIdleTimeout: Schema.number().default(30 * 60 * 1000).description('会话闲置超时(ms)'),
  maxQueue: Schema.number().default(20).description('并发队列最大长度'),
  processingTimeoutMs: Schema.number().default(120000).description('处理超时(ms)'),
  historyLimit: Schema.number().default(10).description('群历史缓冲条数'),
  access: Schema.object({
    c2cMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('C2C访问模式'),
    c2cAllow: Schema.array(Schema.string()).default([]).description('C2C白名单'),
    groupMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('群聊访问模式'),
    groupAllow: Schema.array(Schema.string()).default([]).description('群聊白名单'),
  }).default({
    c2cMode: 'open',
    c2cAllow: [],
    groupMode: 'open',
    groupAllow: [],
  }).description('访问控制'),
  behavior: behaviorSchema,
  sticker: Schema.object({
    collectEnabled: Schema.boolean().default(true).description('自动收藏群图片(只存本地)'),
    dataDir: Schema.string().default('').description('图库数据根目录(默认 {agent cwd}/表情包)'),
    gates: stickerGatesSchema,
    autoTagEnabled: Schema.boolean().default(false).description('新图后台自动识图打标(耗视觉额度,默认关;开需可用视觉CLI)'),
    visionCli: Schema.string().default('').description('视觉CLI命令模板(含{img}占位), 空=自动探测本机视觉CLI'),
  }).default({
    collectEnabled: true,
    dataDir: '',
    gates: {
      enabled: false,
      perTurnMax: 0,
      perWindowSec: 600,
      maxPerWindow: 0,
      dailyBudgetPerGroup: 0,
      dupTTLHours: 0,
      activityWindowSec: 3600,
      activityMinMsgs: 0,
      bannedGroups: [],
      libRoots: [],
    },
    autoTagEnabled: false,
    visionCli: '',
  }).description('表情包图库'),
  injectRules: Schema.array(injectRuleItemSchema).default([]).description('条件注入规则:消息含图片/链接/自定义文本时自动插入系统提示'),
  imageHint: Schema.boolean().default(true).description('图片消息自动追加「看图」内置提示(默认开; 关掉=不再注入那条「把 URL 传给识图工具」)'),
  messageReference: Schema.boolean().default(true).description('引用消息(默认开): 入站消息带短消息号 + 引用消息附原文 + 注入引用指令; 出站支持 [rf:短号] 标签引用对方消息'),
  schedule: scheduleSchema,
  groupAdmin: groupAdminSchema,
  showToolResults: Schema.boolean().default(false).description('是否展示工具调用成功结果（工具错误始终展示）'),
  debug: Schema.boolean().default(false),
  enableApprovals: Schema.boolean().default(false).description('通过 QQ 接收并处理 dsh 一次性权限申请(远程审批: 发起者用 /approve CODE 放行)'),
  approvalTimeoutMs: Schema.number().default(120000).description('QQ 权限申请超时(ms), 超时自动拒绝'),
  outboundMode: Schema.union(['adaptive', 'detail', 'active', 'passive', 'silent', 'nothink']).default('adaptive').description('出站模式: 适配主动(默认)=收到新消息后前5次带msg_id被动回复, 超出/无新消息自动转主动(连发不受限); 详细主动=同适配主动 + 额外推送工具调用/工具结果到QQ(看进度, 消息更多); 被动=携带msg_id回复(连发受QQ回复同一消息上限); 完全不出站=思考但不发(静默); 完全不思考=QQ入站不唤醒LLM, 仅记录上下文(仅设置页可配, 防机器人自锁)'),
  botplayEvents: Schema.array(botplayEventSchema).default(DEMO_BOTPLAY_EVENTS as never).description('botplay 互动事件(装配器编辑; /botplay 触发发卡)'),
});
