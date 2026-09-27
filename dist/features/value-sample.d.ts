export interface ValueSample {
    /** 消息文本 */
    m: string;
    /** 1 = 值得机器人回应(提问/求助/@她/接得住的话题); 0 = 不必回应(短应答/表情/群友互聊) */
    y: 0 | 1;
    /** 来源标记: real=真实群聊 / gen=通用场景 */
    src?: string;
}
/**
 * 内置默认样例(56 条: 正 26 / 负 30) —— **新用户开箱即用的那一份**:
 * 当 {dataRoot}/.qqbot/value-samples.jsonl 不存在、或存在但一行都解析不出来时用它兜底,
 * 所以"没写过样例库"的用户也能立刻打分; 一旦用户/AI 写了第一条自己的样例, 就以文件为准。
 * 正样例来自: 今天群里真实 @ 她/质疑她/求助她的消息 + 通用提问求助;
 * 负样例来自: 群里真实短应答/表情/群友互聊 + 通用闲聊。
 */
export declare const DEFAULT_VALUE_SAMPLES: ValueSample[];
/** 样例库文件: {dataRoot}/.qqbot/value-samples.jsonl(一行一条 {m,y}) */
export declare function valueSamplesPath(dataRoot: string): string;
/** 读取样例库; 文件不存在/为空 → 内置默认 */
export declare function loadValueSamples(dataRoot: string): ValueSample[];
/** 覆盖保存样例库(用户可编辑) */
export declare function saveValueSamples(dataRoot: string, list: ValueSample[]): boolean;
/**
 * 追加一条样例(自动学习用): 已存在同文本 → 覆盖标签; 超上限则丢最旧。
 */
export declare function appendValueSample(dataRoot: string, sample: ValueSample, maxEntries?: number): boolean;
//# sourceMappingURL=value-sample.d.ts.map