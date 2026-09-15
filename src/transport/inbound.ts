/**
 * 入站处理器 — 经 SDK 中间件链处理后的消息 → dsh Agent followup
 *
 * 对齐 openclaw-qqbot body-assembler 的内容组装逻辑：
 * - Layer 1: userContent（文本 + 语音转录 + 附件描述）
 * - Layer 2: quotePart（引用消息块）
 * - Layer 3: userMessage（带发送者标签）
 * - Layer 4: dynamicCtx（媒体元数据）
 * - Layer 5: agentBody（history + base 拼合）
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { SessionManager } from '../session/index.js';
import type { ImQQBotConfig } from '../config.js';
import type { ChatScope, Logger, RawAttachment, ReplyTarget } from '../types.js';
import type { DownloadedFile } from './attachment.js';
import { clearGroupHistory } from '../features/history-store.js';
import { applyInjectRules } from './inject-rules.js';
import { inferMediaKind, mediaKindLabel } from './media-kind.js';
import { replaceBotMention, type MentionLike } from '../shared/mention-clean.js';
import { dataRootOf, stickerDirOf } from '../gateway/data-root.js';
import { registerMsgIndex } from './msg-index.js';
import { createValueScorer, appendScoreLog, NON_MENTION_PENALTY } from '../features/value-score.js';
import { getStickerStore, computeDHash } from '../features/sticker-store.js';
import { lookupImagePath, rememberImagePath } from '../features/image-path-cache.js';
import { recordImageUrl, lookupStickerIdByUrl } from '../features/image-url-ledger.js';
import { pushQuote } from '../features/quote-cache.js';
import { computeRelevance, touchAffinity, classifyEmo, getAffinityEntry, memoryStrength } from '../features/local-signals.js';
import { touchDaily } from '../features/intimacy-ledger.js';
import { noteLastSender, attitudeOf, attitudeRange, attitudeGateFor, ATTITUDE_GATE_ENABLED } from '../features/attitude.js';
import { confidentEmo } from '../features/four-source.js';
import { AGG_SCORE_MODE, weightedAggregate } from '../features/agg-score.js';
import { recallLines, setPendingMemo, countWroteToday } from '../features/people-memo.js';
import { detectSelfDisclosure, selfDisclosureHint, bumpHint } from '../features/self-disclosure.js';
import { createLocalEmbedder } from '../features/local-embed.js';

// ── 类型定义 ──

interface ProcessedMessage {
  rawEventType: string;
  kind: 'c2c' | 'group';
  senderId: string;
  senderName?: string;
  content: string;
  messageId: string;
  timestamp: string;
  groupOpenid?: string;
  msgType?: number;
  attachments?: RawAttachment[];
  /** 引用消息(message_type=103): 被引用消息原文(2026-09-13 引用消息功能) */
  messageType?: number;
  msgElements?: Array<{ content?: string; msg_idx?: string; message_type?: number }>;
  message_scene?: { ext?: string[] };
  [key: string]: unknown;
}

interface ResolvedQuote {
  text?: string;
  entry?: { senderId?: string; content?: string };
  attachments?: { contentType?: string; url?: string; filename?: string; asrText?: string }[];
}

interface HistoryEntry {
  senderId: string;
  senderName?: string;
  content: string;
  timestamp: number;
  messageId: string;
}

/** 小传注入节流(同一人 24h 内不重复): uid → 上次注入时间 */
const memoInjectAt = new Map<string, number>();

interface MentionState {
  wasMentioned?: boolean;
}

interface MiddlewareState {
  quote?: ResolvedQuote;
  history?: HistoryEntry[];
  envelope?: string;
  mention?: MentionState;
  /** 冷却派发标记：群内非@消息在冷却结束后被派发时由冷却中间件置 true（不打假 @you） */
  batchDispatch?: boolean;
  /** 聚合投递标记(2026-09-07): 这批消息发生在 AI 上一轮回合进行中、由 debounce 攒到回合结束后
   *  统一入站 —— 时间上早于 AI 上一次回复, 不是对 AI 回复的回应。AI 读到要明白时间顺序。 */
  aggregated?: boolean;
  processedAttachments?: ProcessedAttachment[];
  downloadedFiles?: DownloadedFile[];
  /** 群回复冷却回滚(2026-09-13 主人要求"没产生回复就不该消耗冷却"):
   *  上游(冷却中间件/debounce 批派发)戳冷却时挂上它, 下游判定"本次没回复"就调 restore() 还回去 */
  qqCooldownRollback?: { prev?: number; restore: () => void };
  [key: string]: unknown;
}

interface ProcessedAttachment {
  type: 'voice' | 'image' | 'video' | 'file' | 'unknown';
  filename?: string;
  url?: string;
  localPath?: string;
  voiceText?: string;
  voiceSource?: 'stt' | 'asr' | 'fallback';
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
}

// ── 主处理函数 ──

/**
 * 处理 QQ 入站消息（已经过 SDK 中间件链）
 */
