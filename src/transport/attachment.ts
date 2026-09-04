/**
 * 附件下载 — 将 QQ 文件附件安全下载到本地
 *
 * 下载后仅通过 @路径 提示模型，由模型通过 tool-bash / tool-fs 自行读取，
 * 不内联内容（避免 token 浪费与上下文污染）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as dns from 'node:dns';
import type { Logger, RawAttachment } from '../types.js';

/** 下载大小上限（超过则跳过下载，仅保留路径提示） */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
/** 下载超时（毫秒） */
const DOWNLOAD_TIMEOUT_MS = 15_000;

/** 下载结果 */
export interface DownloadedFile {
  /** 原始文件名（用于与消息附件关联） */
  filename: string;
  /** 本地绝对路径 */
  localPath: string;
  /** 相对 cwd 的显示路径（@提及 / 工具访问用） */
  displayPath: string;
}

/** 文件名净化：去路径、过滤危险字符，防止路径穿越 */
function sanitizeFilename(name: string): string {
  const base = basename(name.replace(/\\/g, '/'));
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'attachment';
}

/** 字节数格式化 */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

// ── SSRF 防护：阻断解析到私有/保留地址的下载 ──

const PRIVATE_RANGES: Array<[netmask: bigint, prefix: number]> = [
  [0x0A000000n, 8], // 10.0.0.0/8
  [0xAC100000n, 12], // 172.16.0.0/12
  [0xC0A80000n, 16], // 192.168.0.0/16
  [0x7F000000n, 8], // 127.0.0.0/8
  [0xA9FE0000n, 16], // 169.254.0.0/16
  [0xE0000000n, 4], // 224.0.0.0/4 (multicast)
];

function ipToBigInt(ip: string): bigint {
  return ip.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n);
}

function isPrivateIP(ip: string): boolean {
  const val = ipToBigInt(ip);
  return PRIVATE_RANGES.some(
    ([mask, prefix]) => (val >> (32n - BigInt(prefix))) === (mask >> (32n - BigInt(prefix))),
  );
}

/** 解析 hostname 并阻断指向私有/内网地址的 URL（SSRF 防护） */
async function assertSafeHostname(hostname: string): Promise<void> {
  const addresses = await dns.promises.resolve4(hostname).catch(() => []);
  if (addresses.length === 0) throw new Error(`DNS resolution failed: ${hostname}`);
  for (const addr of addresses) {
    if (isPrivateIP(addr)) throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${addr}`);
  }
}

/** 安全下载：仅 HTTPS + SSRF 防护 + 大小上限 + 超时，返回下载字节数 */
async function download(url: string, destPath: string, maxBytes: number): Promise<number> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error(`Only HTTPS allowed: ${parsed.protocol}`);
  }
  await assertSafeHostname(parsed.hostname);

  const resp = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error(`Download exceeds ${Math.floor(maxBytes / 1024 / 1024)}MB`);
  }
  writeFileSync(destPath, buf);
  return buf.length;
}

/**
 * 下载消息中的 file 附件到本地
 *
 * 下载目录为 {cwd}/.qqbot/{messageId}，用 messageId 隔离跨消息重名。
 * 下载失败不返回（由调用方回退描述），下载成功仅保留路径供模型用工具读取。
 */
export async function downloadFileAttachments(
  attachments: RawAttachment[] | undefined,
  cwd: string,
  messageId: string,
  logger: Logger,
): Promise<DownloadedFile[]> {
  const files = (attachments ?? []).filter(a => a.content_type === 'file' && a.url);
  if (files.length === 0) return [];

  const dir = join(cwd, '.qqbot', messageId);
  mkdirSync(dir, { recursive: true });

  const results: DownloadedFile[] = [];
  for (const file of files) {
    const safeName = sanitizeFilename(file.filename);
    const localPath = join(dir, safeName);
    const displayPath = `.qqbot/${messageId}/${safeName}`;

    if (file.size > MAX_DOWNLOAD_BYTES) {
      logger.debug(`im-qqbot: skip download (${file.size}B too large): ${file.filename}`);
      results.push({ filename: file.filename, localPath, displayPath });
      continue;
    }

    let bytes: number;
    try {
      bytes = await download(file.url, localPath, MAX_DOWNLOAD_BYTES);
    } catch (err) {
      logger.warn(`im-qqbot: download failed: ${file.filename} — ${err instanceof Error ? err.message : String(err)}`);
      continue; // 下载失败不加入结果，由 buildDynamicCtx 回退为描述
    }
    logger.debug(`im-qqbot: attachment downloaded: ${file.filename} (${formatSize(bytes)}) → ${displayPath}`);

    results.push({ filename: file.filename, localPath, displayPath });
  }

  return results;
}
