/**
 * sticker-store.ts — 表情包图库存储服务（P0 底座）
 *
 * 职责：把 QQ 群里的图片消息自动收藏为本地表情包库。
 *  - 安全下载（仅 HTTPS + SSRF 防护 + 大小上限 + 超时）
 *  - SHA-1 指纹去重（同图只存一份）
 *  - 分层目录 lib/candidate | library | negative + index.json 元数据
 *  - search/list 供 list_stickers 工具查询
 *
 * ⚠️ 本地手改功能（fork 新增，SDK 无此能力）：维护清单见工作区根《插件改动维护注意事项.md》。
 * 运行时数据根默认 = {agent cwd}/表情包（config.sticker.dataDir 可覆盖）。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import * as dns from 'node:dns';
import type { Logger } from '../types.js';

export type StickerLayer = 'candidate' | 'library' | 'negative' | 'trash';

/** 搜索词拆分: 空格/中英文逗号/顿号/分号分隔, 去空去重 */
function splitTerms(raw: string | undefined): string[] {
  return Array.from(new Set((raw ?? '').trim().toLowerCase().split(/[\s,，、;；]+/).filter(Boolean)));
}
/** 一条记录可搜索的拼接 hay(标签+描述+来源+发言者+原消息) */
function stickerHay(it: StickerMeta): string {
  return [it.tags.join(' '), it.desc ?? '', it.sourceGroup ?? '', it.senderName ?? '', it.msgText ?? ''].join(' ').toLowerCase();
}
/** 命中词数(0=无命中); 多词任一命中即可(OR), 命中越多越靠前 */
function hitCount(terms: string[], hay: string): number {
  let n = 0;
  for (const t of terms) if (hay.includes(t)) n += 1;
  return n;
}

export interface StickerMeta {
  id: string;
  layer: StickerLayer;
  hash: string;
  ext: string;
  size: number;
  sourceGroup?: string;
  senderId?: string;
  senderName?: string;
  msgText?: string;
  capturedAt: number;
  firstSeenAt: number;
  lastSeenAt: number;
  useCount: number;
  tags: string[];
  /** 详细描述(视觉自动生成/人工补; list_stickers 返回供挑选决策) */
  desc?: string;
  /** 是否等待整理(视觉打标失败/未打标) */
  needsDescribe?: boolean;
  /** 进回收站时间(trash 层超过回收期可物理删) */
  trashedAt?: number;
  /** 收藏前所在层(回收站还原用) */
  prevLayer?: StickerLayer;
  /** 来源图片 URL(群图 CDN 链接) —— agent 可用群消息里的 URL 反查本地文件 */
  sourceUrl?: string;
}

export interface CaptureInput {
  sourceGroup?: string;
  senderId?: string;
  senderName?: string;
  msgText?: string;
  /** 可选: 主动收藏时附带的标签/描述 */
  tags?: string[];
  desc?: string;
  /** 来源图片 URL(群消息里能看到的那条链接) */
  sourceUrl?: string;
}

export interface StickerSearchOptions {
  q?: string;
  tag?: string;
  limit: number;
  /** true=含回收站(默认不含) */
  includeTrash?: boolean;
}

export interface StickerHit {
  id: string;
  layer: StickerLayer;
  path: string;
  tags: string[];
  desc?: string;
  sourceGroup?: string;
  msgText?: string;
  capturedAt: number;
  useCount: number;
}

/** 图片大小上限（超过不收） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 下载超时 ms */
const DOWNLOAD_TIMEOUT_MS = 15_000;
/** 目录层 */
const LAYER_DIRS: Record<StickerLayer, string> = {
  candidate: 'lib/candidate',
  library: 'lib/library',
  negative: 'lib/negative',
  trash: 'lib/trash',
};
/** content_type → 扩展名 */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

// ── SSRF 防护（阻断指向私有/保留地址的下载） ──
const PRIVATE_RANGES: Array<[netmask: bigint, prefix: number]> = [
  [0x0A000000n, 8], // 10.0.0.0/8
  [0xAC100000n, 12], // 172.16.0.0/12
  [0xC0A80000n, 16], // 192.168.0.0/16
  [0x7F000000n, 8], // 127.0.0.0/8
  [0xA9FE0000n, 16], // 169.254.0.0/16
  [0xE0000000n, 4], // 224.0.0.0/4
];

