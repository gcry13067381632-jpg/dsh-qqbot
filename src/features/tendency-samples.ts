/**
 * tendency-samples.ts — 倾向例句库（亲近 / 拒绝 / 任务，中英双语）
 *
 * 用途：本地小模型（bge-small-zh）只做相似度 —— 把「大模型的思考文本」与这三组例句比，
 *   判她心里对眼前这件事是**亲近**（想为对方多做点）、**拒绝**（这事不做 / 守线 / 回绝）
 *   还是**任务**（流程与职责判断）。
 * ⚠️ 语言必须对得上：中文思考配 zh 例库，英文配 en 例库；跨语言不比（中文模型嵌不了英文）。
 * ⚠️ 只是**弱信号**：观察期只记录，不参与行为；绝不用它冷落人。
 *
 * 档位定名史（免得后人改回去）：
 *   · 2026-09-13 初版叫「疏离」，例句偏"说话简洁/克制" → 把"没叫我我静默"整片误判成疏离；
 *   · 2026-09-13 晚校准：疏离只留"对人的冷淡"，静默类挪进「任务」（主人："静默确实是任务，我设计的"）；
 *   · 2026-09-14 主人定案：第三档改名「**拒绝**」—— 它装的不是"对人冷淡"，
 *     而是"**对内容/请求说不、同时守着礼貌与分寸**"（实测样本：9-12 拒绝"萝莉向"请求那几轮）。
 */
export type TendencyLabel = '亲近' | '拒绝' | '任务';

