// 解析小红书评论接口的返回数据，并转换成 CSV。
// 扩展（bridge.js、popup）和 Node 测试共用这一个文件。
(function (root) {
  const COMMENT_API = /\/api\/sns\/web\/v2\/comment\/(sub\/)?page/;

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatTime(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function contentOf(c) {
    let text = c.content || '';
    if (Array.isArray(c.pictures) && c.pictures.length) text += (text ? ' ' : '') + `[图片×${c.pictures.length}]`;
    return text;
  }

  function toRecord(c, parentId) {
    const target = c.target_comment || {};
    return {
      id: String(c.id),
      noteId: c.note_id || '',
      parentId: parentId || '',
      user: (c.user_info && c.user_info.nickname) || '',
      userId: (c.user_info && c.user_info.user_id) || '',
      // 回复的是楼主（一级评论）时，接口通常不带 target_comment，导出时再补上
      replyTo: parentId ? (target.user_info && target.user_info.nickname) || '' : '',
      content: contentOf(c),
      likes: c.like_count != null ? String(c.like_count) : '',
      timestamp: Number(c.create_time) || 0,
      ip: c.ip_location || '',
    };
  }

  // 把一次接口返回解析成扁平的记录数组（一级评论 + 它们的回复）
  function parseResponse(url, json) {
    const comments = json && json.data && json.data.comments;
    if (!Array.isArray(comments)) return [];
    let params;
    try {
      params = new URL(url, 'https://edith.xiaohongshu.com');
    } catch (_) {
      return [];
    }
    const isSub = /\/comment\/sub\/page/.test(params.pathname);
    const noteIdParam = params.searchParams.get('note_id') || '';
    const rootId = params.searchParams.get('root_comment_id') || '';

    const out = [];
    for (const c of comments) {
      if (!c || c.id == null) continue;
      if (isSub) {
        out.push(toRecord(c, rootId));
        continue;
      }
      out.push(toRecord(c, ''));
      for (const s of c.sub_comments || []) {
        if (s && s.id != null) out.push(toRecord(s, String(c.id)));
      }
    }
    for (const r of out) if (!r.noteId) r.noteId = noteIdParam;
    return out;
  }

  // 排成“一级评论，紧跟它的回复”的顺序，都按时间先后
  function orderRecords(records) {
    const byTime = (a, b) => a.timestamp - b.timestamp;
    const tops = records.filter((r) => !r.parentId).sort(byTime);
    const topIds = new Set(tops.map((r) => r.id));
    const replies = new Map();
    const orphans = [];
    for (const r of records) {
      if (!r.parentId) continue;
      if (!topIds.has(r.parentId)) orphans.push(r);
      else (replies.get(r.parentId) || replies.set(r.parentId, []).get(r.parentId)).push(r);
    }
    const ordered = [];
    for (const t of tops) {
      ordered.push(t);
      ordered.push(...(replies.get(t.id) || []).sort(byTime));
    }
    return ordered.concat(orphans.sort(byTime));
  }

  function csvCell(value) {
    let s = value == null ? '' : String(value);
    // 防止 Excel 把以 = + @ 开头的内容当成公式执行
    if (/^[=+@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  // notes: [{ noteId, title, comments: {id: record} }]
  function toCSV(notes) {
    const withNote = notes.length > 1;
    const header = ['楼层', '类型', '用户名', '内容', '点赞数', '时间', '回复对象', 'IP属地', '评论ID', '所属一级评论ID'];
    if (withNote) header.unshift('笔记标题', '笔记ID');
    const lines = [header.map(csvCell).join(',')];

    for (const note of notes) {
      const records = orderRecords(Object.values(note.comments || {}));
      const users = new Map(records.map((r) => [r.id, r.user]));
      let floor = 0;
      for (const r of records) {
        if (!r.parentId) floor++;
        const row = [
          r.parentId ? (users.has(r.parentId) ? floor : '') : floor,
          r.parentId ? '回复' : '评论',
          r.user,
          r.content,
          r.likes,
          formatTime(r.timestamp),
          r.parentId ? r.replyTo || users.get(r.parentId) || '' : '',
          r.ip,
          r.id,
          r.parentId,
        ];
        if (withNote) row.unshift(note.title || '', note.noteId);
        lines.push(row.map(csvCell).join(','));
      }
    }
    // 开头的 BOM 让 Excel 正确识别中文
    return '﻿' + lines.join('\r\n');
  }

  // 同一条评论可能在多次返回中出现，合并时保留已有的非空字段
  function mergeRecord(old, next) {
    if (!old) return next;
    const merged = { ...old };
    for (const [k, v] of Object.entries(next)) if (v !== '' && v != null && v !== 0) merged[k] = v;
    return merged;
  }

  function countRecords(comments) {
    let top = 0;
    let reply = 0;
    for (const r of Object.values(comments || {})) r.parentId ? reply++ : top++;
    return { top, reply, total: top + reply };
  }

  const api = { COMMENT_API, parseResponse, mergeRecord, orderRecords, toCSV, countRecords, formatTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XhsParse = api;
})(typeof self !== 'undefined' ? self : this);
