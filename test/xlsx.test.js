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
  { header: '楼层', width: 6 }, { header: '类型', width: 6 }, { header: '用户名', width: 16 },
  { header: '内容', width: 50 }, { header: '点赞数', width: 8 }, { header: '图片1', width: 24 }, { header: '图片2', width: 24 },
];
const rows = [
  [1, '评论', 'momo', '这家店真的好吃 <推荐> & "强烈"\n第二行', '32', '', ''],
  [1, '回复', '小A', '同意\u0001（含控制字符）', '2', '', ''],
  [2, '评论', '图图', '[图片×2]', '1.2万', '', ''],
];
const images = pics.slice(0, 2).map((data, i) => ({ row: 2, col: 5 + i, data, width: 160, height: 120 }));
if (pics[2]) images.push({ row: 0, col: 5, data: pics[2], width: 160, height: 120 });

const bytes = X.buildXlsx({ sheetName: '评论', columns, rows, images });
fs.writeFileSync(out, bytes);
console.log('已生成', out, bytes.length, '字节，图片', images.length, '张');
