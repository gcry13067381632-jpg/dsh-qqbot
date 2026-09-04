/**
 * inject-rules.ts — 条件注入规则引擎(配置化)
 *
 * 用户可配: 当入站消息满足条件(含图片/含链接/正文匹配正则或关键词)时,
 * 在 agentBody 末尾追加一行 "[系统提示] <prompt>" 自定义指令。
 * 取代原先 inbound.ts 写死的"读图提示", 并作为内置兜底规则保留默认行为。
 *
 * ⚠️ 本地手改功能(fork 新增, 配置见 config.injectRules):
 *    维护清单见工作区根《插件改动维护注意事项.md》。
 */
import type { InjectRuleConfig } from '../config.js';
import type { Logger, RawAttachment } from '../types.js';

/** 单轮累计注入预算(字符), 防爆上下文 */
const BUDGET_CHARS = 1500;

/** 消息最小形状(只读所需) */
interface RuleMsg {
  content?: string;
  attachments?: RawAttachment[];
}

/** 原写死读图提示(内置兜底规则: 用户未配任何 enabled 的 hasImage 规则时自动追加) */
const LEGACY_IMAGE_RULE: InjectRuleConfig = {
  id: 'builtin-image',
  enabled: true,
  conditions: {
    hasImage: true,
    hasLink: false,
    contentRegex: '',
    contentKeywords: [],
    matchScope: 'any',
  },
  prompt: '上方消息包含图片链接(URL)，请直接把该URL传给桥接视觉工具（modlens_read_image / analyze_image）看图并描述内容，不要只复述链接。',
};

/** 消息是否含附件图片(URL 兜底: content_type 是 MIME 如 image/jpeg) */
function hasImage(msg: RuleMsg): boolean {
  return (msg.attachments ?? []).some(a =>
    (a.url && String(a.content_type ?? '').toLowerCase().includes('image')) || (a.url && /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(a.url)),
  );
}

/** 消息正文是否含 http(s) 链接 */
function hasLink(text: string): boolean {
  return /https?:\/\/|www\./i.test(text);
}

/** 单条规则命中判定(正则编译失败降级 false) */
function matchRule(rule: InjectRuleConfig, text: string, msg: RuleMsg, logger?: Logger): boolean {
  const c = rule.conditions;
  const parts: boolean[] = [];
  if (c.hasImage) parts.push(hasImage(msg));
  if (c.hasLink) parts.push(hasLink(text));
  if (c.contentRegex) {
    try {
      parts.push(new RegExp(c.contentRegex, 'i').test(text));
    } catch (err) {
      logger?.warn?.(`[inject-rules] 正则编译失败 rule=${rule.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (c.contentKeywords.length > 0) {
    const tl = text.toLowerCase();
    parts.push(c.contentKeywords.some(k => k && tl.includes(k.toLowerCase())));
  }
  if (parts.length === 0) return false; // 无条件=永不触发
  return c.matchScope === 'all' ? parts.every(Boolean) : parts.some(Boolean);
}

/**
 * 对组装好的 agentBody 应用全部启用的注入规则, 返回新 body。
 * 规则数组里没有任何 enabled 的 hasImage 规则时, 自动追加内置读图兜底(默认行为与旧版一致)。
 */
export function applyInjectRules(
  body: string,
  msg: RuleMsg,
  rules: InjectRuleConfig[] | undefined,
  logger?: Logger,
): string {
  const text = (msg.content ?? '') || '';
  const enabled = (rules ?? []).filter(r => r.enabled);
  const hasUserImageRule = enabled.some(r => r.conditions.hasImage);
  const active = hasUserImageRule ? enabled : [...enabled, LEGACY_IMAGE_RULE];

  let budget = BUDGET_CHARS;
  let out = body;
  for (const rule of active) {
    if (budget <= 0) {
      logger?.warn?.('[inject-rules] 预算耗尽, 停止注入');
      break;
    }
    if (!matchRule(rule, text, msg, logger)) continue;
    const inj = `[系统提示] ${rule.prompt}`;
    out += `\n\n${inj}`;
    budget -= inj.length;
  }
  return out;
}
