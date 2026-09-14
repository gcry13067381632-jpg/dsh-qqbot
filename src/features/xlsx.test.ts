/**
 * xlsx.test.ts — 导出用的最小 XLSX 生成器（2026-09-14）
 *
 * 钉住：① 是合法 zip（本地头/中央目录/EOCD 三件套齐全）；
 *      ② 必需部件都在（[Content_Types].xml / _rels/.rels / workbook / 各 sheet）；
 *      ③ 中文与 emoji 原样可读；④ XML 特殊字符被转义（不然 Excel 判定文件损坏）；
 *      ⑤ 数字写成数字单元格，空值不写。
 */
import { describe, expect, it } from 'vitest';
import { buildXlsx } from './xlsx.js';

/** 极简 zip 读取（只认本生成器用的 store 模式）—— 顺便当"能不能被解析"的证据 */
function readZip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const dataStart = i + 30 + nameLen + extraLen;
    out.set(name, buf.subarray(dataStart, dataStart + size).toString('utf8'));
    i = dataStart + size;
  }
  return out;
}

describe('buildXlsx — 最小 xlsx 生成', () => {
  const buf = buildXlsx([
    { name: '熟识度', rows: [['昵称', '熟识度'], ['亚瑟', 52]], widths: [16, 10] },
    { name: '好感度', rows: [['昵称', '好感度'], ['做早饭', 0.038]] },
  ]);

  it('是合法 zip：本地文件头 + 中央目录 + EOCD 结束记录', () => {
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);                    // PK\x03\x04
    const tail = buf.subarray(buf.length - 22);
    expect(tail.readUInt32LE(0)).toBe(0x06054b50);                   // PK\x05\x06
    expect(tail.readUInt16LE(10)).toBe(6);                           // 2 张表 + 4 个固定部件
  });

  it('必需部件齐全，工作表按名字挂上 workbook', () => {
    const files = readZip(buf);
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ].sort());
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="熟识度"');
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="好感度"');
    expect(files.get('[Content_Types].xml')).toContain('/xl/worksheets/sheet2.xml');
  });

  it('中文与 emoji 原样可读；数字是数字单元格；空值不写', () => {
    const sheet = readZip(buf).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<t xml:space="preserve">昵称</t>');
    expect(sheet).toContain('<t xml:space="preserve">亚瑟</t>');
    expect(sheet).toContain('<v>52</v>');          // 数字不加引号
    expect(sheet).toContain('width="16"');
    const emoji = buildXlsx([{ name: 'x', rows: [['古都吹面包⁧🍞', 1, '', null]] }]);
    expect(readZip(emoji).get('xl/worksheets/sheet1.xml')).toContain('古都吹面包⁧🍞');
    expect(readZip(emoji).get('xl/worksheets/sheet1.xml')!.match(/<c r=/g)!.length).toBe(2);   // 空的没写
  });

  it('XML 特殊字符被转义 + 控制字符被剔除（不然 Excel 会报文件损坏）', () => {
    const out = buildXlsx([{ name: 'x', rows: [['<a>&"b"', 'ok\u0007\u0001']] }]);
    const sheet = readZip(out).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('&lt;a&gt;&amp;&quot;b&quot;');
    expect(sheet).toContain('<t xml:space="preserve">ok</t>');
  });

  it('工作表名超 31 字符自动截断', () => {
    const out = buildXlsx([{ name: 'x'.repeat(50), rows: [] }]);
    expect(readZip(out).get('xl/workbook.xml')).toContain(`name="${'x'.repeat(31)}"`);
  });
});
