/**
 * ⚠️ 本文件是**插件自带的示例模块**（随仓库分发：examples/botplay/checkin-stats.mjs）。
 *    想用它：复制到 {数据根}/.qqbot-extensions/botplay/ ，再登记一个 botplay 事件
 *    { "id":"checkin-stats", "name":"签到人数统计", "perm":{"type":"all"}, "file":"checkin-stats.mjs" }
 *    （或在面板「🎮 互动事件」里新建、选中后填模块文件名），然后 /botplay checkin-stats 发卡。
 *    改这个示例不影响插件本体；你完全可以把它当骨架改成自己的互动。
 */
/**
 * checkin-stats.mjs — botplay 自定义事件: 签到人数统计(2026-10-05)
 *
 * 需求原文(主人 2026-10-05):
 *   「我想写一个签到人数统计, 有两个按钮, 按钮1是签到, 所有人都能点且每个人只能点一次;
 *     按钮2是结束, 只能我点。我点结束后, bot 发送消息到 QQ 上, 这条消息统计了点击了签到人数
 *     和所有签到让的名称」
 * 追加需求(主人 2026-10-05 06:11):
 *   「修改已有的 checkin-stats, 我需要将统计结果的时候唤醒 ai, 让你知道统计结果」
 *   → 见下方 wakeAi(): 结算时(主人点结束 / 卡片超时)除发统计文本外, 再 ctx.appendWake()
 *     把结果写进会话并唤醒 AI 本体, 让它知道自己刚统计了什么。
 *
 * ⚠️ 这个文件放在**数据根**下: {dataRoot}/.qqbot-extensions/botplay/checkin-stats.mjs
 *   放数据根的意义: 插件升级/重装只换 node_modules 里的引擎, **不会覆盖它**。
 *   模块自己的状态存在同目录的 data/checkin-stats.mjs.json 里(见 ctx.store), 升级也不丢。
 *
 * 怎么用:
 *   ① 事件登记(botplay-events.json)里已有: { "id":"checkin-stats", "name":"签到人数统计",
 *      "file":"checkin-stats.mjs" }。
 *   ② 群里发 `/botplay checkin-stats` 发出卡片。
 *   ③ 群友点「✅ 签到」→ 每人只能成功一次; 重复点会收到"你已经签过了"。
 *   ④ 主人点「🏁 结束并统计」→ 群里发出统计消息, **同时唤醒 AI**(它会知道结果)。
 *
 * 钩子与 ctx 能力(完整契约见插件源码 src/features/botplay-ext.ts 头部注释):
 *   onInit(ctx)          卡片实例首次加载(含每次重新发卡)时执行
 *   onClick(ctx, info)   某个按钮被点击; 返回非空字符串 = 把这句回给点击者
 *   onExpire(ctx)        卡片超时被回收(这里没用到, 但留着演示"到点自动收尾"怎么写)
 *
 * ⚠️ 一处容易踩的坑(重要, 也是这个示例想教会的):
 *   framework 的按钮 permission 是**整张卡片**一个, 没法"按钮1谁都能点、按钮2只有主人能点"。
 *   所以本模块的做法是: 事件 perm 设 all(谁都能点), 细粒度权限**在 onClick 里自己判**
 *   (ctx.user.isOwner / ctx.owners)。
 */

/** 事件 id(与 botplay-events.json 里的登记一致; 只用于日志/自检, 不参与逻辑) */
const EVENT_ID = 'checkin-stats';

/** 模块状态(每个模块文件只有一份实例, 被同名卡片的多个实例共享) */
let S = {
  /** openid → 昵称(用 Set 语义: 每人只成功一次) */
  signed: new Map(),
  /** 是否已结束(结束过就锁定, 防止统计完还有人继续签) */
  ended: false,
  /** 从磁盘装载过没有(懒加载一次) */
  loaded: false,
  /**
   * 连点去重: `${cardId}|${buttonId}|${openid}` → 上次处理时间戳(ms)。
   * 只挡 1.5 秒内的重复投递(QQ 客户端偶尔会把同一次点击投两次),
   * 业务规则(每人一次)照旧由 S.signed 决定。
   */
  handled: new Map(),
};

/** 同一人同一按钮 1.5 秒内只算一次(挡客户端重复投递; 不参与业务判重) */
const DEDUP_MS = 1500;

/**
 * 载入本轮状态。
 * 状态**按 ctx.cardId 分轮**存（rounds[cardId]），换卡即换轮。
 */
