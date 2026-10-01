/**
 * 引用文本清洗（2026-10-01 主人实测：「历史里包含引用的排版太乱了」）。
 *
 * QQ 的「引用消息」在 `msg_elements` 里是一段**模板串**，形如：
 *   `=== 消息 1 === [消息内容] 呜哇~… [消息类型] 引用消息 [关联消息] --- 第1条 ---
 *      [消息内容] 还敢说话，再干干你 [消息类型] 引用消息 [关联消息] --- 第1条 ---
 *      [消息内容] 必须好好调教 …`
 * 嵌套几层就重复几段，每段还夹着 `[消息类型]` / `[关联消息]` / `引用消息` 这种**纯噪声** ——
 * 原样塞进上下文又长又乱（主人：看不懂是谁引用了什么）。
 *
 * 这里做两件事：
 *   ① {@link stripQqQuoteTemplate} 剥壳：只留各层正文，按 `最外层 → … → 更早` 的顺序返回；
 *   ② {@link slimQuoteText} 压平：把链压成 `A ← B ← C`（← 读作"引用了"），并限长。
 *
 * ⚠️ 只去噪声、不去信息：非模板串（普通引用原文）原样按行返回。
 */

/** 判断是不是 QQ 的引用模板串 */
function looksLikeQqTemplate(s: string): boolean {
  return /===+\s*消息|\[消息内容\]|\[消息类型\]|\[关联消息\]|引用消息|第\s*\d+\s*条/.test(s);
}

/**
 * 剥掉 QQ 引用模板的壳，返回各层正文（**最外层在前**，即"最近被引用的那句话"排第一）。
 * 不是模板串时，按行返回原文（保留原样，只 trim）。
 */
export function stripQqQuoteTemplate(s: string): string[] {
  const raw = String(s ?? '');
  if (!looksLikeQqTemplate(raw)) {
    return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  let t = raw;
  // 每层的正文起点：`[消息内容]` 和 `--- 第N条 ---` 都切开
  t = t.replace(/\[消息内容\]/g, '\n');
  t = t.replace(/-{2,}\s*第\s*\d+\s*条\s*-{2,}/g, '\n');
  // 剩余的壳当空白
  t = t.replace(/\[(?:消息类型|关联消息|消息来源|消息序号)\]/g, ' ');
  t = t.replace(/[=]{2,}\s*消息\s*\d+\s*[=]{2,}/g, ' ');
  t = t.replace(/引用消息/g, ' ');
  return t
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * 引用块正文瘦身：剥模板壳 → 多层压成 `A ← B ← C` → 压平空白 → 限长。
 * @param max 最大字数（默认 160；超出截断加 `…`）
 */
export function slimQuoteText(s: string, max = 160): string {
  const lines = stripQqQuoteTemplate(s);
  // ⚠️ 只取**最外层**那一句 —— 那才是"他引用的内容"。
  //   QQ 给的嵌套链（`[关联消息] --- 第1条 --- [消息内容] …`）全是"那句话又引用了谁"，
  //   又长又乱，对"看懂他引用的是哪句"毫无帮助（主人 2026-10-01：「不止是排版乱的问题，这是内容就乱了」）。
  let out = (lines[0] ?? '').replace(/\s+/g, ' ').trim();
  if (max > 0 && out.length > max) out = out.slice(0, max) + '…';
  return out;
}

/** 附件行（`📷 被引用的图片: <本地路径>` 等）—— 截断时必须豁免：那是"引用的是哪张图"的唯一线索
 *  ⚠️ 不能用字符类 `[📷🎵🎬📎]` —— emoji 是代理对，字符类里会被拆成单个 UTF-16 码元，**匹配不上**。 */
const ATT_LINE_RE = /^(?:📷|🎵|🎬|📎)\s*被引用的/;

/**
 * 把整个 `[引]…[/引]` 块压成**一行**并限长（历史行用）。
 * 附件行不参与截断（否则路径被切掉 = 白记）。
 */
export function slimQuoteBlockOneLine(block: string, max = 140): string {
  const raw = String(block ?? '').trim();
  if (!raw) return '';
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isBegin = (l: string): boolean => /^\[(?:引|Quoted message begins)\]$/i.test(l);
  const isEnd = (l: string): boolean => /^\[\/(?:引|Quoted message ends)\]$/i.test(l);
  const hasBegin = lines.some(isBegin);
  const hasEnd = lines.some(isEnd);
  // ⚠️ 2026-10-01 主人实测抓到：附件行**必须留在 `[引]…[/引]` 里面**。
  //   原实现把「正文」和「附件」分成两段各自拼，附件被甩到 `[引] [/引]` **之后** →
  //   引用块看着是空的、图却挂在块外（`[引] [/引] 📷 被引用的图片: …`）。
  const att = lines.filter((l) => ATT_LINE_RE.test(l));
  const body = lines
    .filter((l) => !isBegin(l) && !isEnd(l) && !ATT_LINE_RE.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const clipped = max > 0 && body.length > max ? body.slice(0, max) + '…' : body;
  const inner = [clipped, ...att].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!hasBegin && !hasEnd) return inner;
  // 老英文标记（[Quoted message begins]…）也归一成短标记
  return `[引] ${inner} [/引]`.replace(/\s+/g, ' ').trim();
}
