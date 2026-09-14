/**
 * events.test.ts — assistant/message 的思考(reasoning)提取(2026-09-13)
 *
 * 对应功能: 《好感度系统设计》§11 四源之一「大模型的思考」。
 * 关键约定: ① 只取 type==='reasoning' 且有非空 text 的块(空壳块只有 thinkingSignature, 必须跳过);
 *           ② turn/step 与 usage.reasoningTokens 要带出来(配对与成本代理);
 *           ③ **思考不混进正文** —— content 里 type='text' 的块才出站。
 */
import { describe, expect, it } from 'vitest';
import { parseEvent } from './events.js';

function parseAssistant(content: unknown, extra: Record<string, unknown> = {}) {
  return parseEvent({
    type: 'assistant/message',
    data: { turn: 3, step: 2, message: { content }, ...extra },
  });
}

describe('parseEvent — assistant/message 思考提取', () => {
  it('提取 reasoning 块正文, 跳过空壳块', () => {
    const ev = parseAssistant([
      { type: 'reasoning', thinkingSignature: 'reasoning_content' },
      { type: 'reasoning', text: '先想想该怎么回' },
      { type: 'text', text: '好的主人～' },
    ]);
    expect(ev?.type).toBe('assistant/message');
    const msg = ev as Extract<typeof ev, { type: 'assistant/message' }>;
    expect(msg.reasoning).toBe('先想想该怎么回');
  });

  it('多个 reasoning 块按顺序拼接', () => {
    const ev = parseAssistant([
      { type: 'reasoning', text: '第一段' },
      { type: 'reasoning', text: '第二段' },
      { type: 'text', text: '正文' },
    ]);
    const msg = ev as Extract<typeof ev, { type: 'assistant/message' }>;
    expect(msg.reasoning).toBe('第一段\n第二段');
  });

  it('空白思考视为无(undefined)', () => {
    const ev = parseAssistant([{ type: 'reasoning', text: '   \n ' }, { type: 'text', text: '正文' }]);
    const msg = ev as Extract<typeof ev, { type: 'assistant/message' }>;
    expect(msg.reasoning).toBeUndefined();
  });

  it('没有 reasoning 块时 undefined, 正文照常返回', () => {
    const ev = parseAssistant([{ type: 'text', text: '只有正文' }]);
    const msg = ev as Extract<typeof ev, { type: 'assistant/message' }>;
    expect(msg.reasoning).toBeUndefined();
    expect(msg.content).toHaveLength(1);
  });

  it('带出 turn/step 与 reasoningTokens', () => {
    const ev = parseAssistant([{ type: 'reasoning', text: '想想' }], { usage: { reasoningTokens: 42 } });
    const msg = ev as Extract<typeof ev, { type: 'assistant/message' }>;
    expect(msg.turn).toBe(3);
    expect(msg.step).toBe(2);
    expect(msg.reasoningTokens).toBe(42);
  });

  it('缺 message.content 时返回 undefined(不抛错)', () => {
    expect(parseEvent({ type: 'assistant/message', data: {} })).toBeUndefined();
  });
});