function seed(ctx) {
  const cid = String(ctx.cardId || "");
  if (S.cardId !== cid) {
    // 换卡 = 新的一轮：丢弃内存里的旧名单，重新从磁盘按本轮 cardId 载入
    S = { cardId: cid, signed: new Map(), ended: false, loaded: false, handled: (S && S.handled) || new Map() };
  }
  if (S.loaded) return;
  S.loaded = true;
  const saved = ctx.store.load();
  const rounds = (saved && typeof saved === "object" && saved.rounds) || {};
  const row = rounds[cid];
  if (row && typeof row === "object") {
    if (Array.isArray(row.signed)) {
      for (const r of row.signed) {
        if (r && r.openid) S.signed.set(String(r.openid), String(r.name || r.openid));
      }
    }
    S.ended = row.ended === true;
  }
}

/** 落盘（按轮存；只保留最近 20 轮，避免文件无限涨） */
function persist(ctx) {
  const cid = String(ctx.cardId || "");
  const signed = [...S.signed.entries()].map(([openid, name]) => ({ openid, name }));
  const saved = ctx.store.load();
  const rounds = (saved && typeof saved === "object" && saved.rounds) || {};
  rounds[cid] = { signed, ended: S.ended, updatedAt: new Date().toISOString() };
  const ids = Object.keys(rounds);
  if (ids.length > 20) { for (const k of ids.slice(0, ids.length - 20)) delete rounds[k]; }
  const ok = ctx.store.save({ rounds });
  if (!ok) ctx.log("状态写盘失败(下次点击会再试)");
}

/** 卡片正文(随签到人数实时变) */
function cardMd(tagline) {
  const n = S.signed.size;
  return [
    '## 📋 签到统计',
    '',
    tagline || '点下面按钮签到 👇 每人只能签一次。',
    '',
    `**当前已签到 ${n} 人**${S.ended ? '（本轮已结束）' : ''}`,
    '',
    '---',
    '· ✅ 签到 —— 所有人都能点，每人限一次',
    '· 🏁 结束并统计 —— 只有主人能点，点完在群里公布名单',
  ].join('\n');
}

/** 按钮定义(签到按钮文字带人数, 群里一眼能看到进度) */
function buttons() {
  return [
    {
      id: 'signin',
      label: `✅ 签到 (${S.signed.size})`,
      visitedLabel: '✅ 签到',
      style: 1,
      botAction: { type: 'reply_text', text: '' },
    },
    {
      id: 'end',
      label: '🏁 结束并统计',
      visitedLabel: '🏁 已结束',
      style: 0,
      botAction: { type: 'reply_text', text: '' },
    },
  ];
}

/**
 * 把最新状态写进卡片定义。
 * ⚠️ 只有 repaint=true 才让框架【重发整张卡片】；默认不重发。
 */
function syncCard(ctx, tagline, repaint) {
  const c = ctx.card();
  c.contentText = cardMd(tagline);
  c.buttons = buttons();
  if (repaint) c.dirty = true;
}

/** 组装统计文本: 人数 + 全部签到者名称 */
function statsText() {
  const names = [...S.signed.values()];
  const lines = [
    '### 🏁 签到结束 · 统计结果',
    '',
    `**签到人数：${names.length} 人**`,
    '',
  ];
  if (names.length === 0) {
    lines.push('本轮没有人签到 🐳');
  } else {
    // 每行最多 6 个名字, 群名多时不至于糊成一大坨
    for (let i = 0; i < names.length; i += 6) {
      lines.push(names.slice(i, i + 6).map((n) => `· ${n}`).join('　'));
    }
    lines.push('', '（按签到先后排序）');
  }
  return lines.join('\n');
}

/**
 * ★ 2026-10-05 主人新增需求：结算时唤醒 AI，让 AI 本体知道统计结果。
 *
 * 为什么用 ctx.appendWake：
 *   appendWake 会把一段文本作为「用户消息」写进本会话，**并触发一次 AI 回合**——
 *   也就是把结果直接交到 AI 手里（AI 手里有插件的全部工具：能发言、发图、发文件、写日志……）。
 *   而 appendSilent 只写上下文不唤醒，AI 要等到下次被叫才看得到，不符合"结算即知晓"。
 * ⚠️ appendWake 会消耗 token，所以只在**真正出结果的那一刻**调一次
 *    （主人点「结束并统计」 或 卡片超时自动结算），高频点击里绝不要调。
 * ⚠️ 失败不能影响卡片流程，所以整段包 try/catch。
 */
function wakeAi(ctx, reason) {
  try {
    const names = [...S.signed.values()];
    const list = names.length
      ? names.map((n, i) => `${i + 1}. ${n}`).join('、')
      : '（本轮无人签到）';
    const brief = [
      '【botplay 自定义事件 · 签到统计】本轮签到已结算，通知你一下结果：',
      `· 触发方式：${reason}`,
      `· 卡片实例：${ctx.cardId}`,
      `· 签到人数：${names.length} 人`,
      `· 名单（按签到先后）：${list}`,
      '',
      '统计文本已经由卡片直接发到群里了（群友已能看到）。',
      '你只需要用你自己的口吻在群里补一句简短回应（例如一句播报/一句吐槽/一句感谢），',
      '不需要把名单再复述一遍；如果你愿意，也可以顺手把这次结果记进今日工作日志。',
    ].join('\n');
    if (typeof ctx.appendWake !== 'function') {
      ctx.log('当前框架不支持 appendWake，跳过唤醒 AI');
      return;
    }
    ctx.appendWake(brief);
    ctx.log(`已唤醒 AI 同步统计结果(${names.length} 人, reason=${reason})`);
  } catch (e) {
    ctx.log(`唤醒 AI 失败(不影响签到流程): ${e && e.message}`);
  }
}

