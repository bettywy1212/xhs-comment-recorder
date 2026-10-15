// 运行：node test/parse.test.js
const assert = require('assert');
const P = require('../lib/parse.js');
const page = require('./fixtures/comment-page.json');
const sub = require('./fixtures/sub-page.json');

const NOTE = '6700000000000000000000aa';
const pageUrl = `https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=${NOTE}&cursor=&top_comment_id=&image_formats=jpg,webp,avif`;
const subUrl = `https://edith.xiaohongshu.com/api/sns/web/v2/comment/sub/page?note_id=${NOTE}&root_comment_id=c1&num=10&cursor=r2`;

assert(P.COMMENT_API.test(pageUrl) && P.COMMENT_API.test(subUrl));
assert(!P.COMMENT_API.test('https://edith.xiaohongshu.com/api/sns/web/v1/feed'));

const a = P.parseResponse(pageUrl, page);
assert.strictEqual(a.length, 4);
assert.deepStrictEqual(a.map((r) => [r.id, r.parentId]), [['c1', ''], ['r1', 'c1'], ['r2', 'c1'], ['c2', '']]);
assert.strictEqual(a[2].replyTo, '小A');
assert.strictEqual(a[3].content, '[图片×1]');

const b = P.parseResponse(subUrl, sub);
assert.strictEqual(b.length, 2);
assert(b.every((r) => r.parentId === 'c1' && r.noteId === NOTE));

// 合并去重（r2 在两次返回中都出现）
const comments = {};
for (const r of [...a, ...b]) comments[r.id] = P.mergeRecord(comments[r.id], r);
assert.strictEqual(comments.r2.ip, '浙江', '合并时不丢已有字段');
assert.deepStrictEqual(P.countRecords(comments), { top: 2, reply: 3, total: 5 });

const order = P.orderRecords(Object.values(comments)).map((r) => r.id);
assert.deepStrictEqual(order, ['c2', 'c1', 'r1', 'r2', 'r3']);

const csv = P.toCSV([{ noteId: NOTE, title: '测试笔记', comments }]);
assert(csv.startsWith('﻿"楼层"'));
assert(csv.includes('"\'=1+1 在哪里"'), '公式注入防护');
assert(csv.includes('"这家店真的好吃，""强烈""推荐"'), '引号转义');
assert(csv.includes('"第二行\n换行内容"'), '换行保留在单元格内');
assert(csv.includes('"回复","小A","同意"') && csv.includes('"momo"'));
// r1 回复一级评论时没有 target_comment，回复对象补为楼主
assert(/"回复","小A","同意","2","[^"]+","momo"/.test(csv));

const multi = P.toCSV([{ noteId: NOTE, title: 'T1', comments }, { noteId: 'n2', title: 'T2', comments: {} }]);
assert(multi.startsWith('﻿"笔记标题","笔记ID"'));

assert.deepStrictEqual(P.parseResponse(pageUrl, { code: -1, data: null }), []);
console.log('全部通过 ✓');
