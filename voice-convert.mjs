// voice-convert.mjs — QQ/微信 SILK v3 语音 → 浏览器可播 mp3(纯 JS, 零系统依赖, 通用插件可直接打包)
// 依赖: silk-wasm(SILK 解码 → pcm_s16le) + lamejs(纯 JS mp3 编码)。
// QQ 语音文件头 "#!SILK_V3"; 采样率 24000/16000/12000/8000 逐试(QQ 常见 24k)。
import { decode } from 'silk-wasm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lamejs = require('lamejs-fixed'); // CJS 加载(1.2.2 fixed 版, 修官方 1.2.1 循环引用 bug)

const SILK_HEAD_RE = /^#!SILK/i;

/** 是否 SILK 语音(头 "#!SILK", 允许 QQ 前导字节) */
export function isSilk(buf) {
  try {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return u.subarray(0, 24).toString('latin1').indexOf('#!SILK') >= 0;
  } catch { return false; }
}

/**
 * SILK → mp3(buffer)。返回 { mp3: Buffer, ms: number }
 * @param {Uint8Array|Buffer} silkBytes
 */
export async function silkToMp3(silkBytes) {
  const data = silkBytes instanceof Uint8Array ? silkBytes : new Uint8Array(silkBytes);
  let lastErr = null;
  for (const rate of [24000, 16000, 12000, 8000]) {
    try {
      const dec = await decode(data, rate); // pcm_s16le mono
      const pcm16 = new Int16Array(dec.data.buffer, dec.data.byteOffset, dec.data.length / 2);
      const enc = new lamejs.Mp3Encoder(1, rate, 48);
      const CHUNK = 1152 * 4;
      const parts = [];
      for (let i = 0; i < pcm16.length; i += CHUNK) {
        const blk = enc.encodeBuffer(pcm16.subarray(i, Math.min(i + CHUNK, pcm16.length)));
        if (blk.length) parts.push(Buffer.from(blk));
      }
      const last = enc.flush();
      if (last.length) parts.push(Buffer.from(last));
      return { mp3: Buffer.concat(parts), ms: dec.duration };
    } catch (e) { lastErr = e; }
  }
  throw new Error('SILK 解码失败: ' + String((lastErr && lastErr.message) || lastErr).slice(0, 160));
}

export default { isSilk, silkToMp3 };