function ipToBigInt(ip: string): bigint {
  return ip.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n);
}

function isPrivateIP(ip: string): boolean {
  // IPv4 映射 (::ffff:a.b.c.d) 剥前缀按 IPv4 判
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
      const val = ipToBigInt(v4);
      return PRIVATE_RANGES.some(([mask, prefix]) => (val >> (32n - BigInt(prefix))) === (mask >> (32n - BigInt(prefix))));
    }
    return true;
  }
  // IPv6 私有/本地/文档段：::1、fe8/fe9/fea/feb(link-local)、fc/fd(ULA)、2001:db8(文档)
  if (/^::1$/.test(ip)) return true;
  if (/^fe[89ab]c/i.test(ip)) return true;
  if (/^f[cd]/i.test(ip)) return true;
  if (/^2001:db8/i.test(ip)) return true;
  return false;
}

async function assertSafeHostname(hostname: string): Promise<void> {
  // v4+v6 全查（QQ 多媒体 CDN 域名常只有 AAAA 记录）
  const addrs = await dns.promises.lookup(hostname, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new Error(`DNS resolution failed: ${hostname}`);
  for (const { address } of addrs) {
    if (isPrivateIP(address)) throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${address}`);
  }
}

/** 魔数校验：仅接受 JPEG/PNG/GIF/WEBP/BMP（content_type 不可靠时的兜底，非图不入库） */
function isImageBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true; // GIF
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true; // WEBP
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true; // BMP
  return false;
}

export class StickerStore {
  private items = new Map<string, StickerMeta>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  readonly dataDir: string;

  constructor(dataDir: string, private logger?: Logger) {
    this.dataDir = dataDir;
    for (const dir of Object.values(LAYER_DIRS)) {
      mkdirSync(join(dataDir, dir), { recursive: true });
    }
    this.loadIndex();
  }

  private indexPath(): string {
    return join(this.dataDir, 'index.json');
  }

  private loadIndex(): void {
    try {
      const raw = readFileSync(this.indexPath(), 'utf8');
      const data = JSON.parse(raw) as { version?: number; items: StickerMeta[] };
      for (const it of data.items ?? []) {
        this.items.set(it.id, it);
      }
    } catch {
      this.items = new Map(); // 无 index：全新开始
    }
  }

  /** 防抖落盘 index.json（写操作先改内存） */
  private save(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.dirty) return;
      this.dirty = false;
      try {
        const payload = { version: 1, items: [...this.items.values()] };
        writeFileSync(this.indexPath(), JSON.stringify(payload, null, 2), 'utf8');
      } catch (err) {
        this.logger?.warn?.(`[sticker-store] index save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 500);
  }

  /** 关闭时立即落盘（进程退出兜底） */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      writeFileSync(this.indexPath(), JSON.stringify({ version: 1, items: [...this.items.values()] }, null, 2), 'utf8');
    } catch { /* ignore */ }
  }

  private filePathOf(meta: StickerMeta): string {
    return join(this.dataDir, LAYER_DIRS[meta.layer], `${meta.id}.${meta.ext}`);
  }

  /** 单条路径（给工具/发送用） */
  pathOf(id: string): string | undefined {
    const it = this.items.get(id);
    return it ? this.filePathOf(it) : undefined;
  }

  /**
   * 收藏一张图：安全下载 → SHA-1 去重 → 存候选区 → 记 index。
   * 返回 'new' | 'dup' | 'error'。
   */
  async capture(url: string, input: CaptureInput, contentType?: string): Promise<{ status: 'new' | 'dup' | 'error'; id?: string; error?: string }> {
    let buf: Buffer;
    try {
      buf = await this.download(url);
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }

    // 魔数校验：非图片(误收的语音/视频/未知)直接拒，不入库
    if (!isImageBuffer(buf)) {
      return { status: 'error', error: 'not an image (magic bytes mismatch)' };
    }

    const hash = createHash('sha1').update(buf).digest('hex');
    const id = hash.slice(0, 12);
    const now = Date.now();

    const existing = this.items.get(id);
    if (existing) {
      existing.lastSeenAt = now;
      this.save();
      return { status: 'dup', id };
    }

    const fromUrl = extname(new URL(url).pathname).replace(/^\./, '').slice(0, 5) || 'jpg';
    const ext = (contentType && MIME_EXT[contentType.toLowerCase()]) || fromUrl;

    const meta: StickerMeta = {
      id,
      layer: 'candidate',
      hash,
      ext,
      size: buf.length,
      sourceGroup: input.sourceGroup,
      senderId: input.senderId,
      senderName: input.senderName,
      msgText: input.msgText,
      capturedAt: now,
      firstSeenAt: now,
      lastSeenAt: now,
      useCount: 0,
      tags: input.tags ?? [],
      desc: input.desc,
      needsDescribe: !input.desc,
      sourceUrl: input.sourceUrl,
    };

    try {
      const dest = this.filePathOf(meta);
      const tmp = `${dest}.tmp-${now}`;
      writeFileSync(tmp, buf);
      renameSync(tmp, dest);
    } catch (err) {
      return { status: 'error', error: `write failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    this.items.set(id, meta);
    this.save();
    return { status: 'new', id };
  }

  /** 安全下载：仅 HTTPS + SSRF + 上限 + 超时 */
  private async download(url: string): Promise<Buffer> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error(`Only HTTPS allowed: ${parsed.protocol}`);
    await assertSafeHostname(parsed.hostname);
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new Error(`Image exceeds 10MB (${buf.length})`);
    return buf;
  }

  /** 从本地已有文件入库（后续升级/负样本用） */
  addLocalFile(srcPath: string, meta: Partial<StickerMeta> & { id: string; ext: string; layer: StickerLayer }): void {
    const now = Date.now();
    const full: StickerMeta = {
      id: meta.id,
      layer: meta.layer,
      hash: meta.hash ?? meta.id,
      ext: meta.ext,
      size: meta.size ?? 0,
      sourceGroup: meta.sourceGroup,
      senderId: meta.senderId,
      senderName: meta.senderName,
      msgText: meta.msgText,
      capturedAt: meta.capturedAt ?? now,
      firstSeenAt: meta.firstSeenAt ?? now,
      lastSeenAt: meta.lastSeenAt ?? now,
      useCount: meta.useCount ?? 0,
      tags: meta.tags ?? [],
      desc: meta.desc,
      needsDescribe: meta.needsDescribe,
      trashedAt: meta.trashedAt,
      prevLayer: meta.prevLayer,
    };
    if (existsSync(srcPath) && !existsSync(this.filePathOf(full))) {
      mkdirSync(join(this.dataDir, LAYER_DIRS[full.layer]), { recursive: true });
      renameSync(srcPath, this.filePathOf(full));
    }
    this.items.set(full.id, full);
    this.save();
  }

  /** 标记使用(候选→正式库并搬文件; 发送过=用过, 计入 useCount) */
  markUsed(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    it.useCount += 1;
    it.lastSeenAt = Date.now();
    if (it.layer === 'candidate') {
      const from = it.layer;
      it.layer = 'library';
      this.moveFile(it, from);
    }
    this.save();
  }

  /** 主动收藏/打标认可: 升级到正式区(不计数; 正式区不参与自动滚动清理) */
  promote(id: string): void {
    const it = this.items.get(id);
    if (!it || it.layer === 'library') return;
    if (it.layer === 'trash') { it.trashedAt = undefined; it.prevLayer = undefined; }
    const from = it.layer;
    it.layer = 'library';
    it.lastSeenAt = Date.now();
    this.moveFile(it, from);
    this.save();
  }

  markReaction(id: string, kind: 'like' | 'dislike'): void {
    const it = this.items.get(id);
    if (!it) return;
    if (kind === 'dislike' && it.layer !== 'negative') {
      const from = it.layer;
      it.layer = 'negative';
      this.moveFile(it, from);
    }
    this.save();
  }

  /** 查询：q/tag/描述命中 或 最近入库(默认不含回收站/负样本) */
  search(opts: StickerSearchOptions): StickerHit[] {
    const tag = (opts.tag ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(50, opts.limit || 10));

    let pool = [...this.items.values()].filter(it =>
      it.layer !== 'negative'
      && (opts.includeTrash === true || it.layer !== 'trash')
      && !it.msgText?.startsWith('[系统'),
    );

    if (tag) {
      pool = pool.filter(it => it.tags.some(t => t.toLowerCase().includes(tag)));
    }
    // 多词搜索: 拆词后"任一命中即可"(OR), 命中词越多排越前, 同分按最近入库
    const terms = splitTerms(opts.q);
    if (terms.length) {
      const scores = new Map<StickerMeta, number>();
      pool = pool.filter(it => {
        const n = hitCount(terms, stickerHay(it));
        if (n > 0) { scores.set(it, n); return true; }
        return false;
      });
      pool.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || (b.firstSeenAt - a.firstSeenAt));
    } else {
      pool.sort((a, b) => b.firstSeenAt - a.firstSeenAt);
    }
    const top = pool.slice(0, limit);
    return top.map(it => ({
      id: it.id,
      layer: it.layer,
      path: this.filePathOf(it),
      tags: it.tags,
      desc: it.desc,
      sourceGroup: it.sourceGroup,
      msgText: it.msgText,
      capturedAt: it.capturedAt,
      useCount: it.useCount,
    }));
  }

  /** 更新一张图的标签与详细描述(tags/desc 传 undefined 表示不动该项; 自动去重) */
  setDescTags(id: string, tags?: string[], desc?: string): boolean {
    const it = this.items.get(id);
    if (!it) return false;
    if (tags !== undefined) {
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const t of tags) {
        const c = (t ?? '').trim();
        if (c && !seen.has(c)) { seen.add(c); cleaned.push(c.slice(0, 20)); }
        if (cleaned.length >= 20) break;
      }
      it.tags = cleaned;
    }
    if (desc !== undefined) {
      const d = (desc ?? '').trim();
      if (d) {
        it.desc = d.slice(0, 300);
        it.needsDescribe = false;
      } else if (it.desc) {
        it.desc = undefined;
        it.needsDescribe = true;
      }
    }
    this.save();
    return true;
  }

  /** 把本地已有图片文件导入收藏(算hash去重, 复制进候选区); 返回 {status:'new'|'dup'|'error', id?} */
  importLocalFile(srcPath: string, input?: CaptureInput): { status: 'new' | 'dup' | 'error'; id?: string; error?: string } {
    try {
      if (!existsSync(srcPath)) return { status: 'error', error: `文件不存在: ${srcPath}` };
      const buf = readFileSync(srcPath);
      if (!isImageBuffer(buf)) return { status: 'error', error: 'not an image (magic bytes mismatch)' };
      const hash = createHash('sha1').update(buf).digest('hex');
      const id = hash.slice(0, 12);
      const existing = this.items.get(id);
      const now = Date.now();
      if (existing) {
        existing.lastSeenAt = now;
        this.save();
        return { status: 'dup', id };
      }
      const ext = (input?.sourceUrl ? extname(new URL(input.sourceUrl).pathname).replace(/^\./, '').slice(0, 5) : extname(srcPath).replace(/^\./, '').toLowerCase().slice(0, 5)) || 'jpg';
      const meta: StickerMeta = {
        id,
        layer: 'candidate',
        hash,
        ext,
        size: buf.length,
        sourceGroup: input?.sourceGroup,
        senderId: input?.senderId,
        senderName: input?.senderName,
        msgText: input?.msgText,
        capturedAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
        useCount: 0,
        tags: input?.tags ?? [],
        desc: input?.desc,
        needsDescribe: !input?.desc,
        sourceUrl: input?.sourceUrl,
      };
      const dest = this.filePathOf(meta);
      mkdirSync(join(this.dataDir, LAYER_DIRS.candidate), { recursive: true });
      if (!existsSync(dest)) {
        const tmp = `${dest}.tmp-${now}`;
        writeFileSync(tmp, buf);
        renameSync(tmp, dest);
      }
      this.items.set(id, meta);
      this.save();
      return { status: 'new', id };
    } catch (e) {
      return { status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** 送回收站(可逆; prevLayer 记原层用于还原) */
  markTrash(id: string): boolean {
    const it = this.items.get(id);
    if (!it || it.layer === 'trash') return false;
    const from = it.layer;
    it.prevLayer = it.layer;
    it.layer = 'trash';
    it.trashedAt = Date.now();
    this.moveFile(it, from);
    this.save();
    return true;
  }

  /** 从回收站还原(回到原层或候选区) */
  restore(id: string): boolean {
    const it = this.items.get(id);
    if (!it || it.layer !== 'trash') return false;
    const from = it.layer;
    it.layer = it.prevLayer ?? 'candidate';
    it.trashedAt = undefined;
    it.prevLayer = undefined;
    this.moveFile(it, from);
    this.save();
    return true;
  }

  /** 物理删除回收站中超过 ttlMs 的条目(含文件+index) */
  purgeTrashed(ttlMs = 30 * 24 * 3600 * 1000): number {
    const cutoff = Date.now() - ttlMs;
    let n = 0;
    for (const it of [...this.items.values()]) {
      if (it.layer === 'trash' && (it.trashedAt ?? it.lastSeenAt) < cutoff) {
        this.deleteFile(it);
        this.items.delete(it.id);
        n += 1;
      }
    }
    if (n > 0) this.save();
    return n;
  }

  /** 候选区超限清理: 超过 maxCandidates 时, 最久未见的滚进回收站(不物理删) */
  cleanupCandidates(maxCandidates: number): number {
    const cands = [...this.items.values()].filter(it => it.layer === 'candidate');
    if (cands.length <= maxCandidates) return 0;
    const sorted = cands.sort((a, b) => a.lastSeenAt - b.lastSeenAt); // 最旧在前
    const excess = sorted.slice(0, cands.length - maxCandidates);
    for (const it of excess) this.markTrash(it.id);
    return excess.length;
  }

  /** 清理损坏/空文件条目(文件缺失或 0 字节) */
  cleanupBroken(): number {
    let n = 0;
    for (const it of [...this.items.values()]) {
      try {
        const p = this.filePathOf(it);
        if (!existsSync(p)) {
          this.items.delete(it.id);
          n += 1;
          continue;
        }
        const st = statSync(p);
        if (st.size === 0) {
          this.deleteFile(it);
          this.items.delete(it.id);
          n += 1;
        }
      } catch {
        this.items.delete(it.id);
        n += 1;
      }
    }
    if (n > 0) this.save();
    return n;
  }

  /** 按层统计(整理/仪表盘用) */
  stats(): { total: number; candidate: number; library: number; trash: number; negative: number; untagged: number; totalBytes: number } {
    const s = { total: 0, candidate: 0, library: 0, trash: 0, negative: 0, untagged: 0, totalBytes: 0 };
    for (const it of this.items.values()) {
      s.total += 1;
      if (it.layer === 'candidate') s.candidate += 1;
      else if (it.layer === 'library') s.library += 1;
      else if (it.layer === 'trash') s.trash += 1;
      else s.negative += 1;
      if (!it.tags?.length && !it.desc) s.untagged += 1;
      s.totalBytes += it.size;
    }
    return s;
  }

  /** 按来源 URL 反查条目(agent 拿群消息里的 URL 定位本地图) */
  findBySourceUrl(url: string): StickerMeta | undefined {
    const u = (url ?? '').trim();
    if (!u) return undefined;
    for (const it of this.items.values()) {
      if (it.sourceUrl === u) return it;
    }
    // 容错: URL 归一(去 spec/query 尾参)或前缀匹配
    const norm = u.split('&spec=')[0] ?? u;
    for (const it of this.items.values()) {
      if (it.sourceUrl && it.sourceUrl.startsWith(norm)) return it;
    }
    return undefined;
  }

  /** 全量查询(管理面板用): 可按层/关键词/未打标过滤, 默认不含回收站 */
  queryAll(opts: { layer?: StickerLayer | 'all'; q?: string; untagged?: boolean; includeTrash?: boolean } = {}): Array<{ id: string; path: string; layer: StickerLayer; tags: string[]; desc?: string; useCount: number; size: number; firstSeenAt: number }> {
    // 多词搜索(同 search): 任一命中即可, 命中多排前
    const terms = splitTerms(opts.q);
    let pool = [...this.items.values()].filter(it => {
      if (!opts.includeTrash && it.layer === 'trash') return false;
      if (opts.layer && opts.layer !== 'all' && it.layer !== opts.layer) return false;
      if (opts.untagged && (it.tags?.length || it.desc)) return false;
      if (terms.length && hitCount(terms, stickerHay(it)) === 0) return false;
      return true;
    });
    if (terms.length) {
      const scores = new Map<StickerMeta, number>();
      for (const it of pool) scores.set(it, hitCount(terms, stickerHay(it)));
      pool.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || (b.firstSeenAt - a.firstSeenAt));
    } else {
      pool.sort((a, b) => b.firstSeenAt - a.firstSeenAt);
    }
    return pool.map(it => ({
      id: it.id,
      path: this.filePathOf(it),
      layer: it.layer,
      tags: it.tags,
      desc: it.desc,
      useCount: it.useCount,
      size: it.size,
      firstSeenAt: it.firstSeenAt,
    }));
  }

  get(id: string): StickerMeta | undefined {
    return this.items.get(id);
  }

  size(): number {
    return this.items.size;
  }

  private deleteFile(it: StickerMeta): void {
    try {
      const p = this.filePathOf(it);
      if (existsSync(p)) rmSync(p, { force: true });
    } catch { /* ignore */ }
  }

  /** 层间移动文件到新路径(目录自动建) */
  private moveFile(it: StickerMeta, fromLayer: StickerLayer): void {
    try {
      const from = join(this.dataDir, LAYER_DIRS[fromLayer], `${it.id}.${it.ext}`);
      const dir = join(this.dataDir, LAYER_DIRS[it.layer]);
      mkdirSync(dir, { recursive: true });
      const to = join(dir, `${it.id}.${it.ext}`);
      if (existsSync(from) && from !== to) renameSync(from, to);
    } catch { /* ignore */ }
  }
}

// ── 多例注册表(多账号支持, 2026-09-03): 每账号实例一个 dataDir → 各自独立的图库。
// Map<realpath(dataDir), StickerStore>; primary = 最早 configure 的实例(兼容原单账号无参调用)。
// ⚠️ 2026-09-11 B类修复: 单例时序坑 —— 多实例下"谁先 configure 谁定 primary",
//    无参 getStickerStore() 会拿到别的实例的库(多实例时序坑: list_stickers 串到别的实例图库)。
//    加 ns 维度: primary 按实例(ns)各记一份, 无参调用优先按调用者 ns 取。
const _stores = new Map<string, StickerStore>();
const _primaryByNs = new Map<string, string>();
let _primaryDir: string | undefined;

/**
 * 配置图库实例(启动期每账号按自己 dataDir 预初始化; 同目录幂等)。
 * ⚠️ 时序坑(线上踩坑)：必须启动早期按 config.cwd 解析的 dataDir 初始化，
 * 避免无参 getStickerStore 读到 process.cwd 的错目录(C盘幽灵库)。
 * ns: 实例标识(settingsNs), 多实例时用于无参调用精确取本实例库。
 */
export function configureStickerStore(dataDir: string, logger?: Logger, ns?: string): StickerStore {
  const key = resolve(dataDir);
  let s = _stores.get(key);
  if (!s) {
    s = new StickerStore(dataDir, logger);
    _stores.set(key, s);
  }
  if (!_primaryDir) _primaryDir = key;
  if (ns) _primaryByNs.set(ns, key);
  return s;
}

/** 获取图库实例。带 dataDir → 按目录取(不在则容错新建); 带 ns → 按该实例的 primary 取;
 *  无参 → 全局 primary(兼容单账号旧调用)。 */
export function getStickerStore(dataDir?: string, logger?: Logger, ns?: string): StickerStore {
  if (dataDir) {
    const key = resolve(dataDir);
    let s = _stores.get(key);
    if (!s) {
      s = new StickerStore(dataDir, logger);
      _stores.set(key, s);
    }
    return s;
  }
  if (ns) {
    const p = _primaryByNs.get(ns);
    if (p) {
      const s = _stores.get(p);
      if (s) return s;
    }
  }
  if (_primaryDir) {
    const s = _stores.get(_primaryDir);
    if (s) return s;
  }
  if (_stores.size === 1) return _stores.values().next().value as StickerStore;
  const dir = join(process.cwd(), '表情包');
  const s = new StickerStore(dir, logger);
  _stores.set(resolve(dir), s);
  if (!_primaryDir) _primaryDir = resolve(dir);
  if (ns) _primaryByNs.set(ns, resolve(dir));
  return s;
}
