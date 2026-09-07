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
}

/** Web 设置可编辑子集(不含 appId/appSecret 等敏感/底层字段) */
export interface EditableConfig {
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
  /** 群聊常驻守则(默认含表情包礼仪; QQ 通道级注入, 跨 preset 不碰 persona) */
  groupPrompt?: string;
  /** 定时唤醒任务(M3) */
  schedule: ScheduleConfig;
  /** QQ 远程审批开关(live 热生效: 对"保存后的新审批请求"即时生效, 无需重启) */
  enableApprovals?: boolean;
  /** QQ 权限申请等待时长(ms), 超时自动拒绝 */
  approvalTimeoutMs?: number;
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
  '【提问卡片(ask_user_question)·QQ】在 QQ 会话里调用 ask_user_question 提问:选项会以按钮卡片发出,可点权限默认只绑「当前对话发起者本人」(群聊=刚与你对话的那位群友,私聊=对方),只有 TA 能点、别人点了会被拒,不会误答;同一问题会同步出现在 Web 浮层,任一端作答即结算、另一端自动失效。**可以指定某位群友来答**:提问时先在文本里用 <@对方openid> 点名 TA(见【@ 人的方法】,点名放在提问句附近/句末),卡片权限就会绑到被点名的 TA——只有 TA 能点;不确定该问谁或想让对方群友自己答时才不点名(保持默认给当前对话者)。',
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

const groupAdminSchema = Schema.object({
  enabled: Schema.boolean().default(false).description('QQ 群管理总开关(入群审批/禁言等; 需机器人为群管理员)'),
  owners: Schema.array(Schema.string()).default([]).description('允许操作的主人 openid 白名单(空=不校验; 群管理操作仅建议主人使用)'),
  manageGroup: Schema.string().default('').description('对话内默认管理群 group_openid(web/非群会话时群工具用它; QQ 群会话自动用当前群)'),
  watchJoinRequests: Schema.boolean().default(false).description('订阅"入群申请"实时事件(GROUP_JOIN_REQUEST)并自动提醒(改后需重启生效)'),
  notifyInGroup: Schema.boolean().default(true).description('收到入群申请事件时, 在该群内发一条 bot 提醒(需机器人=群管理员)'),
}).default({
  enabled: false,
  owners: [],
  manageGroup: '',
  watchJoinRequests: false,
  notifyInGroup: true,
}).description('QQ 群管理');

/** Web 设置页可编辑项的 schema(behavior/sticker.gates/injectRules/groupPrompt/schedule) */
export const EditableConfigSchema: Schema<EditableConfig> = Schema.object({
  behavior: behaviorSchema,
  groupAdmin: groupAdminSchema,
  sticker: Schema.object({
    gates: stickerGatesSchema,
    autoTagEnabled: Schema.boolean().default(false).description('新图后台自动识图打标(耗视觉额度,默认关)'),
    visionCli: Schema.string().default('').description('视觉引擎命令模板(留空自动探测)'),
  }).description('表情包图库'),
  injectRules: Schema.array(injectRuleItemSchema).default([]).description('条件注入规则'),
  groupPrompt: Schema.string().default(DEFAULT_GROUP_PROMPT).description('群聊常驻守则(默认含表情包礼仪;可清空关闭)'),
  schedule: scheduleSchema,
  enableApprovals: Schema.boolean().default(false).description('QQ 远程审批: dsh 权限申请发到 QQ, 用 /approve CODE 放行(保存后对新请求生效)'),
  approvalTimeoutMs: Schema.number().default(120000).description('QQ 权限申请等待时长(ms), 超时自动拒绝'),
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
}

export const ConfigSchema: Schema<ImQQBotConfig> = Schema.object({
  appId: Schema.string().default('').description('QQ Bot AppID'),
  appSecret: Schema.string().default('').description('QQ Bot AppSecret'),
  provider: Schema.string().description('LLM provider name'),
  model: Schema.string().description('Model name'),
  preset: Schema.string().description('Agent preset id'),
  cwd: Schema.string().description('Agent working directory'),
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
  schedule: scheduleSchema,
  groupAdmin: groupAdminSchema,
  showToolResults: Schema.boolean().default(false).description('是否展示工具调用成功结果（工具错误始终展示）'),
  debug: Schema.boolean().default(false),
  enableApprovals: Schema.boolean().default(false).description('通过 QQ 接收并处理 dsh 一次性权限申请(远程审批: 发起者用 /approve CODE 放行)'),
  approvalTimeoutMs: Schema.number().default(120000).description('QQ 权限申请超时(ms), 超时自动拒绝'),
});
