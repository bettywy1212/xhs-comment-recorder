// 运行：node test/xlsx.test.js [输出文件路径] [图片1.jpg 图片2.jpg ...]
// 生成一个带图片的示例 .xlsx，用来检查文件结构，也可以手动打开看效果
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const X = require('../lib/xlsx.js');

assert.strictEqual(X.crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'CRC32');

const out = process.argv[2] || path.join(require('os').tmpdir(), 'xhs-xlsx-test.xlsx');
const pics = process.argv.slice(3).map((f) => new Uint8Array(fs.readFileSync(f)));

const columns = [
  { header: '图片', width: 49 }, { header: '楼层', width: 6 }, { header: '类型', width: 6 }, { header: '用户名', width: 14 },
  { header: '内容', width: 40 }, { header: '点赞数', width: 8 },
];
const rows = [
  ['', 1, '评论', 'momo', '这家店真的好吃 <推荐> & "强烈"\n第二行', '32'],
  ['', 1, '回复', '小A', '同意\u0001（含控制字符）。这是一条很长很长的回复，用来检查自动估算的行高是否足够放下多行文字，不会被截断。', '2'],
  ['', 2, '评论', '图图', '[图片×4]', '1.2万'],
];
// 第 1 行 1 张；第 3 行 4 张，排成两行（3 + 1）
const box = 114;
const images = [];
if (pics[0]) images.push({ row: 0, col: 0, data: pics[0], width: 110, height: 83 });
pics.concat(pics[0] ? [pics[0]] : []).slice(0, 4).forEach((data, i) =>
  images.push({ row: 2, col: 0, data, width: 110, height: 83, dx: (i % 3) * box, dy: Math.floor(i / 3) * box })
);

const bytes = X.buildXlsx({ sheetName: '评论', columns, rows, images });

// 检查图片锚点：数据第 2 行（表头之后）对应表格第 3 行，锚点行号从 0 开始所以是 2+1
const text = Buffer.from(bytes).toString('latin1');
if (images.length) {
  const rowsInDrawing = [...text.matchAll(/<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/g)].map((m) => [+m[1], +m[2]]);
  assert.deepStrictEqual(rowsInDrawing.map((x) => x[1]), [1, 3, 3, 3, 3], '图片锚定在所属评论那一行');
  assert(rowsInDrawing.every((x) => x[0] === 0), '图片都在 A 列');
  assert(!/<a:off x="0" y="0"\/>/.test(text), '写入了绝对位置');
}
assert(/<row r="3" ht="\d+(\.\d+)?" customHeight="1">/.test(text), '每行都有固定行高');
fs.writeFileSync(out, bytes);
console.log('已生成', out, bytes.length, '字节，图片', images.length, '张');