export default {
  name: '签到人数统计',

  /** 卡片实例加载/重新发卡时: 装载状态 + 布置按钮/正文 */
  onInit(ctx) {
    seed(ctx);
    syncCard(ctx);
    ctx.log(`onInit card=${ctx.cardId} 已签到=${S.signed.size} ended=${S.ended} scope=${ctx.event.scope}`);
  },

  /**
   * 按钮点击。
   * 返回非空字符串 = 把这句回给点击者(status=成功/提示/失败); 返回空 = 不回文本。
   */
  onClick(ctx, info) {
    seed(ctx);
    const btn = String(info.buttonId || '');
    const who = ctx.user;
    // 连点去重: 同一卡片/按钮/人 1.5 秒内只处理一次(挡客户端重复投递, 不参与业务判重)
    const stamp = `${ctx.cardId}|${btn}|${who.openid}`;
    const now = Date.now();
    const prev = S.handled.get(stamp) || 0;
    if (now - prev < DEDUP_MS) {
      ctx.log(`重复投递被挡(1.5s 内) ${stamp}`);
      return undefined;
    }
    S.handled.set(stamp, now);
    if (S.handled.size > 2000) S.handled.clear(); // 兜底: 别让去重表无限涨

    // ── 按钮1: 签到(所有人都能点, 每人只成功一次) ──
    if (btn === 'signin') {
      if (S.ended) return '本轮签到已经结束啦，等下一轮吧~';
      if (!who.openid) return '拿不到你的身份，稍后再试~';
      if (S.signed.has(who.openid)) {
        ctx.log(`重复签到被拒 openid=${who.openid}`);
        return '你已经签过了 ✅';   // ← 需求里明确要的提示
      }
      S.signed.set(who.openid, who.pureName || who.name || who.openid);
      persist(ctx);
        // 点签到只**记录 + 回一句话**，不重发卡片（2026-10-05 修）：
        //   重发整卡既刷屏、又可能撞 QQ 发卡限频；名单在「结束」时统一公布就够。
      ctx.log(`签到 ok openid=${who.openid} name=${who.pureName} 共=${S.signed.size}`);
      return `✅ 签到成功，你是第 ${S.signed.size} 位！`;
    }

    // ── 按钮2: 结束并统计(只有主人能点) ──
    if (btn === 'end') {
      // 细粒度权限只能自己判(卡片级 perm 做不到按按钮区分) —— 见文件头注释里那个坑
      if (!who.isOwner) {
        ctx.log(`非主人点结束被拒 openid=${who.openid}`);
        return '🙅 这个按钮只有主人能点哦~';
      }
      if (S.ended) return `本轮已经结束过了（签到 ${S.signed.size} 人）`;
      S.ended = true;
      persist(ctx);
      // 需求核心①: 主人点结束后, bot 往群里发一条统计消息
      ctx.emit(statsText());
      // 需求核心②(2026-10-05 追加): 同时唤醒 AI, 让它知道统计结果
      wakeAi(ctx, '主人点击「🏁 结束并统计」');
      ctx.log(`结束统计发出: ${S.signed.size} 人`);
      return `🏁 已结束，统计已发到群里（共 ${S.signed.size} 人）`;
    }

    ctx.log(`未知按钮 ${btn}, 忽略`);
    return undefined;
  },

  /**
   * 卡片超时被回收: 到点还没人点结束, 就由 bot 自己公布一轮结果。
   * 同一套结算逻辑 —— 也会唤醒 AI。
   * 不想要这个行为就删掉本钩子 —— 钩子全部可选。
   */
  onExpire(ctx) {
    seed(ctx);
    if (S.ended || S.signed.size === 0) return;
    S.ended = true;
    persist(ctx);
    ctx.emit(statsText());
    wakeAi(ctx, '卡片超时自动结算');
    ctx.log(`卡片过期自动结算: ${S.signed.size} 人`);
  },

  /** 卡片关闭/热重载/插件卸载时的收尾(这里把内存去重表清掉即可; 状态已在磁盘上) */
  onDispose(ctx) {
    S.handled.clear();
    ctx.log(`onDispose card=${ctx.cardId} event=${EVENT_ID}`);
  },
};
