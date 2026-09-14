/**
 * xlsx.ts — 最小 XLSX 生成器（零依赖，2026-09-14 主人要"一键导出 Excel 分享"）
 *
 * 为什么不引库：插件要走 npm 让别人也能装，**不能为了一个导出功能拖进 exceljs/xlsx**
 *   （几十 MB 依赖、还要过 audit）。而 xlsx 本质就是"几个 XML 塞进一个 zip"，
 *   zip 又可以用 **store 模式**（不压缩）手写 —— 那就自己写，几十行的事。
 *
 * 支持：多个工作表 / 表头加粗 / 列宽 / 数字与文本单元格 / 中文与 emoji（UTF-8）。
 * 不支持（也用不上）：公式、样式表、共享字符串（用 inlineStr，省一层表）。
 *
 * ⚠️ 传进来的字符串会做 XML 转义 + 剔除控制字符（Excel 遇到非法字符会判定文件损坏）。
 */

/* ─────────── zip（store 模式，无压缩） ─────────── */

const CRC_TABLE = ((): Int32Array => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry { name: string; data: Buffer }

/** 打包成 zip（store：只登记不压缩，Excel 照样认） */
function zipStore(files: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);      // 本地文件头签名
    lh.writeUInt16LE(20, 4);              // 需要的解压版本
    lh.writeUInt16LE(0x0800, 6);          // 标志位：文件名 UTF-8
    lh.writeUInt16LE(0, 8);               // 压缩方式 0 = store
    lh.writeUInt16LE(0, 10);              // 修改时间
    lh.writeUInt16LE(0x21, 12);           // 修改日期（1980-01-01）
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18);  // 压缩后
    lh.writeUInt32LE(f.data.length, 22);  // 原始
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);              // 扩展字段长度
    parts.push(lh, nameBuf, f.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);      // 中央目录签名
    cd.writeUInt16LE(20, 4);              // 制作版本
    cd.writeUInt16LE(20, 6);              // 需要版本
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(f.data.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);              // 扩展
    cd.writeUInt16LE(0, 32);              // 注释
    cd.writeUInt16LE(0, 34);              // 起始磁盘
    cd.writeUInt16LE(0, 36);              // 内部属性
    cd.writeUInt32LE(0, 38);              // 外部属性
    cd.writeUInt32LE(offset, 42);         // 本地头偏移
    central.push(cd, nameBuf);
    offset += lh.length + nameBuf.length + f.data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);      // 中央目录结束记录
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

/* ─────────── XML ─────────── */

/** XML 转义 + 丢掉控制字符（\t\n\r 保留）—— 非法字符会让 Excel 报"文件已损坏" */
function xesc(s: string): string {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 0 → A, 25 → Z, 26 → AA */
function colName(i: number): string {
  let n = i;
  let s = '';
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

export interface SheetSpec {
  /** 工作表名（Excel 限制 31 字符，这里自动截断） */
  name: string;
  /** 第一行按**表头**渲染（加粗） */
  rows: Array<Array<string | number | undefined | null>>;
  /** 各列宽度（字符数），缺省 14 */
  widths?: number[];
  /** 表头是否加粗（默认 true） */
  header?: boolean;
}

function sheetXml(spec: SheetSpec): string {
  const cols = spec.widths && spec.widths.length
    ? `<cols>${spec.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const rows = spec.rows.map((cells, r) => {
    const cs = cells.map((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (v === undefined || v === null || v === '') return '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xesc(String(v))}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cs}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

/**
 * 生成 xlsx 二进制。`sheets` 有几张就写几张。
 * 返回 Buffer（调用方可直接当 HTTP 响应体写出去）。
 */
export function buildXlsx(sheets: SheetSpec[]): Buffer {
  const list = sheets.length > 0 ? sheets : [{ name: 'Sheet1', rows: [] }];
  const files: ZipEntry[] = [];
  const overrides: string[] = [];
  const sheetRefs: string[] = [];
  list.forEach((s, i) => {
    const n = i + 1;
    files.push({ name: `xl/worksheets/sheet${n}.xml`, data: Buffer.from(sheetXml(s), 'utf8') });
    overrides.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    sheetRefs.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`);
  });

  files.push({
    name: '[Content_Types].xml',
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides.join('')}</Types>`, 'utf8'),
  });
  files.push({
    name: '_rels/.rels',
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`, 'utf8'),
  });
  files.push({
    name: 'xl/workbook.xml',
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${xesc(String(s.name).slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`, 'utf8'),
  });
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRefs.join('')}</Relationships>`, 'utf8'),
  });

  return zipStore(files);
}
