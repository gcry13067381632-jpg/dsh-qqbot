/**
 * people-memo.ts — 「群友小传」（文字版好感度本体, 2026-09-13 主人定）
 *
 * 设计要点（详见 参考文档/dsh-qqbot-好感度系统设计_20260913.md §4.3）:
 *   · 一人一个本地 Markdown: `{dataRoot}/.qqbot/people/<uid>.md`（人可读、可手改、可删）
 *   · 八栏: 身份 / 本事 / 经历 / 成就 / 喜好与雷区 / 价值观 / 与该 AI 的关系 / 对该 AI 的期望
 *   · **只写旁人也复述得出来的事实** + 一句"她当时怎么接的"; 不写评价、不猜测
 *   · 原文留档: 摘要之上不动, 摘要改味了能对回来
 *   · 写入节流: 同一人**一天最多一条**(她顺手记, 不是台账)
 *   · 遗忘: 不删原文; 30 天没有新事件就沉底归档(归档不影响行为, 可按名字翻出)
 *   · 删除入口: 一句"别记人家" → 删整段 + 回执
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 归档阈值(天): 小传最后修改超过这么久 → 沉底(仍在文件里, 只是不再优先召回) */
export const MEMO_ARCHIVE_DAYS = 30;

export function peopleDirOf(dataRoot: string): string {
  return join(dataRoot, '.qqbot', 'people');
}

/** 文件名安全化(uid 一般是 hex, 但仍防穿越) */
function safeKey(key: string): string {
  return String(key || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 64) || 'unknown';
}

export function memoPathOf(dataRoot: string, key: string): string {
  return join(peopleDirOf(dataRoot), `${safeKey(key)}.md`);
}

