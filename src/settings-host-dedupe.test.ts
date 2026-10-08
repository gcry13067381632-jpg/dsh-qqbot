/**
 * settings-host-dedupe.test.ts — 写 cordis.patch.yml 前的重复键清理（2026-10-09 回归）
 *
 * 背景：`dedupeYamlKeys()` 是 v1.6.x 加的兜底 —— 重复键会让宿主的 YAML 严格解析抛
 * `YAMLException: duplicated mapping key`，dsh 直接起不来，所以写 patch 前必跑。
 *
 * 但它原先按 `(条目 id, 缩进长度, 键名)` 判重并"保留最后一次"，而**同一 `- id:` 块内的
 * 同一缩进并不等于同一个映射**：两个并列子映射只要共用键名，前一个子映射的键就被整段删掉。
 * 被删的行不会让 dsh 起不来（所以一直没被发现），而是让**该行按宿主各插件自己的 schema
 * 校验失败、被加载器静默跳过** —— 例如：
 *   · `presets.read-only` / `presets.workspace-write` 的 sandbox/approval 被删
 *     → `@deepseek-ai/dsh-permission-presets` 缺必填字段 → 权限预设服务不注册；
 *   · `perModel` 里第一个模型的 upstreams/pinMode 被删（留下裸列表）
 *     → `dsh-cline-pass` 的 perModel 期望对象却拿到数组 → 面板路由 404。
 * 触发点是设置页保存账号（`accounts/save`），因此"每保存一次就坏一次"。
 *
 * 本测试锁死三件事：
 *   ① 并列子映射共用键名 → 一个键都不许删；
 *   ② 同一映射里真正的重复键 → 仍然只留最后一次（兜底能力不能退化）；
 *   ③ 块标量（`section: |`）正文里的 `Word:` 行不算键，既不能参与判重也不能被删。
 */
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { dedupeYamlKeys } from '../settings-host.js';

/** 逐行（多重集）比较，返回 after 里少掉的行 —— 用来断言"一行都没删"。 */
function droppedLines(before: string, after: string): string[] {
  const pool = new Map<string, number>();
  for (const line of after.split('\n')) pool.set(line, (pool.get(line) ?? 0) + 1);
  const dropped: string[] = [];
  for (const line of before.split('\n')) {
    const left = pool.get(line) ?? 0;
    if (left > 0) pool.set(line, left - 1);
    else dropped.push(line);
  }
  return dropped;
}

/** 权限预设那一行的形状：三个并列子映射，键名完全相同。 */
const PERMISSION_ROW = [
  '- id: permission',
  '  name: "@deepseek-ai/dsh-permission-presets"',
  '  config:',
  '    presets:',
  '      read-only:',
  '        sandbox: read-only',
  '        approval: ask',
  '      workspace-write:',
  '        sandbox: workspace-write',
  '        approval: ask',
  '      danger-full-access:',
  '        sandbox: danger-full-access',
  '        approval: never',
  '    defaultPreset: workspace-write',
  '',
].join('\n');

/** 一个 LLM provider 行的形状：perModel 下两个模型的 pin，键名相同、父键含 `/` 与 `.`。 */
const PER_MODEL_ROW = [
  '- id: cline-pass',
  '  name: dsh-cline-pass',
  '  config:',
  '    perModel:',
  '      cline-pass/deepseek-v4.1-flash:',
  '        upstreams:',
  '          - deepseek',
  '        pinMode: strict',
  '      cline-pass/muse-spark-1.3-contributor:',
  '        upstreams: []',
  '        exclude: []',
  '        pinMode: strict',
  '        sort: ""',
  '',
].join('\n');

describe('dedupeYamlKeys — 判重作用域是"同一个映射"，不是"同一缩进"', () => {
  it('并列子映射共用键名：一行都不删（permission presets）', () => {
    expect(droppedLines(PERMISSION_ROW, dedupeYamlKeys(PERMISSION_ROW))).toEqual([]);
    expect(dedupeYamlKeys(PERMISSION_ROW)).toBe(PERMISSION_ROW);
    // 三个预设都还在，且宿主读得回来
    const parsed = yaml.load(dedupeYamlKeys(PERMISSION_ROW)) as { config: { presets: Record<string, unknown> } }[];
    expect(Object.keys(parsed[0].config.presets)).toEqual(['read-only', 'workspace-write', 'danger-full-access']);
    expect(parsed[0].config.presets['read-only']).toEqual({ sandbox: 'read-only', approval: 'ask' });
  });

  it('父键含 `/` `.` 时其子键仍归该模型的映射（perModel pin）', () => {
    expect(droppedLines(PER_MODEL_ROW, dedupeYamlKeys(PER_MODEL_ROW))).toEqual([]);
    const parsed = yaml.load(dedupeYamlKeys(PER_MODEL_ROW)) as { config: { perModel: Record<string, unknown> } }[];
    expect(parsed[0].config.perModel['cline-pass/deepseek-v4.1-flash']).toEqual({
      upstreams: ['deepseek'],
      pinMode: 'strict',
    });
  });

  it('真实 profile 片段（脱敏）逐字节保留', () => {
    const fixture = [
      PERMISSION_ROW,
      '- id: cline-pass',
      '  name: dsh-cline-pass',
      '  config:',
      '    knownModels:',
      '      - cline-pass/deepseek-v4.1-flash',
      '    hiddenModels:',
      '      - cline-pass/kimi-k3',
      '    perModel:',
      '      cline-pass/deepseek-v4.1-flash:',
      '        upstreams:',
      '          - deepseek',
      '        pinMode: strict',
      '    exposeTools: false',
      '',
      '- insert:',
      '    - id: im-qqbot-2',
      "      name: '@zaofan/dsh-qqbot'",
      '      config:',
      "        appId: '100000001'",
      "        appSecret: '<secret>'",
      "        preset: 'standard'",
      '      disabled: false',
      '',
    ].join('\n');
    expect(dedupeYamlKeys(fixture)).toBe(fixture);
  });

  it('同一映射里真正的重复键仍然只留最后一次（兜底不退化）', () => {
    const src = [
      '- id: im-qqbot-3',
      "  name: '@zaofan/dsh-qqbot'",
      '  config:',
      "    appId: '111'",
      '    appSecret: secret',
      "    appId: '222'",
      '',
    ].join('\n');
    const out = dedupeYamlKeys(src);
    expect(out).not.toContain("appId: '111'");
    expect(out).toContain("appId: '222'");
    const parsed = yaml.load(out) as { config: { appId: string } }[];
    expect(parsed[0].config.appId).toBe('222');
  });

  it('块标量正文不参与判重、也不被删', () => {
    const src = [
      '- id: preset-x',
      "  name: '@deepseek-ai/dsh-agent-preset'",
      '  config:',
      '    plugins:',
      '      - id: plan-mode',
      "        name: '@deepseek-ai/dsh-plan-mode'",
      '        config:',
      '          section: |',
      '            Note: keep this line',
      '            Note: and this one too',
      '            Explore first, then plan.',
      '',
    ].join('\n');
    expect(dedupeYamlKeys(src)).toBe(src);
  });
});
