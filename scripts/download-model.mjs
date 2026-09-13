/**
 * download-model.mjs — 一键下载插件用的**本地小模型**（bge-small-zh-v1.5, ONNX 量化版 ≈ 23MB）
 *
 * 用途: 插件用它在本地给群消息打"值不值得回"的分（价值评分）→ 低分闲聊不唤醒 AI = 省 token。
 *       模型只在本机 CPU 跑，**完全离线**，不上传任何内容。
 *
 * 用法:
 *   node scripts/download-model.mjs                  # 下到默认位置 {DSH_HOME|~/.dsh}/models/bge-small-zh
 *   node scripts/download-model.mjs --dir D:\m\bge   # 自定义目录(填进插件配置 localModel.modelDir)
 *   node scripts/download-model.mjs --source hf      # 强制官方源(默认: 先试国内镜像 hf-mirror.com)
 *
 * 需要: Node ≥ 18（dsh 本身要求 Node ≥ 22, 所以一定有）
 */
import { mkdirSync, createWriteStream, statSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// ⚠️ 仓库必须是 **Xenova**(transformers.js 转换版, 才有 onnx/ 量化权重); BAAI 官方仓库没有 onnx 目录
const REPO = 'Xenova/bge-small-zh-v1.5';
/** 需要下载的文件（相对仓库路径 → 相对模型目录路径），带最小体积校验（KB） */
const FILES = [
  { repo: 'onnx/model_quantized.onnx', local: 'onnx/model_quantized.onnx', minKB: 20000, label: '模型权重(量化 ONNX)' },
  { repo: 'tokenizer.json', local: 'tokenizer.json', minKB: 300, label: '分词器' },
  { repo: 'tokenizer_config.json', local: 'tokenizer_config.json', minKB: 0.2, label: '分词器配置' },
  { repo: 'config.json', local: 'config.json', minKB: 0.3, label: '模型配置' },
];
const MIRRORS = {
  mirror: 'https://hf-mirror.com',   // 国内镜像（默认优先）
  hf: 'https://huggingface.co',      // 官方源
};

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const dshHome = (process.env.DSH_HOME && process.env.DSH_HOME.trim()) || join(homedir(), '.dsh');
const modelDir = arg('dir', join(dshHome, 'models', 'bge-small-zh'));
const source = arg('source', '');
const bases = source ? [MIRRORS[source]].filter(Boolean) : [MIRRORS.mirror, MIRRORS.hf];

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

/** 下载单文件（支持多源回退 + 进度打印 + 大小校验） */
async function fetchOne(base, file) {
  const url = `${base}/${REPO}/resolve/main/${file.repo}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') || 0);
  const dest = join(modelDir, file.local);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  let got = 0;
  let lastPrint = 0;
  const stream = Readable.fromWeb(res.body);
  stream.on('data', (chunk) => {
    got += chunk.length;
    const now = Date.now();
    if (now - lastPrint > 400) {
      lastPrint = now;
      const pct = total ? ` ${Math.round((got / total) * 100)}%` : '';
      process.stdout.write(`\r   ${file.label}: ${mb(got)}${total ? ` / ${mb(total)}` : ''}${pct}   `);
    }
  });
  await pipeline(stream, createWriteStream(tmp));
  process.stdout.write('\r');
  const size = statSync(tmp).size;
  if (size < file.minKB * 1024) {
    throw new Error(`文件太小(${mb(size)}), 可能下载不完整`);
  }
  renameSync(tmp, dest);
  console.log(`   ✓ ${file.local}  ${mb(size)}`);
}

console.log(`\n本地小模型下载: ${REPO}`);
console.log(`目标目录: ${modelDir}`);
console.log(`下载源: ${bases.join(' → ')}（失败自动换下一个）\n`);

let failed = 0;
for (const file of FILES) {
  const dest = join(modelDir, file.local);
  if (existsSync(dest) && statSync(dest).size >= file.minKB * 1024) {
    console.log(`   ↷ ${file.local} 已存在(${mb(statSync(dest).size)}), 跳过`);
    continue;
  }
  let ok = false;
  for (const base of bases) {
    try {
      await fetchOne(base, file);
      ok = true;
      break;
    } catch (err) {
      console.log(`   ✗ ${file.local} 从 ${base} 下载失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!ok) failed += 1;
}

if (failed > 0) {
  console.log(`\n有 ${failed} 个文件没下成功。可以:`);
  console.log('  · 换个源重试: node scripts/download-model.mjs --source hf');
  console.log('  · 或手动下载（README「本地小模型」一节有三个文件的直链）');
  process.exit(1);
}

console.log('\n✔ 全部就绪。');
console.log('接下来:');
console.log('  1. 插件设置页 → 本地小模型 → 勾选「启用」、模式选 block(低分不唤醒)、门槛 0.5');
console.log(`  2. 模型目录留空即用默认位置; 换了别处就填: ${modelDir}`);
console.log('  3. 群里发两条闲聊试试 —— 面板「最近评分」能看到分数和 gate 模式\n');