export function readMemo(dataRoot: string, key: string): string | undefined {
  const p = memoPathOf(dataRoot, key);
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

/** 列出全部小传(按最后修改时间新→旧) */
export function listMemos(dataRoot: string): Array<{ key: string; path: string; bytes: number; mtime: number; archived: boolean }> {
  const dir = peopleDirOf(dataRoot);
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const p = join(dir, f);
        const st = statSync(p);
        return {
          key: f.replace(/\.md$/, ''),
          path: p,
          bytes: st.size,
          mtime: st.mtimeMs,
          archived: Date.now() - st.mtimeMs > MEMO_ARCHIVE_DAYS * 86400_000,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

/** 该人今天是否已经记过一条(节流: 同一人一天最多一条) */
export function wroteToday(dataRoot: string, key: string, now = Date.now()): boolean {
  try {
    const st = statSync(memoPathOf(dataRoot, key));
    const d1 = new Date(st.mtimeMs);
    const d2 = new Date(now);
    return d1.toDateString() === d2.toDateString();
  } catch {
    return false;
  }
}

/** 追加一行(带日期)。已存在则插到"上次聊到"之前；不存在则新建骨架。返回是否成功 */
export function appendMemoLine(
  dataRoot: string,
  key: string,
  line: string,
  opts: { name?: string; force?: boolean } = {},
): { ok: boolean; msg: string } {
  const text = String(line || '').trim().slice(0, 300);
  if (!text) return { ok: false, msg: '内容是空的' };
  if (!opts.force && wroteToday(dataRoot, key)) return { ok: false, msg: '这个人今天已经记过一条了(一天最多一条, 明天再说)' };
  const dir = peopleDirOf(dataRoot);
  const p = memoPathOf(dataRoot, key);
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const bullet = `- ${stamp} ${text}`;
  try {
    mkdirSync(dir, { recursive: true });
    const cur = existsSync(p) ? readFileSync(p, 'utf8') : undefined;
    if (!cur) {
      const head = `# ${opts.name || key}\n\n> 小传（八栏：身份/本事/经历/成就/喜好与雷区/价值观/与该 AI 的关系/对该 AI 的期望）\n> 只写旁人也复述得出来的事实 + AI 当时怎么接的；不写评价与猜测。原文留档不动。\n\n## 记事\n`;
      writeFileSync(p, `${head}${bullet}\n`, 'utf8');
      return { ok: true, msg: '已新建小传并记下这条' };
    }
    // 插到「## 记事」区末尾、其它区之前
    const idx = cur.indexOf('\n## 原始自述');
    if (idx > 0) {
      writeFileSync(p, `${cur.slice(0, idx)}\n${bullet}${cur.slice(idx)}`, 'utf8');
    } else {
      writeFileSync(p, `${cur.replace(/\s*$/, '')}\n${bullet}\n`, 'utf8');
    }
    return { ok: true, msg: '已记下' };
  } catch (e) {
    return { ok: false, msg: `写入失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 取该小传里最适合注入的 1~2 行: 有嵌入器就按"与当前消息最相关"排, 没有就取最近两条。
 * 若整份小传已归档(30 天没更新) → 不注入(沉底)。
 */
export async function recallLines(
  dataRoot: string,
  key: string,
  query: string,
  embed?: { available(): boolean; embedQuery(t: string): Promise<number[] | undefined>; embedPassages(t: string[]): Promise<number[][] | undefined> },
  topN = 2,
): Promise<{ lines: string[]; archived: boolean }> {
  const text = readMemo(dataRoot, key);
  if (!text) return { lines: [], archived: false };
  let archived = false;
  try {
    archived = Date.now() - statSync(memoPathOf(dataRoot, key)).mtimeMs > MEMO_ARCHIVE_DAYS * 86400_000;
  } catch { /* 读不到当未归档 */ }
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- ') && !/^>\s/.test(l) && !/^-\s*\d+\./.test(l));
  if (lines.length === 0) return { lines: [], archived };
  if (archived) return { lines: [], archived }; // 沉底: 不参与注入(可按名字显式翻出)
  if (lines.length <= topN || !embed || !embed.available()) return { lines: lines.slice(-topN), archived };
  try {
    const qv = await embed.embedQuery(String(query || '').slice(0, 200));
    const vv = await embed.embedPassages(lines.map((l) => l.replace(/^-\s*/, '')));
    if (!qv || !vv) return { lines: lines.slice(-topN), archived };
    const dot = (a: number[], b: number[]): number => {
      let s = 0;
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i += 1) s += a[i]! * b[i]!;
      return s;
    };
    const scored = lines.map((l, i) => ({ l, s: dot(qv, vv[i] ?? []) }));
    scored.sort((a, b) => b.s - a.s);
    return { lines: scored.slice(0, topN).map((x) => x.l), archived };
  } catch {
    return { lines: lines.slice(-topN), archived };
  }
}

/** 删掉整段小传(群里一句"别记人家" → 立刻执行 + 回执) */
export function deleteMemo(dataRoot: string, key: string): { ok: boolean; msg: string } {
  try {
    const p = memoPathOf(dataRoot, key);
    if (!existsSync(p)) return { ok: true, msg: '本来就没有记过这个人' };
    rmSync(p);
    return { ok: true, msg: '已删掉' };
  } catch (e) {
    return { ok: false, msg: `删除失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ─────────── 运行时上下文贡献（2026-09-13 主人定：与 auto-memory 同款姿势） ───────────
// dsh 的 systemPrompt.context() 是"每次组装都求值"的动态贡献, 挂在历史尾部(user-role 快照),
// 而 **system prompt 本体保持字节级稳定 → 前缀缓存不被打穿**。这里只放"本轮要注入的那一行"，
// 由 inbound 算好后暂存，短 TTL(90s) 内被读取一次即用，过期自动丢弃，避免污染后续轮次。
let pendingMemoText = '';
let pendingMemoAt = 0;
const PENDING_TTL_MS = 90_000;

/** inbound 算好小传注入行后调用（90 秒内有效） */
export function setPendingMemo(text: string): void {
  pendingMemoText = String(text || '').slice(0, 600);
  pendingMemoAt = Date.now();
}

/** 供 systemPrompt.context 的 text 提供者调用：过期/为空则返回 ''（不贡献内容） */
export function takePendingMemoText(): string {
  if (!pendingMemoText) return '';
  if (Date.now() - pendingMemoAt > PENDING_TTL_MS) { pendingMemoText = ''; return ''; }
  return pendingMemoText;
}