export async function handleInbound(
  rawMsg: unknown,
  manager: SessionManager,
  config: ImQQBotConfig,
  logger: Logger,
  state?: Record<string, unknown>,
): Promise<void> {
  const msg = rawMsg as ProcessedMessage;
  const mwState = (state ?? {}) as MiddlewareState;

  const scope: ChatScope = msg.kind === 'group' ? 'group' : 'c2c';
  const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;

  const replyTarget: ReplyTarget = {
    scope,
    targetId: peerId,
    msgId: msg.messageId,
  };

  // ── 读取中间件已下载的文件（attachmentProcessor 写入 state.downloadedFiles） ──
  const downloaded = mwState.downloadedFiles ?? [];

  // ── 组装 agentBody（对齐 openclaw-qqbot body-assembler） ──
  // 引用消息短消息号(2026-09-13 主人定): 入站登记到本地台账({dataRoot}/.qqbot/msg-index/{peer}/refs.json),
  // 注入**短号**(如 #0913a)替代长 msg_id 省 token; 出站 [rf:短号] 再查表还原完整 id。
  const refEnabled = config.messageReference !== false;
  let msgRef = '';
  if (refEnabled && msg.messageId) {
    try {
      msgRef = registerMsgIndex(dataRootOf(config), scope, peerId, msg.messageId, {
        senderId: msg.senderId,
        senderName: msg.senderName,
      });
    } catch { /* 台账落盘失败不影响消息流 */ }
  }
  let agentBody = assembleAgentBody(msg, mwState, scope, logger, downloaded, refEnabled, msgRef, dataRootOf(config), stickerDirOf(config));

  if (!agentBody) return;

  // 条件注入规则(配置化): 消息含图/链接/自定义条件时追加 [系统提示]。
  // 含内置读图兜底(未配置 hasImage 规则时自动生效, 行为与旧写死版一致)。
  // ⚠️ 本地手改功能（曾被重编译冲掉），改完务必保持 src 与部署 dist 同步。
  agentBody = applyInjectRules(agentBody, msg, config.injectRules, logger, config.imageHint !== false);

  // 群友自述 → 临时提醒她"可以记一条"（2026-09-14 主人定：按关键词命中，**零常驻开销**）
  //   为什么不常驻：主人定过"用法不写进守则，常驻注入每轮都占 token"。
  //   为什么敢用关键词：误报代价极小（最多多记一条，能删；一天只有 3 条额度），漏报也无害（下次再说还会触发）。
  //   ⚠️ 候选**不止"当前那条"**（主人 2026-09-14 问"和消息聚合什么关系"）：
  //     消息聚合/批派发时，窗口里前面几条在 mwState.history 里 —— 群聊的 msg.content 只装**最后一条**
  //     （私聊才是多条拼接）。所以两边都扫、取最近 5 条，与价值评分"取最高"的口径一致（见下方评分段）。
  //     更早的历史不进候选：否则会为几天前的老消息反复提醒同一条。
  try {
    const candidates: Array<{ text: string; senderId: string; senderName?: string }> = [
      { text: String(msg.content ?? ''), senderId: msg.senderId, senderName: msg.senderName },
    ];
    if ((mwState.aggregated === true || mwState.batchDispatch === true) && Array.isArray(mwState.history)) {
      for (const h of mwState.history.slice(-5)) {
        const e = h as { content?: unknown; senderId?: unknown; senderName?: unknown };
        const t = cleanTextForScore(String(e.content ?? ''));
        if (t && typeof e.senderId === 'string') {
          candidates.push({
            text: t,
            senderId: e.senderId,
            senderName: typeof e.senderName === 'string' ? e.senderName : undefined,
          });
        }
      }
    }
    for (const c of candidates) {
      const hit = detectSelfDisclosure(c.text);
      if (!hit) continue;
      const personKey = `person:${c.senderId}`;
      if (countWroteToday(personKey) > 0) continue;   // 这人今天已经记过 → 不唠叨
      // 只有"她在意的人"才提醒（主人 2026-09-14 定）：
      //   "每个人都提醒记录会不会太耗费 token…限制只有好感度高了才提醒，其余靠模型自觉，这样才真实"。
      //   口径 = 好感度占其**范围**的比例 ≥ 20%（即"亲近"档；范围随熟识度变，陌生人 ±1 所以更容易达标）。
      //   没达标的不提醒 —— 靠她自觉（真在意的人，她本来就会留神）。
      const dRoot = dataRootOf(config);
      const att = attitudeOf(dRoot, personKey);
      const affEntry = getAffinityEntry(dRoot, personKey);
      const f = affEntry ? memoryStrength(affEntry) : 0;
      const ratio = (att?.a ?? 0) / attitudeRange(f);
      if (ratio < 0.2) continue;
      if (!bumpHint(personKey)) continue;             // 每人每天最多提醒 2 次
      agentBody = `${agentBody}\n\n${selfDisclosureHint(hit, c.senderName || c.senderId)}`;
      logger.debug(`[小传提醒] 命中"${hit.matched}": ${c.senderName || c.senderId}`);
      break;                                          // 一轮最多提醒一条，别刷屏
    }
  } catch { /* 提醒失败不影响主链 */ }

  // 群聊时间戳(原"群守则"拼接位): 守则已迁 systemPrompt.section(session-manager 装配期注册,
  // 每请求进 system, 不再每轮塞 user 历史); 此处改为注入当前系统时间, 让 AI 每轮知道日期/星期/时刻。
  if (scope === 'group') {
    const _now = new Date();
    const _p = (n: number): string => String(n).padStart(2, '0');
    const _wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][_now.getDay()];
    agentBody = `[当前时间 ${_now.getFullYear()}-${_p(_now.getMonth() + 1)}-${_p(_now.getDate())} ${_wd} ${_p(_now.getHours())}:${_p(_now.getMinutes())}]\n\n${agentBody}`;
  }

  logger.debug(`Processing: scope=${scope} peerId=${peerId} body="${agentBody.slice(0, 200)}"`);

  // ── 获取或创建会话 ──
  let record;
  try {
    record = await manager.getOrCreate(scope, peerId, msg.senderId, replyTarget);
  } catch (err) {
    logger.error(`ERROR creating session: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── 工具自愈：setup 竞态漏装时补注册通道工具(幂等,几乎零开销) ──
  try {
    await manager.ensureChannelTools(record);
  } catch (err) {
    logger.debug(`ensureChannelTools error: ${err instanceof Error ? err.message : String(err)}`);
  }
  // ── qqChannel 上下文自愈: 恢复会话可能没 provide, 工具按本实例路由图库/定时需要它(幂等) ──
  try {
    await manager.ensureChannelContext(record);
  } catch (err) {
    logger.debug(`ensureChannelContext error: ${err instanceof Error ? err.message : String(err)}`);
  }
  // ── 守则/身份 context 注册自愈(幂等; 重启恢复会话也覆盖, 保证 systemPrompt.context 注入生效) ──
  try {
    await manager.ensureGroupRules(record);
  } catch (err) {
    logger.debug(`ensureGroupRules error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 构建 UserMessage → followup / (nothink) append 不唤醒 ──
  // ⚠️ 2026-09-13 修(主人问"你看到了吗"): 图片预检提示是在**下面的评分段**才追加到 agentBody 的,
  //    而这里 message 早就创建好了(用旧文本) → 提示改了变量却没进上下文。故 message 改为 let,
  //    评分段若追加过提示会重建一次(见后面 `message = createUserMessage(...)`)。
  let content: ContentBlock[] = [{ type: 'text' as const, text: agentBody }];

  let message = createUserMessage({
    content,
    source: { kind: 'user' as const },
  });

  // ── 本地小模型价值评分(2026-09-13 主人定, 零 token) ──
  // 群聊消息先本地打分: log=只记录分数(观察期, 不改行为) / block=低分不唤醒(消息仍 append 进上下文, 不丢)
  // ⚠️ 2026-09-13 会话级(主人要求"单会话设置就得能单独设"): 先算**本会话生效值** ——
  //    localModel.overrides["group:<gid>"] 优先, 没有则继承账号级默认。
  {
    const lmCfg = config.localModel;
    const ovKey = `${scope}:${peerId}`;
    const ovRaw = (lmCfg?.overrides && typeof lmCfg.overrides === 'object'
      ? (lmCfg.overrides as Record<string, { enabled?: boolean; valueGate?: 'off' | 'log' | 'block'; valueMinScore?: number }>)[ovKey]
      : undefined) || {};
    const gate = ovRaw.valueGate ?? lmCfg?.valueGate ?? 'log';
    const baseMin = typeof ovRaw.valueMinScore === 'number'
      ? ovRaw.valueMinScore
      : (typeof lmCfg?.valueMinScore === 'number' ? lmCfg.valueMinScore : 0.5);
    // ── 好感度怎么影响"叫醒判定"（2026-09-14 主人定稿：**加在分数上，不动门槛**）──
    //   主人原话："是不是不应该加减门槛，而是加减消息的最终评分数值？"
    //   对 —— 数学上等价（score+off ≥ min  ⟺  score ≥ min−off），但**语义干净得多**：
    //     · 门槛 = 主人设的标准，保持纯粹（你设 0.9 就是 0.9，不会被偷偷改）
    //     · 偏移加在"这句话在她眼里值多少"上：越亲近越值（正分）、越疏远越不值（负分）
    //     · 原始分不被污染、偏移单独记，审计一目了然
    //   ⚠️ 符号（2026-09-14 修）：偏移 = **+0.1 × 好感占比** —— 亲近加分、冷淡减分。
    //      之前照搬"门槛版"的 −0.1×ratio，冷淡反而 [+0.06] 加分（更容易被叫醒），语义全反。
    //   红线：负档也只是"少理/少主动"，绝不冷落 / 阴阳 / 攻击。开关 ATTITUDE_GATE_ENABLED 可一键回滚。
    const minScore = baseMin;
    let attTier: string | undefined;
    let attOff = 0;
    if (ATTITUDE_GATE_ENABLED) {
      try {
        const g = attitudeGateFor(dataRootOf(config), `person:${msg.senderId}`);
        attTier = g.tier;
        attOff = g.offset;
      } catch { /* 算不出 → 不偏移 */ }
    }
    const lmOn = (ovRaw.enabled ?? lmCfg?.enabled) !== false;
    if (scope === 'group' && lmOn && gate !== 'off') {
      const mentioned = mwState.mention?.wasMentioned === true;
      try {
        const scorer = createValueScorer({
          dataRoot: dataRootOf(config),
          modelDir: lmCfg?.modelDir || undefined,
          logger,
        });
        scorer.warmup();   // 后台预热(幂等): 首次入站不等两次加载, 之后零开销
        // 评分输入清洗(2026-09-13 主人定): 剥掉合并转发/引用块的结构标记, 只留真实语义。
        // 引用消息的**被引用原文**单独算一次分, 与当前消息取较高者(她在回应那句话 → 往往也需要她参与)。
        const rawContent = String(msg.content || '');
        const qm = /\[Quoted message begins\]([\s\S]*?)\[Quoted message ends\]/i.exec(rawContent);
        const currentRaw = qm ? rawContent.replace(qm[0], ' ') : rawContent;
        // ⚠️ 2026-09-15 修（主人："语音转文字消息没有参与评分吗"）：
        //   转录文字原来**只进 userContent**（给 AI 看的那份），而评分用的是 msg.content →
        //   语音消息在评分链里永远是"无文字"（score=无），哪怕它被清清楚楚转成了文字 ✗
        //   现在把转录并入评分文本：语音里说的话，跟打字说的话**一样参与"值不值得接"的判断**。
        const voiceForScore = extractVoiceTexts(msg.attachments, mwState.processedAttachments, logger)
          .map((v) => v.text)
          .filter((t) => t.trim() !== '')
          .join(' ');
        const plain = cleanTextForScore([currentRaw, voiceForScore].filter((s) => s !== '').join(' '));
        const quotedPlain = qm ? cleanTextForScore(qm[1] ?? '') : '';
        // ── 图片消息(2026-09-13 主人定 a+b + B预检) ──
        // 小模型只认文字 → 图片本身没法直接评分。三条路都用上:
        //   a) 纯图片也**记一条**(标 📷, 不可评分, 默认不拦)
        //   b) 图**已在库** → 借它的 tags+desc 当文字评分(零成本; 能判出"这张她会接")
        //   B) 注入提示: 已收藏过/新图 —— ⚠️ 实测 QQ 的 fileid **也会变**(2026-09-13 主人重发同图暴露,
        //      两次 fileid 只有前 40 字符相同) → 唯一恒定的是**图片字节哈希**(库 id = sha1 前 12 位),
        //      所以预检 = 下载到临时文件 → sha1 → 查库 → 用完删。
        // 图片 URL 收集(2026-09-13 主人三次实测后定稿): 不再按格式逐种匹配 —— 附件/正文/历史/合并转发
        // 各有各的写法, 直接**认 QQ 多媒体 URL 特征**(multimedia.nt.qq.com.cn/download?...fileid=)最稳。
        const imgUrls: string[] = [];
        const collectImg = (text: string): void => {
          const re = /https:\/\/multimedia\.nt\.qq\.com\.cn\/download\?[^\s\]）)]+/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
            const u = m[0];
            if (!imgUrls.includes(u)) imgUrls.push(u);
          }
        };
        /**
         * 附件按**类型**归类（2026-09-15 主人："视频和文件不算是图片，为什么也默认唤醒了？"）。
         *
         * 原来只有 `imgUrls`，收集条件是「content_type 含 image」**或**「URL 长得像 QQ 多媒体下载链接」——
         * 那个 `||` 让视频/语音/文件全被当成"图"，一起触发了"只要带图就一律不拦" ✗
         * 现在分工：只有**真图片**进 imgUrls；四种类型各自记一笔，放行时按类型开关走。
         */
        const attKinds = { image: false, video: false, voice: false, file: false };
        // ① 当前消息的附件（分类收集：非图片不进 imgUrls）
        for (const a of (Array.isArray(msg.attachments) ? msg.attachments : [])) {
          const at = a as { url?: string; content_type?: string };
          const u = String(at?.url ?? '').trim();
          const ct = String(at?.content_type ?? '').toLowerCase();
          if (/image/.test(ct)) attKinds.image = true;
          else if (/video/.test(ct)) attKinds.video = true;
          else if (/voice|audio|record|amr|silk/.test(ct)) attKinds.voice = true;
          else if (/file/.test(ct)) attKinds.file = true;
          if (u && /image/.test(ct) && !imgUrls.includes(u)) imgUrls.push(u);
        }
        // ② 当前消息正文(合并转发/引用会把图写在文本里) —— 文本里认不出类型，按"图片"处理（历史行为）
        collectImg(String(msg.content || ''));
        // ③ 历史里(聚合把图算进 history 时)
        for (const h of (Array.isArray(mwState.history) ? mwState.history : [])) {
          collectImg(String((h as { content?: string })?.content ?? ''));
        }
        if (imgUrls.length > 0) attKinds.image = true;
        const firstImg = imgUrls[0] || '';
        let libItem: { tags?: string[]; desc?: string } | undefined;
        if (firstImg) {
          // 内容哈希预检(2026-09-13 改): 直接 https 拿 Buffer → sha1(精确) → 不中再 dHash(容错) → 查库。
          // 不再走 attachment.ts 的 download()(带 SSRF 防护, 在宿主里静默失败) 也不落临时文件; 失败留日志。
          try {
            const store = getStickerStore(stickerDirOf(config));
            // 收藏中间件已经把图落盘了 → 直接读盘算哈希, 省掉重复下载(2026-09-13)
            const localP = lookupImagePath(firstImg, logger);
            let buf: Buffer | undefined;
            if (localP) {
              try { buf = readFileSync(localP); } catch { buf = undefined; }
            }
            if (!buf || buf.length === 0) buf = await fetchImageBuffer(firstImg);
            if (buf && buf.length > 0) {
              const id = createHash('sha1').update(buf).digest('hex').slice(0, 12);
              let hit = store.get(id) as unknown as { id?: string; tags?: string[]; desc?: string } | undefined;
              // 逐字节不同但"看起来一样"(QQ 重压缩/改尺寸/转格式)? → 用**感知哈希**dHash 再查一次
              // ⚠️ 2026-09-13 主人定: 相似匹配**只看正式库(library)** ——
              //    候选区全是自动下载的图, 拿它们判"像不像"毫无意义还会误报。
              const exactId = hit?.id;
              if (!hit) {
                const dh = await computeDHash(buf);
                if (dh) hit = store.findByDHash(dh, 5, 'library') as unknown as { id?: string; tags?: string[]; desc?: string } | undefined;
              }
              libItem = hit;
              // 命中(这张图库里/候选区早就有) → 把它**已有的本地文件**记进缓存:
              //   这条消息就能直接写本地路径, 不用等这次下载, 也不用重复下(2026-09-13)
              if (hit?.id) {
                const p = store.pathOf(hit.id);
                if (p) rememberImagePath(firstImg, p);
                // 台账兜底: 只有 sha1 精确命中才刷新「id → QQ 链接」——
                //   dHash 命中的是"看着像"的另一张, 拿它的链接会张冠李戴(保留旧链接更安全)
                if (hit.id === exactId) recordImageUrl(stickerDirOf(config), hit.id, firstImg);
              }
            } else {
              logger.warn(`im-qqbot: 图片预检下载失败(跳过判重): ${firstImg.slice(0, 70)}…`);
            }
          } catch (e) {
            logger.warn(`im-qqbot: 图片预检异常(跳过判重): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        // b) 借库标签: 无文字但有库标签 → 用标签+描述当评分文本
        const libText = libItem ? [...(libItem.tags ?? []), libItem.desc ?? ''].filter(Boolean).join(' ').trim() : '';
        // 评分: ① 当前消息正文 ② 被引用原话(取较高) ③ 都没有但图在库 → 借库标签 ④ 纯图 → 无分
        let sc = plain ? await scorer.score(plain) : undefined;
        let scText = plain;
        if (quotedPlain) {
          const qsc = await scorer.score(quotedPlain);
          if (qsc && (!sc || qsc.score > sc.score)) { sc = qsc; scText = `[被引用的原话] ${quotedPlain}`; }
        }
        if (!sc && libText) {
          sc = await scorer.score(libText);
          if (sc) scText = `[图片·库内: ${libText.slice(0, 60)}]`;
        }
        if (!sc && firstImg) scText = '[图片]';
        let aggCount = 0;
        /**
         * ★ 归因跟随（2026-09-14 主人查实"扣错人"后加）：
         *   聚合窗口里"取最高分那条"时，**被计分的那句话可能不是最后一个人说的**。
         *   原来 `scText` 换成了别人的话，而下面所有归因（熟识度 / 好感度 / 语气 /
         *   评分日志的 sender）仍用 `msg.senderId`（窗口里**最后**发言的人）→
         *   实测把「大肥鱼怎么不插话了」（一只路过的路人甲说的）算到了「愤怒的小鸟」头上，
         *   还用**那个路人的语气**当他的语气，最后扣了他 −0.12。
         *   现在：scText 换成谁的话，发送者就跟着换成谁。
         */
        let srcSenderId = msg.senderId;
        let srcSenderName = msg.senderName;
        let srcFromWindow = false;
        /** 加权综合分（只在加权模式下有值；含各条自己的好感偏移） */
        let aggScore: number | undefined;
        /** 加权明细（进日志，便于事后核对"这个分是怎么平均出来的"） */
        let aggParts: Array<{ n: string; s: number; r: number; w: number }> | undefined;
        // B) 预检提示: 图片消息附一句 —— ⚠️ **只在真·有信息量时才提示**(2026-09-13 主人定):
        //    候选区(candidate)是插件自动下载的默认状态, 每张图都会落进去 →
        //    提示它纯属噪音, 所以候选区/新图**一律不提示**; 只提示「已收藏过」和「在回收站」。
        if (firstImg) {
          const lb = libItem as unknown as { layer?: string; tags?: string[] } | undefined;
          const tg = (lb?.tags ?? []).join('/') || '无';
          const hint = lb?.layer === 'library'
            ? `\n[这张图你已收藏过(标签: ${tg}) —— 不用再收藏]`
            : lb?.layer === 'trash'
              ? '\n[这张图在回收站里(之前清掉的) —— 想用就还原它]'
              : '';
          if (hint) {
            agentBody = `${agentBody}${hint}`;
            // ⚠️ 提示是在 message 创建之后追加的 → 必须重建 message, 否则这句进不了上下文(2026-09-13 修)
            content = [{ type: 'text' as const, text: agentBody }];
            message = createUserMessage({ content, source: { kind: 'user' as const } });
          }
        }
          // 群友小传按需注入(2026-09-13 主人定): 走**运行时上下文**(plugin 来源) ——
          //   AI 看得到, 而聊天界面会把它当上下文过滤掉, 不打扰 web/dock 观感。
          //   同一人 24h 内不重复注入(防监视感); 注入失败不影响主链。
          try {
            const uid = msg.senderId;
            const lastAt = memoInjectAt.get(uid) ?? 0;
            if (scope === 'group' && uid && Date.now() - lastAt > 24 * 3600_000) {
              const embedder = createLocalEmbedder({
                modelDir: typeof lmCfg?.modelDir === 'string' ? lmCfg.modelDir : undefined,
                logger,
              });
              const r = await recallLines(dataRootOf(config), uid, plain || scText || '', embedder, 2);
              if (r.lines.length > 0) {
                const memoText = `[人家记得的 ${msg.senderName || '他'}: ${r.lines.map((l) => l.replace(/^-\s*/, '')).join(' / ')}]`;
                // 交给 systemPrompt.context(运行时上下文贡献)注入 —— 不写进用户消息, 不打扰 web/dock 观感,
                // 且 system prompt 保持字节级稳定 → 前缀缓存全程命中(与 @a9i5k4/dsh-auto-memory 同款姿势)
                setPendingMemo(memoText);
                memoInjectAt.set(uid, Date.now());
              }
            }
          } catch { /* 小传注入失败不影响主链 */ }
        // 聚合/批派发时"取最高"(2026-09-13 主人问): 窗口里可能有多条(如「哈哈哈」+「帮我看看这个报错」),
        // 只算"当前那条"会漏掉窗口里真正需要她的那条 → 对窗口内最近几条也打分, 取最高分那条为准。
        if ((mwState.aggregated === true || mwState.batchDispatch === true) && Array.isArray(mwState.history)) {
          // ⚠️ 2026-09-13 修: 这里之前直接拿 history 的**原始文本**评分 → 合并转发/引用块的格式元数据
          //    又混进来了(实测记录里 text 是 `[群聊的聊天记录] === 消息 1 ===…`)。统一过清洗。
          const extras = mwState.history
            .map((h) => ({
              text: cleanTextForScore(String(h.content ?? '')),
              senderId: h.senderId,
              senderName: h.senderName,
            }))
            .filter((e) => e.text !== '')
            .slice(-5);
          aggCount = extras.length;
          const others = await Promise.all(extras.map((e) => scorer.score(e.text)));
          // 候选池 = 当前那条 + 窗口里那几条（每条都带着"是谁说的"）
          const pool = [
            { text: scText, score: sc?.score, senderId: msg.senderId, senderName: msg.senderName, mention: mentioned, fromWindow: false },
            ...extras.map((e, i) => ({
              text: e.text,
              score: others[i]?.score,
              senderId: e.senderId,
              senderName: e.senderName,
              mention: false,
              fromWindow: true,
            })),
          ].filter((p) => typeof p.score === 'number');
          if (AGG_SCORE_MODE === 'weighted' && pool.length > 1) {
            // 每条先补上"说话人的好感占比 / 偏移"（读台账，所以留在外面做），再交给纯函数算加权
            const cands = pool.map((p) => {
              let ratio = 0;
              let offset = 0;
              let tier: string | undefined;
              if (ATTITUDE_GATE_ENABLED) {
                try {
                  const g = attitudeGateFor(dataRootOf(config), `person:${p.senderId}`);
                  ratio = g.ratio;
                  offset = g.offset;
                  tier = g.tier;
                } catch { /* 算不出 → 按中立 */ }
              }
              return { text: p.text, score: p.score as number, ratio, offset, mention: p.mention, name: p.senderName, tier, senderId: p.senderId, fromWindow: p.fromWindow };
            });
            const agg = weightedAggregate(cands);
            if (agg) {
              aggScore = agg.score;
              aggParts = agg.parts;
              // ★ 主角 = 权重最大那条：文本 / 归因 / 档位全跟着它，绝不"平均出一个不存在的人"
              const top = cands[agg.topIndex];
              if (top) {
                scText = top.text || scText;
                srcSenderId = top.senderId;
                srcSenderName = top.name;
                srcFromWindow = top.fromWindow;
                attTier = top.tier ?? attTier;
                attOff = top.offset;   // 只用于日志（分值里已经各自算过偏移，别再加一次）
              }
            }
          } else {
            // 旧口径：取最高
            others.forEach((o, i) => {
              if (!o) return;
              if (!sc || o.score > sc.score) {
                sc = o;
                scText = extras[i]?.text ?? scText;
                // ★ 文本换人 → 归因也换人（否则就是"用别人的语气、扣别人的分"）
                srcSenderId = extras[i]?.senderId ?? srcSenderId;
                srcSenderName = extras[i]?.senderName ?? srcSenderName;
                srcFromWindow = true;
              }
            });
          }
        }
        // 记录: 有分数→正常记; 纯图片无分数→也记一条(标 img, 让"图片也在观察范围"看得见)
        // ⚠️ 2026-09-15 改：**任何附件**都要进这个块 —— 否则"纯视频 / 纯文件"（既没文字、又不是图）
        //   会整块跳过"值不值得唤醒"的判断，等于无条件放行，附件开关就形同虚设了。
        const hasAnyAttachment = attKinds.image || attKinds.video || attKinds.voice || attKinds.file;
        if (sc || firstImg || hasAnyAttachment) {
          // 会话级门槛: 用本会话算出的 minScore 判定(不是 scorer 内部的默认值); 无分(纯图)视作放行
          // 判定分：加权模式用**综合分**（Σ权×有效分 / Σ权，各条的好感偏移已在里面算过）；
          //   单条模式仍是 原始分 + 好感偏移。⚠️ 别重复加偏移（加权时 attOff 只用于日志）。
          // 再减"没人 @ 她"的惩罚（2026-09-15 主人："把不@bot的给降低评分"）——
          //   点名是明确的"我要你答"，没点名就该更保守；模型原始分不动，只动判定分。
          const mentionPen = mentioned ? 0 : NON_MENTION_PENALTY;
          const effScore = (aggScore !== undefined ? aggScore : (sc ? sc.score + attOff : 0)) - mentionPen;
          // ── 附件唤醒开关（2026-09-15 主人定：图片/视频/语音/文件**分别**决定是否无视分数唤醒）──
          //   现状问题：原来只要是"带图"就一律放行 —— 而"图"里混着视频/语音/文件（收集时不区分格式）。
          //   新规则：
          //     · 有分数 → 够分 **或** 该类型允许放行
          //     · 没分数（纯附件、没文字可评）→ **只有该类型允许放行**才唤醒
          //         ↳ 这条是关键：否则"取消勾选"等于没勾（无分一律放行的话，开关形同虚设）
          const attP = (config.localModel as { attachmentPassthrough?: Record<string, unknown> } | undefined)?.attachmentPassthrough ?? {};
          const mediaPass =
            (attKinds.image && attP.image !== false) ||   // 图片：默认放行（群友发图常是给她看的）
            (attKinds.video && attP.video === true) ||    // 视频：默认不放行
            (attKinds.voice && attP.voice === true) ||    // 语音：默认不放行（有转录文字就按文字评）
            (attKinds.file && attP.file === true);        // 文件：默认不放行
          const worth = sc ? (effScore >= minScore || mediaPass) : mediaPass;
          // ① 相关度(观察期, **只记录不参与判定**): 当前消息 ↔ 她上一条发言 / 群里最近 5 条(2026-09-13 主人定)
          const rel = await computeRelevance({
            gid: msg.groupOpenid ?? '',
            currentText: scText || plain,
            history: mwState.history as Array<{ messageId?: string; content?: string }> | undefined,
            modelDir: typeof lmCfg?.modelDir === 'string' ? lmCfg.modelDir : undefined,
            logger,
          }).catch(() => undefined);
          // ③ 情绪粗分类(观察期**只记录**): 暖/冷/中性（2026-09-14 由"夸/骂"改名）—— 同一个本地模型 + 主人给的 60 条例句库
          const emo = await classifyEmo(scText || plain, {
            modelDir: typeof lmCfg?.modelDir === 'string' ? lmCfg.modelDir : undefined,
            logger,
          }).catch(() => undefined);
          // ② 好感度台账(观察期, **只统计不生效**): 互动 / 被点名 / 接话(相关度≥0.6)
          try {
            // ⚠️ 2026-09-13 修(借主人截图发现): 键原来只到"会话"(scope:peerId), 于是**整群消息累加到一条**、
            //   名字还被最后一个发言人覆盖(截图里"愤怒的小鸟 消息85"其实是整群总数)。改成**按人分键**。
            touchAffinity(dataRootOf(config), `person:${srcSenderId}`, {
              name: srcSenderName,
              mention: mentioned,
              reply: (rel?.relReply ?? 0) >= 0.6,
            });
            // 好感度（A 值）需要知道"这一轮在跟她说话的**是谁**"——出站事件只带会话、不带发送者，
            // 所以这里记一下最近发言的人，出站时用（键与会话一致：<scope>:<targetId>）。
            // ⚠️ 用 srcSender*（= 被计分那句话的真正说话人），不是 msg.sender*。
            noteLastSender(
              scope === 'group' ? `group:${msg.groupOpenid ?? ''}` : `c2c:${srcSenderId}`,
              srcSenderId,
              srcSenderName,
              confidentEmo(emo),   // 这条消息的语气（暖/冷/中性）→ 好感度"对比放大"要用
            );
            // 日报台账(2026-09-13 主人要《本周亲密度小报》): 按天分桶, 只记肉眼可核的事实
            if (scope === 'group' && msg.groupOpenid) {
              touchDaily(dataRootOf(config), msg.groupOpenid, srcSenderId, {
                name: srcSenderName,
                mention: mentioned,
                reply: (rel?.relReply ?? 0) >= 0.6,
                img: Boolean(firstImg),
              });
            }
          } catch { /* ignore */ }
          appendScoreLog(dataRootOf(config), {
            gid: msg.groupOpenid ?? '',
            sender: srcSenderName || srcSenderId,
            // ★ 记下"sender 是从聚合窗口里挑出来的"（不是窗口最后那个人）—— 排查归因问题必需
            senderFromWindow: srcFromWindow || undefined,
            mention: mentioned,
            score: sc ? Math.round(sc.score * 1000) / 1000 : undefined,
            // 判定真正用的分：加权模式=Σ(权×有效分)/Σ权；单条模式=原始分+好感偏移
            // 判定分：有原始分**或**有加权综合分，都要记。
            //   （2026-09-14 修：原来只在 sc 存在时记 —— 纯图那条自己没分、但窗口里别人有分，
            //     加权综合分照样成立，结果面板显示成「📷 + [合·加权]」自相矛盾）
            scoreAdj: (sc || aggScore !== undefined) ? Math.round(effScore * 1000) / 1000 : undefined,
            worth,
            // 被点名 → **必回**（2026-09-14 主人："@不是保证触发吗？"）
            //   拦截条件三处都写着 `!mentioned`，所以被 @ 时分数再低也放行；
            //   但 worth 只表示"分数够不够"，日志里会显示成没通过 → 单记一个字段说明白。
            mentionForced: mentioned || undefined,
            min: minScore,
            // 好感度档位与偏移（2026-09-14 定稿：偏移**加在分数上**，门槛保持主人设的值不动）
            //   ⚠️ 加权模式下 attTier/attOff 是**主角那条**的（权重最大的人），分值本身已各算各的
            attTier,
            attOff: attOff || undefined,
            // 没人 @ 她 → 判定分扣了多少（2026-09-15 加；0/undefined = 被点名，没扣）
            pen: mentionPen || undefined,
            // 加权明细：每条 {n:昵称, s:价值分, r:好感占比, w:权重} —— 事后能复算出综合分
            aggWeighted: aggParts ? true : undefined,
            aggParts,
            minBase: baseMin,
            gate,   // 2026-09-13 加: 记下**当时生效的模式**(排查"为什么低分还回话"必需; 以前只记 min, log/block 分不出来)
            img: firstImg ? true : undefined,
            // 附件类型（2026-09-15）：记下这条带的是视频/语音/文件，便于核对"开关到底生没生效"
            mediaKinds: hasAnyAttachment
              ? Object.entries(attKinds).filter(([, v]) => v).map(([k]) => k).join('+')
              : undefined,
            lib: libItem ? true : undefined,
            // 图在库 ≠ 能借它评分：**待整理区（candidate）的图还没打标签/描述**，
            // 借不到文字 → 评不了分。分开记一个字段，面板好把话说明白
            // （2026-09-14 主人问"怎么有时候评分变成一个 emoji 了"时发现的）
            libText: libText ? true : undefined,
            conf: sc ? Math.round(sc.confidence * 1000) / 1000 : undefined,
            // 相关度(观察期): relReply=接她的话 / relHist=接群里的话题 / final=期望的融合分(暂不生效)
            relReply: rel?.relReply,
            // 情绪粗分类(观察期只记录): emo=暖|冷|中性(2026-09-14 从"夸/骂"改名), 分数与差值便于事后核对准不准
            emo: emo?.label,
            emoScore: emo?.best,
            emoMargin: emo?.margin,
            relHist: rel?.relHist,
            final: sc ? Math.round((0.6 * sc.score + 0.25 * (rel?.relReply ?? 0) + 0.15 * (rel?.relHist ?? 0)) * 1000) / 1000 : undefined,
            agg: aggCount || undefined,
            top: sc ? sc.top.map((n) => `${n.m.slice(0, 14)}|${n.y}|${n.s.toFixed(2)}`) : undefined,
            text: scText.slice(0, 120),
          });
          if (sc) {
            logger.debug(`im-qqbot: 价值评分 ${sc.score.toFixed(3)} worth=${worth} min=${minScore} gate=${gate} conf=${sc.confidence.toFixed(2)} mention=${mentioned} agg=${aggCount} "${scText.slice(0, 40)}"`);
          }
          // block 模式: 低分 且 未被 @ 且 **不带图** → 不唤醒(append 进上下文, 消息不丢)
          // ⚠️ 2026-09-13 主人定稿: **取消低置信保护** —— 被 @ 的永远放行, 其余一律只看分数。
          //
          // ⚠️ 2026-09-13 三次修(主人问"图片的消息不受影响吧" —— 查记录发现**真的受影响**):
          //    纯图片(sc 为空)本来就不拦, 但**库里已有的图**会借库标签当评分文本 → 因此有分数,
          //    而且那个分数往往是低分(实测: 【表情: 微笑】+库内图 = 0.022) → 被拦掉。
          //    这跟"群友发图往往是给她看/求接梗"的初衷完全相反 ⇒ 现在**只要带图就一律不拦**
          //    (分数照记, 便于主人观察; 只是不拿它做拦截判定)。
          // 2026-09-15 改（主人："视频和文件不算是图片，为什么也默认唤醒了？"）：
          //   入口条件去掉 `sc &&` 与 `!firstImg` —— 无分（纯视频/纯文件）也要能拦，
          //   "该不该放行"全交给上面的 worth（含**附件类型开关**），这里只负责执行。
          //   （原来"带图不拦"里那个 firstImg 是**不区分格式**的，视频/文件跟着沾光 ✗）
          if (gate === 'block' && !mentioned && !worth) {
            const ag = record.agent as unknown as {
              whenIdle?: () => Promise<void>;
              session?: { append?: (type: string, data: unknown, opts?: { surfaceOp?: string }) => unknown };
            } | undefined;
            const sess = ag?.session;
            let appended = false;
            if (sess && typeof sess.append === 'function') {
              if (typeof ag?.whenIdle === 'function') {
                try { await Promise.race([ag.whenIdle(), new Promise((r) => setTimeout(r, 60_000))]); } catch { /* 超时继续追加 */ }
              }
              try {
                sess.append('user/message', message, { surfaceOp: 'append' });
                appended = true;
              } catch (err) {
                logger.warn(`[价值评分] 低分 append 失败(仍然不唤醒): ${err instanceof Error ? err.message : String(err)}`);
              }
            } else {
              logger.warn('[价值评分] 低分但会话无 append 能力 —— 仍然不唤醒(这条可能不进上下文)');
            }
            record.lastInboundAt = Date.now();
            logger.debug(`[价值评分] 不唤醒 ${sc ? sc.score.toFixed(2) : `无分`}<${minScore} (gate=block, appended=${appended}): key=${scope}:${peerId} "${plain.slice(0, 30)}"`);
            // ⚠️ 2026-09-13(主人要求"没产生回复就别消耗回复冷却"): 上游派发时戳了一枚群冷却,
            //    既然这次**没唤醒=没回复**, 就把那枚冷却还回去 —— 否则一条低分闲聊会白让群里静默 90 秒。
            const rb = mwState.qqCooldownRollback;
            if (rb && typeof rb.restore === 'function') {
              try {
                rb.restore();
                mwState.qqCooldownRollback = undefined;
                logger.debug('[价值评分] 已回滚本群回复冷却(本次没产生回复)');
              } catch (err) {
                logger.warn(`[价值评分] 冷却回滚失败(忽略): ${err instanceof Error ? err.message : String(err)}`);
              }
            }
            clearGroupHistory(config.appId, msg.groupOpenid ?? msg.senderId);
            return;
          }
          // ② 附件放行（图片默认放行、或主人勾了放行的类型）：只打日志，分数照记
          if (gate === 'block' && !mentioned && mediaPass && (sc ? sc.score < minScore : true)) {
            const kinds = Object.entries(attKinds).filter(([, v]) => v).map(([k]) => k).join('+');
            logger.debug(`[价值评分] 附件放行(${kinds || '未知'})不看分数 ${sc ? sc.score.toFixed(2) : '无分'}<${minScore}: key=${scope}:${peerId}`);
          }
          if (sc && gate !== 'block' && !mentioned && !worth) {
            // ⚠️ 提到 info(2026-09-13): 主人排查"低分为什么还回话"时, 一眼就能在控制台看到
            //    "哦，是模式还在 log" —— 而不是靠猜。平时也就每次群消息一行, 可接受。
            logger.debug(`[价值评分] 低分放行(模式=${gate} 不是 block 所以不拦) ${sc.score.toFixed(2)}<${minScore}${aggCount ? ` agg=${aggCount}` : ''}: key=${scope}:${peerId} "${plain.slice(0, 30)}"`);
          }
        }
      } catch (e) {
        // ⚠️ 这条是**fail-open 的可见化**: 评分环节出异常 = 照旧唤醒(不能因为打分坏了把群静音),
        //    但必须在控制台留痕迹, 否则"低分还回话"永远查不出来。
        logger.warn(`im-qqbot: 价值评分异常(本次照常唤醒): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // 完全不思考(nothink, 2026-09-07 主人定): QQ 入站不唤醒 LLM, 但消息仍要进入上下文。
  // 组装好的完整 agentBody(含时间戳/发送者标签/历史)以 user/message append 进会话,
  // surfaceOp='append' 不唤醒 —— 下次 web 对话或真人消息唤醒时, AI 自然看到这段记录。
  if ((config as { outboundMode?: string }).outboundMode === 'nothink') {
    const a = record.agent as unknown as {
      whenIdle?: () => Promise<void>;
      session?: { append?: (type: string, data: unknown, opts?: { surfaceOp?: string }) => unknown };
    } | undefined;
    const sess = a?.session;
    if (sess && typeof sess.append === 'function') {
      try {
        // 🔒 等 LLM 回合结束再 append(主人硬约束 2026-09-09): 回合活跃时严禁 append(拆散 tool_calls 坏记录)
        if (typeof a.whenIdle === 'function') {
          try { await Promise.race([a.whenIdle(), new Promise((r) => setTimeout(r, 60_000))]); } catch { /* 超时/异常放弃写回 */ }
        }
        record.lastInboundAt = Date.now();
        sess.append('user/message', message, { surfaceOp: 'append' });
        logger.debug(`[nothink] 已 append(不唤醒): key=${scope}:${peerId}`);
        // append 后同样清群历史缓存: 避免下次真人触发时把这段再打包一遍(上下文不重复)
        if (scope === 'group') {
          clearGroupHistory(config.appId, msg.groupOpenid ?? msg.senderId);
        }
        return;
      } catch (err) {
        logger.warn(`[nothink] append 失败, 退回正常 followup: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      logger.warn(`[nothink] 会话无 append 能力, 退回正常 followup: key=${scope}:${peerId}`);
    }
    // 无 append 能力 → 兜底照常 followup(保证消息不丢, 但会唤醒; 罕见路径)
    record.lastInboundAt = Date.now();
    record.turnActive = true;
    record.agent.followup(message);
    logger.debug(`→ followup sent(nothink 兜底): key=${scope}:${peerId}`);
    return;
  }

  record.lastInboundAt = Date.now();
  // 置回合活跃(消息聚合, 2026-09-07): followup 发出即算回合开始, debounce 见忙攒消息; turn/end 由 outbound 复位
  record.turnActive = true;
  record.agent.followup(message);
  logger.debug(`→ followup sent: key=${scope}:${peerId}`);

  // 群消息回复后清空历史缓存（避免下次 @ 时重复组包，对齐 openclaw-qqbot dispatch）
  if (scope === 'group') {
    clearGroupHistory(config.appId, msg.groupOpenid ?? msg.senderId);
  }
}

// ══════════════════════════════════════════════════════════════
// Body Assembly（对齐 openclaw-qqbot 5 层组装）
// ══════════════════════════════════════════════════════════════

/**
 * 组装 agentBody — AI 实际看到的完整上下文
 */
function assembleAgentBody(
  msg: ProcessedMessage,
  state: MiddlewareState,
  scope: ChatScope,
  logger: Logger,
  downloaded: DownloadedFile[],
  enableRef: boolean,
  msgRef: string,
  dataRoot: string,
  stickerDir: string,
): string | null {
  const userContent = buildUserContent(msg, state, logger);

  if (!userContent && (!msg.attachments || msg.attachments.length === 0)) return null;

  let quotePart = buildQuotePart(state.quote);
  // 引用消息(2026-09-13): SDK 中间件没解析出 quote 时, 自己从 103/msg_elements 提取被引用原文
  if (!quotePart && enableRef) {
    const quoted = extractQuotedContent(msg);
    if (quoted) quotePart = `[Quoted message begins]\n${escapeQuoteMarkers(quoted)}\n[Quoted message ends]\n[Current message]\n`;
  }
  // ⚠️ 2026-09-13 主人要求(省 token): 引用原文只给**前 QUOTE_KEEP 字**,
  //   完整原文进本地缓存(每会话最多 10 条) → AI 需要时用 `quote_view` 工具取。
  quotePart = trimQuoteBlock(quotePart, dataRoot, msg, logger);

  const isGroup = scope === 'group';
  const wasMentioned = state.mention?.wasMentioned ?? false;
  const batchDispatch = state.batchDispatch === true;
  const aggregated = state.aggregated === true;
  const userMessage = buildUserMessage(userContent, quotePart, msg.senderId, msg.senderName, isGroup, wasMentioned, msgRef);

  const dynamicCtx = buildDynamicCtx(msg, state, downloaded);

  const base = dynamicCtx ? `${dynamicCtx}${userMessage}` : userMessage;
  // ⚠️ 2026-09-10 去重(主人: "图片链接重复两次"): 聚合/冷却重新派发时, 同一条消息会**既被
  //   mediaHistoryBuffer 记进历史、又作为当前消息出现** → 同一条消息(含媒体 URL)在上下文里出现
  //   两遍: 历史里是 `[昵称] [图片: url]`(foldMedia 折叠版), 当前是 Layer4 的 `- Image: 名 → url`。
  //   按 messageId 剔掉历史中与当前消息重复的那条。
  const history = (state.history ?? [])
    .filter(h => !h.messageId || h.messageId !== msg.messageId)
    // 省 token: 历史里的 `[图片: <250 字符长链接>]` → 本地路径 / 干脆 `[图片]`
    .map(h => ({ ...h, content: localizeHistoryImages(String(h.content ?? ''), stickerDir) }));
  const agentBody = buildAgentBody(base, history, isGroup, wasMentioned, batchDispatch, aggregated);

  return agentBody;
}

/**
 * Layer 1: 用户文本内容 + 语音 + 附件
 */
function buildUserContent(msg: ProcessedMessage, state: MiddlewareState, logger: Logger): string {
  const parts: string[] = [];

  // 2026-09-11 主人要求: 入站 @bot 长 openid 转短标记 @bot 省 token(精确按 mentions.is_you 替换)
  const text = replaceBotMention(
    (msg.content ?? '').trim(),
    (msg as { mentions?: MentionLike[] }).mentions,
    state.mention?.wasMentioned,
  );
  if (text) {
    parts.push(text);
  }

  const voiceTexts = extractVoiceTexts(msg.attachments, state.processedAttachments, logger);
  if (voiceTexts.length > 0) {
    for (const vt of voiceTexts) {
      const durationTag = vt.duration ? ` (${vt.duration}s)` : '';
      parts.push(`[Voice message${durationTag}] ${vt.text}`);
    }
  }

  const otherAttachments = describeAttachments(msg.attachments, state.processedAttachments);
  if (otherAttachments) {
    parts.push(otherAttachments);
  }

  return parts.join('\n');
}

/**
 * 图片预检专用下载(2026-09-13): 直接用 node:https 取 Buffer, **不经 attachment.ts 的 download()**
 * —— 那个带 SSRF 防护(assertSafeHostname), 在宿主环境里会静默失败(实测: 手工 https 能下、运行时却命中不了)。
 * 任何失败 → undefined(调用方当"判不了"处理, 绝不拦消息)。
 */
async function fetchImageBuffer(url: string, maxBytes = 5 * 1024 * 1024): Promise<Buffer | undefined> {
  try {
    const https = await import('node:https');
    return await new Promise<Buffer | undefined>((resolve) => {
      const req = https.get(url, { headers: { 'user-agent': 'dsh-qqbot' } }, (res) => {
        const code = res.statusCode || 0;
        if (code < 200 || code >= 300) { res.resume(); resolve(undefined); return; }
        const chunks: Buffer[] = [];
        let n = 0;
        res.on('data', (c: Buffer) => {
          n += c.length;
          if (n > maxBytes) { req.destroy(); resolve(undefined); return; }
          chunks.push(c);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(undefined));
      });
      req.on('error', () => resolve(undefined));
      req.setTimeout(15000, () => { req.destroy(); resolve(undefined); });
    });
  } catch {
    return undefined;
  }
}

/**
 * 评分前清洗(2026-09-13 主人定): 合并转发/引用块会把大量**格式元数据**混进文本,
 * 直接拿去评分 → 语义被稀释(实测一条合并消息里 90% 是 `=== 消息 1 ===`/`[发送者]`/`[附件1] 类型:…`)。
 * 这里只剥"结构与标记", 保留真正的消息正文。
 */
function cleanTextForScore(raw: string): string {
  let s = String(raw || '');
  s = s
    // @ 标记一律剥掉（2026-09-15）：`<@openid>` / `@bot` 留在打分文本里会让"这条 @ 了她"
    //   变成最大共同特征 → 实测「<@xx> 不知道」拿到 1.00 分。语义交给正文，点名交给 mention 特征。
    .replace(/<@[!&]?\d+>/g, ' ')
    .replace(/<@[0-9A-Za-z_-]{6,}>/g, ' ')
    .replace(/@bot\b/gi, ' ')
    .replace(/\[Quoted message begins\]/gi, ' ')
    .replace(/\[Quoted message ends\]/gi, ' ')
    .replace(/\[Current message\]/gi, ' ')
    .replace(/\[群聊的聊天记录\]/g, ' ')
    .replace(/={2,}\s*消息\s*\d+\s*={2,}/g, ' ')      // === 消息 1 ===
    .replace(/---\s*第\s*\d+\s*条\s*---/g, ' ')        // --- 第1条 ---
    .replace(/\[发送者\][^\n]*/g, ' ')
    .replace(/\[消息内容\]/g, ' ')
    .replace(/\[消息类型\][^\n]*/g, ' ')
    .replace(/\[关联消息\]/g, ' ')
    .replace(/\[附件\d*\][^\n]*/g, ' ')                 // [附件1] 类型:图片 文件名:… URL:…
    .replace(/\[图片:\s*https?:\/\/[^\]]*\]/g, ' ')      // [图片: URL]
    .replace(/\[表情:\s*[^\]]*\]/g, ' ')
    .replace(/\[当前时间[^\]]*\]/g, ' ')
    .replace(/\[系统提示\][^\n]*/g, ' ')
    .replace(/\[Chat history begins\]|\[Chat history ends\]/gi, ' ')
    .replace(/^\s*[-·]\s*Image:[^\n]*/gim, ' ')          // - Image: xxx.jpg (550×550) → URL
    .replace(/^\s*\[[\u4e00-\u9fa5A-Za-z]{1,8}\]\s*$/gm, ' '); // 独占一行的 [标签]
  return s.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

/**
 * Layer 2: 引用消息块
 */
function buildQuotePart(quote?: ResolvedQuote): string {
  if (!quote?.text && !quote?.entry?.content) return '';

  const quoteText = escapeQuoteMarkers(quote.text || quote.entry?.content || 'Original content unavailable');

  return `[Quoted message begins]\n${quoteText}\n[Quoted message ends]\n[Current message]\n`;
}

/**
 * 引用原文里的**块标记转义**(2026-09-13 主人实测抓到的坑):
 *   AI 可能在代码块里示范 `[Quoted message begins]` 这段字面量, 被引用后它会混进引用块,
 *   让"第一个 begin + 第一个 end"这种匹配切错位置。把内层的方括号退化成圆括号:
 *   语义照旧看得懂, 但不再参与结构匹配。
 */
function escapeQuoteMarkers(text: string): string {
  return String(text || '')
    .replace(/\[Quoted message begins\]/gi, '(Quoted message begins)')
    .replace(/\[Quoted message ends\]/gi, '(Quoted message ends)');
}

/** 引用原文保留字数: 超出部分只进本地缓存(2026-09-13 主人定, 短引用就别折腾了) */
const QUOTE_KEEP = 60;

/**
 * 历史里的图片行瘦身(2026-09-13 主人要求"把省 token 做到极致"):
 *   历史中每条图片都是 `[图片: https://multimedia…fileid=…&rkey=…]`(≈250 字符!) —— 群聊图一多就是纯浪费。
 *   现在改成: ①能定位到本地文件 → `[图片: <本地路径>]`(≈60 字符, 还能真去看图)
 *             ②定位不到 → 直接 `[图片]`(4 字符, 反正也读不了那张过期链接)
 *   解析链: image-path-cache(URL→路径) → 台账反查 id → 图库当前真实路径(搬层也对)。
 */
function resolveImageLocalPath(url: string, stickerDir: string): string | undefined {
  const cached = lookupImagePath(url);
  if (cached) return cached;
  try {
    const id = lookupStickerIdByUrl(stickerDir, url);
    if (!id) return undefined;
    const store = getStickerStore(stickerDir);
    const p = store.pathOf(id);
    if (p && existsSync(p)) return p;
  } catch { /* 查不到就算了 */ }
  return undefined;
}

function localizeHistoryImages(text: string, stickerDir: string): string {
  if (!text || text.indexOf('[图片') < 0) return text;
  return text.replace(/\[图片:\s*(https?:\/\/[^\]\s]+)\]/g, (_m, url: string) => {
    const p = resolveImageLocalPath(url, stickerDir);
    return p ? `[图片: ${p}]` : '[图片]';
  });
}

/**
 * 引用块瘦身(2026-09-13 主人要求: 引用太长很吃 token) ——
 *   引用原文只给**前 {@link QUOTE_KEEP} 字**, 完整原文落本地缓存
 *   `{dataRoot}/.qqbot/quote-cache.json`(**每会话最多 10 条**), AI 需要时用 `quote_view` 工具取。
 * 短引用(≤ QUOTE_KEEP)原样不动(免得为了省几个字反而多一次工具调用);
 * 缓存失败则照旧给全文(宁可费 token, 不丢信息)。
 *
 * ⚠️ 2026-09-13 主人实测抓到一个隐蔽 bug: 若**被引用的原文里自带** `[Quoted message begins]`
 *   (比如 AI 在代码块里示范过这个格式), 原来的**非贪婪正则**会先匹配到内层那个"结束"标记 →
 *   截断切错位置、外层的 `[Quoted message ends]` 反而留在后面。
 *   现在: ①取**第一个 begin + 最后一个 end**(认外层) ②引用原文里的标记先转义(见 escapeQuoteMarkers)。
 */
function trimQuoteBlock(quotePart: string, dataRoot: string, msg: ProcessedMessage, logger: Logger): string {
  if (!quotePart) return quotePart;
  const B = '[Quoted message begins]';
  const E = '[Quoted message ends]';
  const b = quotePart.indexOf(B);
  const e = quotePart.lastIndexOf(E);
  if (b < 0 || e < 0 || e <= b) return quotePart;
  const full = quotePart.slice(b + B.length, e).trim();
  if (full.length <= QUOTE_KEEP) return quotePart;
  const key = `${msg.kind === 'group' ? 'group' : 'c2c'}:${(msg.kind === 'group' ? msg.groupOpenid : undefined) ?? msg.senderId}`;
  try {
    const hit = pushQuote(dataRoot, key, full, msg.senderName);
    const head = full.slice(0, QUOTE_KEEP).replace(/\s+/g, ' ');
    logger.debug(`[引用] 原文 ${full.length} 字 → 只给前 ${QUOTE_KEEP} 字(缓存 #${hit.id})`);
    return `${quotePart.slice(0, b)}${B}\n${head}…[引用#${hit.id}: 全文 ${full.length} 字已缓存, 需要时用 quote_view 查]\n${E}${quotePart.slice(e + E.length)}`;
  } catch {
    return quotePart;
  }
}

/**
 * 引用消息原文提取(2026-09-13 主人定): 收到引用消息(message_type=103)时,
 * msg_elements[] 里带被引用消息的原文; 只有标记没有内容时退化为引用索引提示。
 */
function extractQuotedContent(msg: ProcessedMessage): string {
  const els = Array.isArray(msg.msgElements) ? msg.msgElements : [];
  const texts = els.map((e) => e?.content).filter((t): t is string => Boolean(t));
  if (texts.length > 0) return texts.join('\n');
  const ext = Array.isArray(msg.message_scene?.ext) ? msg.message_scene.ext : [];
  const refIdx = ext.find((x) => typeof x === 'string' && x.startsWith('ref_msg_idx='));
  if (refIdx) return `(被引用消息索引: ${refIdx.slice('ref_msg_idx='.length)})`;
  return '';
}

/**
 * Layer 3: 带发送者标签的用户消息
 * 引用消息功能开启时, 每条入站都带**短消息号**(msgRef, 形如 0913a; 群聊挂发送者标签, 私聊独立一行)
 * —— AI 想引用对方时在正文写 [rf:短号](2026-09-13 主人定: 短号省 token, 台账见 msg-index.ts)。
 */
function buildUserMessage(
  userContent: string,
  quotePart: string,
  senderId: string,
  senderName: string | undefined,
  isGroup: boolean,
  wasMentioned: boolean,
  msgRef: string,
): string {
  if (!isGroup) {
    const idPart = msgRef ? `[消息号: ${msgRef}]\n` : '';
    return `${quotePart}${idPart}${userContent}`;
  }

  const mentionTag = wasMentioned ? ' (@you)' : '';
  const displayName = senderName ?? shortSenderId(senderId);
  const senderTag = msgRef ? `[${displayName} (${senderId}) #${msgRef}]` : `[${displayName} (${senderId})]`;
  return `${quotePart}${senderTag} ${userContent}${mentionTag}`;
}

/**
 * Layer 4: 媒体元数据上下文
 */
function buildDynamicCtx(msg: ProcessedMessage, state: MiddlewareState, downloaded: DownloadedFile[]): string {
  const lines: string[] = [];

  if (!msg.attachments || msg.attachments.length === 0) return '';

  // 本段(Layer 4)是**附件的唯一权威描述**: 一行一个附件, 含「类型 + 文件名 + 尺寸/大小 + 取值」。
  // 因此 Layer 1 的 describeAttachments 对带 URL 的附件不再输出(见该函数注释), 保证一个附件只出现一次。
  //
  // ⚠️ 2026-09-10 根因修复(主人实测: "视频还是附件形式, 图片也变成附件了"):
  //   原来按 `content_type` 分流 —— 但 QQ 群聊里**图片/视频的 content_type 实测就是 `'file'`**,
  //   于是图片视频全被塞进 `- File:` 行, dock(chatAttachmentKind 见 `- File:`)渲染成 `📎 download`。
  //   改为按 inferMediaKind() 推断真实类型, 用**显式类型前缀**输出:
  //     `- Image: 名 (850×651) → 本地路径|url` / `- Video: 名 → url` / `- Voice: 名 → url` / `- File: 名 (1.2MB) → 路径|url`
  //   好处: ① AI 能分清哪个 URL 是图/视频/语音(旧的纯 URL 汇总行做不到, 主人已指出);
  //        ② dock 认类型前缀 → 图片直显、视频可播、语音可放;
  //        ③ 语音的 ASR 转录在 Layer 1 的 `[Voice message] 文本` 里, 此处只给 URL(不重复)。
  for (const att of msg.attachments) {
    const kind = inferMediaKind(att);
    // 元信息(文件名 + 图片尺寸 / 文件大小)并入同一行 —— Layer 1 因此不必再重复描述一遍附件。
    const dim = kind === 'image' && att.width && att.height ? `(${att.width}×${att.height})` : '';
    const size = kind === 'file' && att.size ? `(${formatFileSize(att.size)})` : '';
    const meta = [att.filename, dim, size].filter(Boolean).join(' ');
    const head = meta ? `${meta} ` : '';
    if (kind === 'file') {
      // 文件: 有本地落盘路径就给路径(便于 AI 直接读盘), 否则回退原始 URL。
      const d = downloaded.find(x => x.filename === att.filename);
      const target = d?.displayPath ?? att.url;
      if (target) lines.push(`- File: ${head}→ ${target}`);
      continue;
    }
    if (!att.url) continue;
    // ⚠️ 2026-09-13 主人要求: 图片优先给**本地路径**(收藏中间件已落盘) ——
    //   ① AI 要看图直接读盘, 不用再下载(QQ 的临时 URL 又长又会过期);
    //   ② URL 那串 fileid/rkey 很长, 换成本地路径 token 也短。
    //   没落盘(采集关闭 / 下载失败 / 超预算还没回来) → 老老实实回退原始 URL。
    const localImg = kind === 'image' ? lookupImagePath(att.url) : undefined;
    lines.push(`- ${mediaKindLabel(kind)}: ${head}→ ${localImg ?? att.url}`);
  }

  if (lines.length === 0) return '';

  const quoteAttachments = state.quote?.attachments;
  if (quoteAttachments && quoteAttachments.length > 0) {
    lines.push('[Reference attachments]');
    for (const qa of quoteAttachments) {
      const label = qa.asrText ? `Voice: ${qa.asrText}` : (qa.filename ?? qa.contentType ?? 'attachment');
      lines.push(`  - ${label}`);
    }
  }

  return lines.join('\n') + '\n\n';
}

/**
 * Layer 5: 最终 agentBody 拼合
 */
function buildAgentBody(
  base: string,
  history: HistoryEntry[] | undefined,
  isGroup: boolean,
  wasMentioned: boolean,
  batchDispatch = false,
  aggregated = false,
): string {
  // 群内：真实 @ 或冷却派发(batchDispatch)时，把累积的群历史打包给 AI（后者不打假 @you 标签）
  const includeHistory = isGroup && (wasMentioned || batchDispatch) && !!history && history.length > 0;

  // 聚合投递提示(2026-09-07 主人定): 这些消息是我上一轮回合进行中群友发的, 攒到回合结束
  // 才统一入站 —— 时间上早于我的上一次回复, 不是群友在回复我。必须显式说明, 否则 AI 会
  // 误以为它们是"我回完之后群友接着说的"(dsh 队列特性: 攒的消息看起来像新的一轮)。
  const aggregatedNote = aggregated
    ? '[系统提示] 以下消息(含上方历史与当前消息)发生在你上一次回复之前——是你在思考/输出期间，群友陆续发出的消息，由系统攒到你这轮回合结束后统一送入。它们不是对你回复的回应，请不要把它们当成新的一轮对话；请通读后综合回应（如需回应）。\n\n'
    : '';

  if (!includeHistory) {
    // 私聊等无历史打包场景: 聚合提示直接置于正文前
    return aggregatedNote + base;
  }

  const historyLines = history.map(h => {
    const name = h.senderName ?? shortSenderId(h.senderId);
    // 2026-09-12 token 瘦身(主人定): 历史行默认**只给昵称**; 只有"当时 @ 过 bot 的那条"带 openid ——
    // 32 位 openid 每行占 20+ token, limit=20 时每轮白烧 ~640; 要 id 时用 session_list / 台账反查。
    const mentioned = (h as { mentioned?: boolean }).mentioned === true;
    return mentioned && h.senderId ? `[${name} (${h.senderId})] ${h.content}` : `[${name}] ${h.content}`;
  });

  return [
    aggregated ? '[系统提示] 以下历史与当前消息发生在你上一次回复之前(你思考/输出期间群友所发, 非对你的回应), 请通读后综合回应。' : '',
    '[Chat history begins]',
    ...historyLines,
    '',
    '[Chat history ends]',
    '[Current message]',
    base,
  ].filter(Boolean).join('\n');
}

// ══════════════════════════════════════════════════════════════
// 辅助函数
// ══════════════════════════════════════════════════════════════

interface VoiceText {
  text: string;
  duration?: number;
  source: 'stt' | 'asr' | 'fallback';
}

function extractVoiceTexts(
  attachments?: RawAttachment[],
  processed?: ProcessedAttachment[],
  _logger?: Logger,
): VoiceText[] {
  const results: VoiceText[] = [];

  if (processed) {
    for (const pa of processed) {
      if (pa.type === 'voice' && pa.voiceText) {
        results.push({
          text: pa.voiceText,
          duration: pa.duration,
          source: pa.voiceSource ?? 'stt',
        });
      }
    }
  }

  if (results.length === 0 && attachments) {
    for (const att of attachments) {
      if (att.content_type === 'voice' && att.asr_refer_text) {
        results.push({
          text: att.asr_refer_text.trim(),
          source: 'asr',
        });
      }
    }
  }

  return results;
}

function describeAttachments(
  attachments?: RawAttachment[],
  _processed?: ProcessedAttachment[],
): string {
  if (!attachments || attachments.length === 0) return '';

  const parts: string[] = [];

  // ⚠️ 2026-09-10 去重(主人: "图片链接重复两次, 那不是又回原来的长上下文咯?"):
  //   带 URL 的附件已由 Layer 4 的 `- Image: 名 (850×651) → url` 一行完整描述(类型+名+尺寸+URL),
  //   本层**不再重复输出** —— 只有"没有 URL"的附件才在这里兜底做文字描述(Layer 4 给不出链接时)。
  //   效果: 当前消息里一个附件只占一行(此前是 `[Image: 名 尺寸]` + `- Image: 名 → url` 两行)。
  for (const att of attachments) {
    const kind = inferMediaKind(att);
    if (kind === 'voice') continue; // 语音正文由 `[Voice message] 转录` 承接(不含 URL, 本就不重复)
    if (att.url) continue;          // 有 URL → Layer 4 已给完整一行
    switch (kind) {
      case 'image': {
        const dim = att.width && att.height ? ` ${att.width}×${att.height}` : '';
        parts.push(`[Image: ${att.filename}${dim}]`);
        break;
      }
      case 'video':
        parts.push(`[Video: ${att.filename}]`);
        break;
      default:
        parts.push(`[File: ${att.filename} (${formatFileSize(att.size)})]`);
        break;
    }
  }

  return parts.join('\n');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 发送者短标识长度（openid 前 N 位，无昵称时兜底） */
const SENDER_SHORT_ID_LEN = 8;

/** 无昵称时用 openid 前 N 位作为匿名标识 */
function shortSenderId(senderId: string): string {
  return senderId.slice(0, SENDER_SHORT_ID_LEN);
}
