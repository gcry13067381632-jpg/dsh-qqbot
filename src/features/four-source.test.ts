/**
 * four-source.test.ts — 四源标量的两条"主人拍板"修订（2026-09-13）
 *
 *  ① **空回合不留痕**：纯工具步 / 选择静默的回合，思考与正文都是空的，记进去只有噪声。
 *  ② **思考侧不再判情绪**：暖/冷库判她的内心会系统性误判（实测 5 条里 4 条判成"冷"），
 *     思考侧只留倾向；正文侧情绪照记。
 *
 * 注意：倾向/情绪判定依赖本地小模型，模型不可用时相关字段留空 —— 测试**不依赖模型结果**，
 * 只钉住"有没有写行、写了哪些字段"这些结构性行为。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noteTurnSignals, extractInnerText, applyTurnAttitude } from './four-source.js';

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'four-source-'));
}

describe('noteTurnSignals — 空回合不留痕', () => {
  it('思考与正文都空 → 连文件都不创建', async () => {
    const root = freshRoot();
    await noteTurnSignals(root, { turn: 1, step: 1, scope: 'group', peerId: 'p1' }, { think: '', reply: '   ' });
    expect(existsSync(join(root, '.qqbot', 'four-source.jsonl'))).toBe(false);
  });

  it('只有正文也要记（她说话了，但没留思考块）', async () => {
    const root = freshRoot();
    await noteTurnSignals(root, { turn: 5, step: 2, scope: 'group', peerId: 'p2' }, { reply: '好的主人～' });
    const p = join(root, '.qqbot', 'four-source.jsonl');
    expect(existsSync(p)).toBe(true);
    const rec = JSON.parse(readFileSync(p, 'utf8').trim());
    expect(rec.turn).toBe(5);
    expect(rec.replyChars).toBeGreaterThan(0);
  });
});

describe('noteTurnSignals — 思考侧不再记情绪', () => {
  it('有思考 → 写一行，且**不带** thinkEmo 等情绪字段', async () => {
    const root = freshRoot();
    await noteTurnSignals(
      root,
      { turn: 2, step: 1, scope: 'group', peerId: 'p3' },
      { think: '群友在聊游戏，没人叫我，我先看看要不要接话。' },
    );
    const p = join(root, '.qqbot', 'four-source.jsonl');
    expect(existsSync(p)).toBe(true);
    const rec = JSON.parse(readFileSync(p, 'utf8').trim());
    expect(rec.thinkChars).toBeGreaterThan(0);
    expect('thinkEmo' in rec).toBe(false);
    expect('thinkEmoScore' in rec).toBe(false);
  });
});

describe('noteTurnSignals — 正文侧不再记倾向（2026-09-14 主人定）', () => {
  it('有正文 → 带情绪字段、**不带** replyTen 等倾向字段', async () => {
    const root = freshRoot();
    await noteTurnSignals(
      root,
      { turn: 9, step: 1, scope: 'group', peerId: 'p9' },
      { reply: '好的主人，人家这就去办～' },
    );
    const rec = JSON.parse(readFileSync(join(root, '.qqbot', 'four-source.jsonl'), 'utf8').trim());
    expect(rec.replyChars).toBeGreaterThan(0);
    // 倾向字段整组不存在（正文只看情绪）
    expect('replyTen' in rec).toBe(false);
    expect('replyTenScore' in rec).toBe(false);
    expect('replyTenLang' in rec).toBe(false);
  });
});

describe('extractInnerText — 工具参数里的"中文内心话"（2026-09-14 主人口径）', () => {
  it('reply_gate 的中文 reason 会被抽出来', () => {
    const args = JSON.stringify({ reason: '面包乙调侃我傲娇，可俏皮接梗', reply: true });
    expect(extractInnerText(args)).toBe('面包乙调侃我傲娇，可俏皮接梗');
  });

  it('链接 / 路径 / 代码 / 英文参数一律不收（汉字占比不够）', () => {
    expect(extractInnerText(JSON.stringify({ source: 'D:\\a\\b.jpg' }))).toBe('');
    expect(extractInnerText(JSON.stringify({ url: 'https://pan.quark.cn/s/2323' }))).toBe('');
    expect(extractInnerText(JSON.stringify({ command: 'npm run build -- --watch' }))).toBe('');
    // 中文只是零星夹在英文里 → 也不算
    expect(extractInnerText(JSON.stringify({ text: 'run the build 请' }))).toBe('');
  });

  it('嵌套结构也能抽（数组 / 对象）', () => {
    const args = JSON.stringify({ keys: ['先看图再回话', 'ok'], nested: { note: '这条得夸夸他' } });
    expect(extractInnerText(args)).toBe('先看图再回话\n这条得夸夸他');
  });

  it('不是 JSON / 空 → 空串（不抛错）', () => {
    expect(extractInnerText('')).toBe('');
    expect(extractInnerText('not json at all')).toBe('');
    expect(extractInnerText('{}')).toBe('');
  });
});

describe('noteTurnSignals — 工具中文不再并入倾向（2026-09-14 主人拍板 A/B/C）', () => {
  it('只有工具中文（没有 reasoning）也参与倾向判定（2026-09-14 主人拍板恢复）', async () => {
    const root = freshRoot();
    await noteTurnSignals(
      root,
      { turn: 12, step: 1, scope: 'group', peerId: 'p12' },
      { tool: '面包乙调侃我傲娇，可俏皮接梗', reply: '人家才不是傲娇呢' },
    );
    const rec = JSON.parse(readFileSync(join(root, '.qqbot', 'four-source.jsonl'), 'utf8').trim());
    expect(rec.toolChars).toBeGreaterThan(0);
    // 2026-09-14 主人恢复：她常用英文思考、英文库弱，而工具参数里往往写着中文实意
    //   （"安心 放心 摸摸 没事" = 想安慰对方），丢掉等于放弃最好的中文素材
    expect(rec.innerChars).toBeGreaterThan(0);
    expect(rec.thinkChars).toBe(0);
  });
});

describe('倾向关键词兜底：接梗 = 亲近（2026-09-14 主人定）', () => {
  it('思考里出现"接梗" → 记成亲近（哪怕 kNN 判的是任务）', async () => {
    const root = freshRoot();
    await applyTurnAttitude(
      root,
      { scope: 'group', peerId: 'p9', attitudeKey: 'person:u9', attitudeName: '小明' },
      {
        think: '小明@我："偷吃祭品？"——回应人家刚才说"祭品白饭还没吃完"。人家接梗：对，祭品就是给魔神的，人家吃掉天经地义～ 先 reply_gate，然后回应。配图？可以配干饭图。这轮可以纯文字。人家判断：纯文字俏皮回应即可。',
        reply: '对，祭品就是给魔神的，人家吃掉天经地义～',
      },
    );
    const e = JSON.parse(readFileSync(join(root, '.qqbot', 'attitude.json'), 'utf8')).map['person:u9'];
    expect(e).toBeDefined();
    // 起因：这段整段 266 字里八成在讲"配不配图"的流程，kNN 按篇幅判成『任务』(0.534)；
    //   主人拍板"接梗这个词应该算亲近" → 关键词兜底盖过 kNN
    expect(String(e.lastWhy)).toContain('内心亲近');
  });

  it('不含"接梗"的纯流程思考不受影响（仍按 kNN 判任务）', async () => {
    const root = freshRoot();
    await noteTurnSignals(
      root,
      { turn: 41, step: 1, scope: 'group', peerId: 'p41' },
      { think: '主人让我发一张生气的图，先搜表情包，找到合适的再发。' },
    );
    const rec = JSON.parse(readFileSync(join(root, '.qqbot', 'four-source.jsonl'), 'utf8').trim());
    expect(rec.thinkTen).toBe('任务');
  });
});

describe('好感度按回合结算（2026-09-14 修：不再一步一次）', () => {
  it('四源留档**不再**顺手改好感度（台账文件不会出现）', async () => {
    const root = freshRoot();
    await noteTurnSignals(
      root,
      { turn: 30, step: 1, scope: 'group', peerId: 'p30', attitudeKey: 'person:u1', attitudeName: '小明' },
      { think: '他叫我大肥鱼，我要傲娇地回应。' },
    );
    expect(existsSync(join(root, '.qqbot', 'four-source.jsonl'))).toBe(true);
    // 起因：一个回合两三步，按步结算会把同一份内心重复加减；中间步 replyChars=0
    //   还会被当成"正文过短"触发重罚 → 好感度必须由 turn/end 统一结算
    expect(existsSync(join(root, '.qqbot', 'attitude.json'))).toBe(false);
  });

  it('applyTurnAttitude：整个回合只记 1 次事件', async () => {
    const root = freshRoot();
    await applyTurnAttitude(
      root,
      { scope: 'group', peerId: 'p30', attitudeKey: 'person:u1', attitudeName: '小明' },
      { think: '他叫我大肥鱼，这是戳我的雷区。我要傲娇地回应，纠正这个称呼。', reply: '哼，人家才不是大肥鱼呢，人家是有名字的！' },
    );
    const file = JSON.parse(readFileSync(join(root, '.qqbot', 'attitude.json'), 'utf8'));
    const e = file.map['person:u1'];
    expect(e).toBeDefined();
    expect(e.events).toBe(1);
    expect(e.name).toBe('小明');
  });

  it('没有对象（没记到"在跟谁说话"）→ 一动不动', async () => {
    const root = freshRoot();
    await applyTurnAttitude(root, { scope: 'group', peerId: 'p30' }, { think: '随便想想', reply: '随便说说' });
    expect(existsSync(join(root, '.qqbot', 'attitude.json'))).toBe(false);
  });
});
