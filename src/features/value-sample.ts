/**
 * value-sample.ts — 群聊价值评分样例库(2026-09-13 主人定)
 *
 * 用途: KNN 近邻评分的"记忆库" —— 每条样例带标签 y(1=值得机器人回应 / 0=不必回应)。
 * 实测(2026-09-13): 用样例近邻投票比"描述句 zero-shot"准得多(zero-shot 65% vs KNN 90-100%)。
 * 数据源: 内置默认(从真实群聊 109 条消息 + 通用场景提炼) + 用户文件 {dataRoot}/.qqbot/value-samples.jsonl
 *         —— 文件存在则以文件为准(用户可增删); 不存在时用内置默认。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ValueSample {
  /** 消息文本 */
  m: string;
  /** 1 = 值得机器人回应(提问/求助/@她/接得住的话题); 0 = 不必回应(短应答/表情/群友互聊) */
  y: 0 | 1;
  /** 来源标记: real=真实群聊 / gen=通用场景 */
  src?: string;
}

/**
 * 内置默认样例(55 条)。
 * 正样例来自: 今天群里真实 @ 她/质疑她/求助她的消息 + 通用提问求助;
 * 负样例来自: 群里真实短应答/表情/群友互聊 + 通用闲聊。
 */
export const DEFAULT_VALUE_SAMPLES: ValueSample[] = [
  { m: '@bot 推测一下寿司勇者今年更新的可能性大不大', y: 1, src: 'real' },
  { m: '看看他之前的发布时间', y: 1, src: 'real' },
  { m: '他曾经提到红死其实是个小品级的作品，结果跳票到了现在', y: 1, src: 'real' },
  { m: '可是今年已经就剩下三个月了', y: 1, src: 'real' },
  { m: '@bot 放一下入群', y: 1, src: 'real' },
  { m: '什么引用', y: 1, src: 'real' },
  { m: '还是看不到', y: 1, src: 'real' },
  { m: '这是幻觉了吗', y: 1, src: 'real' },
  { m: '我什么时候发过这句话 还有哪里来的粉发少女', y: 1, src: 'real' },
  { m: '@bot 早饭/午饭/晚饭/夜宵/各种食物 你都可以放行', y: 1, src: 'real' },
  { m: '@bot 我给不起，大肥鱼', y: 1, src: 'real' },
  { m: '没看到引用', y: 1, src: 'real' },
  { m: '引用为什么没生效？', y: 1, src: 'real' },
  { m: '为什么我的机器人收得到消息但发不出回复', y: 1, src: 'real' },
  { m: '这个报错怎么解决啊，谁能帮我看看', y: 1, src: 'real' },
  { m: '我们接入本地小模型怎么样', y: 1, src: 'real' },
  { m: '好发布github1.4.1和npm', y: 1, src: 'real' },
  { m: '帮我看下有什么是有必要借鉴的 https://github.com/master1Sun/dsh-QQbot', y: 1, src: 'real' },
  { m: '试验一下', y: 1, src: 'real' },
  { m: '那你@我一下', y: 1, src: 'real' },
  { m: '帮我查下明天的天气', y: 1, src: 'gen' },
  { m: '你们觉得用A方案还是B方案好？', y: 1, src: 'gen' },
  { m: '能帮我写个脚本吗', y: 1, src: 'gen' },
  { m: '帮我改一下配置文件里的端口', y: 1, src: 'gen' },
  { m: '这个功能怎么开启啊', y: 1, src: 'gen' },
  { m: '要上机了家人们', y: 0, src: 'real' },
  { m: '11点再见', y: 0, src: 'real' },
  { m: '🦌🦌🦌', y: 0, src: 'real' },
  { m: '这倒提醒我了', y: 0, src: 'real' },
  { m: '哦孩子们', y: 0, src: 'real' },
  { m: '要进画里了', y: 0, src: 'real' },
  { m: '今天好冷', y: 0, src: 'real' },
  { m: '还好我能摩擦生热', y: 0, src: 'real' },
  { m: '小馋猫', y: 0, src: 'real' },
  { m: '那很美味了', y: 0, src: 'real' },
  { m: '那很敏感了', y: 0, src: 'real' },
  { m: '【表情: 微笑】', y: 0, src: 'real' },
  { m: '我先去吃个饭', y: 0, src: 'real' },
  { m: '哈哈哈哈', y: 0, src: 'real' },
  { m: '看得到', y: 1, src: 'real' },
  { m: '笑死我了', y: 0, src: 'gen' },
  { m: '哈哈哈', y: 0, src: 'gen' },
  { m: '嗯嗯', y: 0, src: 'gen' },
  { m: '晚安', y: 0, src: 'gen' },
  { m: '1', y: 0, src: 'gen' },
  { m: '?', y: 0, src: 'gen' },
  { m: '明天见', y: 0, src: 'gen' },
  { m: '这游戏真好玩', y: 0, src: 'gen' },
  { m: '😄', y: 0, src: 'gen' },
  { m: '我刚打完一把排位，输了', y: 0, src: 'gen' },
  { m: '今天天气不错', y: 0, src: 'gen' },
  { m: '你们吃了吗', y: 0, src: 'gen' },
  { m: '好的', y: 0, src: 'gen' },
  { m: '收到', y: 0, src: 'gen' },
  { m: '我睡了', y: 0, src: 'gen' },
  { m: '哦哦哦', y: 0, src: 'gen' },
];

/** 样例库文件: {dataRoot}/.qqbot/value-samples.jsonl(一行一条 {m,y}) */
export function valueSamplesPath(dataRoot: string): string {
  return join(dataRoot, '.qqbot', 'value-samples.jsonl');
}

/** 读取样例库; 文件不存在/为空 → 内置默认 */
export function loadValueSamples(dataRoot: string): ValueSample[] {
  const p = valueSamplesPath(dataRoot);
  if (!existsSync(p)) return DEFAULT_VALUE_SAMPLES;
  try {
    const out: ValueSample[] = [];
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const o = JSON.parse(t) as { m?: unknown; y?: unknown; src?: unknown };
      const m = String(o?.m ?? '').trim();
      if (!m) continue;
      out.push({ m, y: o?.y === 1 ? 1 : 0, src: typeof o?.src === 'string' ? o.src : undefined });
    }
    return out.length > 0 ? out : DEFAULT_VALUE_SAMPLES;
  } catch {
    return DEFAULT_VALUE_SAMPLES;
  }
}

/** 覆盖保存样例库(用户可编辑) */
export function saveValueSamples(dataRoot: string, list: ValueSample[]): boolean {
  try {
    const p = valueSamplesPath(dataRoot);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, list.map((s) => JSON.stringify({ m: s.m, y: s.y, src: s.src })).join('\n') + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 追加一条样例(自动学习用): 已存在同文本 → 覆盖标签; 超上限则丢最旧。
 */
export function appendValueSample(dataRoot: string, sample: ValueSample, maxEntries = 300): boolean {
  const cur = loadValueSamples(dataRoot).filter((s) => s.m !== sample.m);
  cur.push(sample);
  const trimmed = cur.length > maxEntries ? cur.slice(cur.length - maxEntries) : cur;
  return saveValueSamples(dataRoot, trimmed);
}