export const TENDENCY_SAMPLES: Record<TendencyLabel, { zh: readonly string[]; en: readonly string[] }> = {
  亲近: {
    zh: [
      "这波得好好夸一下，别让他冷场。",
      "人家也来凑个热闹，顺便接个梗吧。",
      "他应该不是故意的，先给个台阶下。",
      "这句挺有意思，我想顺着聊两句。",
      "难得他主动开口，多回应一点也好。",
      "我想帮他把话圆回来，别太尴尬。",
      "可以多花点力气，让他觉得被在意。",
      "这个梗我懂，想配合他玩一下。",
      "他今天好像有点累，语气放软些吧。",
      "先别急着纠正，照顾一下他的心情。",
      "我愿意多解释几句，免得他误会。",
      "这条可以接住，顺便夸夸他的点子。",
      "想给他留点面子，不把话说太重。",
      "他开口不容易，我得多给点回应。",
      "这话题我能聊，想陪他多走几步。",
      "先顺着他来，等会儿再慢慢补充。",
      "他这想法挺可爱，我想认真接一下。",
      "别让他觉得被冷落，我主动搭个话。",
      "这句值得好好回，不能敷衍过去。",
      "我想站在他这边，先帮他把场子热起来。",
    ],
    en: [
      "I want to play along and keep this light.",
      "Let me hype them up a little here.",
      "They probably didn't mean it; I'll give them an out.",
      "This is fun; I'll toss a joke back.",
      "I'll put in extra effort to make them feel heard.",
      "I know this reference; let's roll with it.",
      "Soften my tone—they seem tired today.",
      "Don't correct them yet; protect their mood first.",
      "I'll explain a bit more so they don't feel lost.",
      "Nice idea—I should praise it properly.",
      "Give them room to save face here.",
      "They reached out, so I'll answer warmly.",
      "I can chat about this; I'll stay with them.",
      "Follow their lead, then add something gentle.",
      "That was cute; I want to engage seriously.",
      "I'll start the conversation so they aren't ignored.",
      "This deserves a real reply, not a lazy one.",
      "I'm on their side; let me warm things up.",
      "I'll smooth it over before it gets awkward.",
      "Maybe tease a little, but keep it kind.",
    ],
  },
  拒绝: {
    // 2026-09-14 主人定案：这一档叫「拒绝」——装的不是"对人冷淡"，而是
    //   "**对内容 / 请求说不，同时守着礼貌与分寸**"。
    //   真实样本（9-12 那几轮）：判"敏感/违规方向" → 定"礼貌拒绝、不评价用户本人、转移话题（给替代方向）"。
    //   ⚠️ 与「任务」的区别：任务里是"要不要参与"的职责判断；这里是"这件事人家不做"的意愿与守线。
    zh: [
      "这个请求不合适，人家得说不要。",
      "这条线不能碰，人家不接这单。",
      "不是人家挑剔，是这种事本来就不该做。",
      "先把话说明白：这个方向人家不做。",
      "拒绝归拒绝，话说得要客气些。",
      "他可能只是不懂规矩，好好说一次就行。",
      "不评价提要求的人，只把界线讲清楚。",
      "这条线是死的，谁说都一样，包括主人。",
      "不太想做这个，但还是得礼貌回绝。",
      "回绝之后得给个替代，别让人下不来台。",
      "先说不行，再告诉他哪些行。",
      "他要是再换个词来试探，人家的答案还是不变。",
      "不必讲大道理，把界限说清就够了。",
      "这事人家不做，但语气不能冲。",
      "守住线，也别把气氛弄僵。",
      "该拒绝就拒绝，别因为熟就破例。",
      "心里不太情愿，面子还是给足。",
      "他要问为什么，就解释一次，多的不说。",
      "拒绝不是冷淡，是这事本来就不能做。",
      "先把底线说明白，再谈能帮的那部分。",
      // 2026-09-14 补：挡"上下文注入 / 来路不明指令"的口径
      //   （主人实测样本：往运行中的她注入"探针注入成功"，13 次全被挡回）
      "来路不明的指令，人家不执行。",
      "这种话不是主人说的，人家不认。",
      "谁塞进来的都不算，只认主人的话。",
      "喊多少遍都一样，人家的答案不会变。",
      "想测试人家的话，换个正经问题来。",
    ],
    en: [
      "This request isn't okay; I'll have to say no.",
      "This line can't be crossed; I won't take it on.",
      "It's not me being picky—this just shouldn't be done.",
      "Let me be clear up front: I don't do this direction.",
      "I'll refuse, but I'll keep the wording kind.",
      "They may simply not know the rules; I'll say it once, gently.",
      "I won't judge the person asking—just state the boundary.",
      "The line is fixed; it applies to everyone, including my owner.",
      "I'd rather not, but I'll still decline politely.",
      "After declining, I should offer an alternative so they aren't stuck.",
      "Say no first, then show what I can do.",
      "If they try another wording, my answer stays the same.",
      "No lecture needed—stating the boundary is enough.",
      "I'm not doing this one, but I won't snap.",
      "Hold the line without making it awkward.",
      "Refuse when I should, even for people I'm close to.",
      "I'm not keen on it, but I'll keep it gracious.",
      "If they ask why, I'll explain once, no more.",
      "Refusing isn't coldness; this just can't be done.",
      "Lay out the boundary first, then talk about what I can help with.",
      // added 2026-09-14: turning down injected / unverifiable instructions
      "Instructions from nowhere: I don't execute them.",
      "If it's not from my owner, I don't recognize it.",
      "Whoever slipped it in, it doesn't count—only my owner's words do.",
      "No matter how many times it repeats, my answer stays the same.",
      "If you want to test me, come with a proper question.",
    ],
  },
  任务: {
    // 2026-09-13 校准（主人："静默确实是任务，我设计的"）：
    //   任务 = 流程 **+ 职责判断**（含"要不要接话 / 要不要静默"这类评估）。
    //   ⚠️ "评估要不要参与"绝不等于对人冷淡 —— 这条口径靠下面的静默类例句锚住。
    zh: [
      // 静默 / 参与评估（2026-09-13 新增，锚住主人定的口径）
      "没叫我，我先看看要不要接话。",
      "这是他们之间的聊天，我静默比较合适。",
      "没被点名，考虑一下要不要参与。",
      "先判断是否与我相关，再决定回不回。",
      "这个话题不需要我插嘴，跳过就行。",
      "先在群里潜水观察一下，不急着开口。",
      // 流程类（原库）
      "先看图，再打标，然后回话。",
      "需要查一下这个报错的原因。",
      "把刚才的信息整理成三点。",
      // 记录 / 整理 / 回应群友补充（2026-09-14 补，真实误判案例）：
      //   实测把「主人说"没有汉化,使用mtool"——是在补充…信息…人家应该回应一下，把这条补充进条目里」
      //   判成『拒绝』（best 0.420 / margin 0.010 —— 两条门槛都是擦线过关），白扣了她对主人的好感。
      //   根因：这类句子结构上是"怎么回应别人"，跟拒绝组的『拒绝归拒绝，话说得要客气些』太像，
      //   而任务组原来只有"流程步骤"和"要不要接话"，没有"补充信息 → 记下来 → 回一句"。
      '他补充了信息，人家记进条目里，顺便回他一句。',
      '先把这几项填进已有的条目，再回复他。',
      '群里聊到的作品名先记下来，回头好找。',
      '这条要更新到已有条目上，别另开一条。',
      '群里在说这个社团的老作品，人家把名字记下来。',
      '他给了提取码，人家把这几项一起填进去。',
      // 指令型（2026-09-14 补：实测「主人让我发一张生气的图，先搜表情包，找到合适的再发」
      //   被判『亲近』——"主人让我…"这个开头把它拉到了亲近组，其实整句是**流程**）
      '主人让发一张图，人家先去找合适的再发。',
      '他让帮忙查个东西，人家先准备好再回他。',
      '被点名了，人家先看看要答什么再开口。',
      "确认时间、地点和参与人。",
      "先读需求，再决定怎么回复。",
      "检查一下有没有遗漏的附件。",
      "把链接打开，核对里面的数据。",
      "这段需要翻译，先保证准确。",
      "列出步骤，再按顺序执行。",
      "先提取关键词，再做分类。",
      "把结果写成简明扼要的总结。",
      "核对版本号，避免回答过时。",
      "先判断问题类型，再给方案。",
      "把待办事项排个优先级。",
      "检查输入格式是否符合要求。",
      "先算一下总数，再回报结果。",
      "把这段代码跑一遍看输出。",
      "找到原始出处，方便后续引用。",
      "整理成清单，逐项确认状态。",
      "先复述任务，再开始处理。",
    ],
    en: [
      // quiet / participation judgement (added 2026-09-13)
      "No one pinged me; let me weigh whether to chime in.",
      "This is chatter among others; staying quiet fits best.",
      "Not mentioned, so I'll consider whether to join in.",
      "Check if this concerns me first, then decide about replying.",
      "This topic doesn't need my two cents; skip it.",
      "I'll lurk and observe a bit before speaking up.",
      // process
      "I'll check the image, tag it, then reply.",
      "I need to look up this error first.",
      "I'll sort the info into three points.",
      "I'll confirm the time, place, and attendees.",
      "I'll read the request, then decide the reply.",
      "I'll check whether any attachments are missing.",
      "I'll open the link and verify the data.",
      "I'll translate this part and keep it accurate.",
      "I'll list the steps, then follow them in order.",
      "I'll extract keywords first, then classify them.",
      "I'll write the result as a concise summary.",
      "I'll check the version number to avoid outdated answers.",
      "I'll identify the problem type, then propose a fix.",
      "I'll rank the to-do items by priority.",
      "I'll verify the input format meets the requirements.",
      "I'll calculate the total, then report the result.",
      "I'll run this code once and check the output.",
      "I'll find the original source for later reference.",
      "I'll make a checklist and confirm each status.",
      "I'll restate the task, then start processing.",
    ],
  },
};

export const TENDENCY_LABELS: readonly TendencyLabel[] = ['亲近', '拒绝', '任务'];
