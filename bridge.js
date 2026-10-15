// 运行在扩展的隔离环境，接收 inject.js 转来的评论数据，存进 chrome.storage.local。
(() => {
  const SOURCE = 'xhs-comment-recorder';
  const P = self.XhsParse;
  let queue = Promise.resolve();

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.source !== SOURCE) return;
    const records = P.parseResponse(msg.url, msg.payload);
    if (!records.length) return;
    // 排队写入，避免连续两次返回互相覆盖
    queue = queue.then(() => save(records)).catch((err) => console.warn('[小红书评论记录器]', err));
  });

  function pageTitle(noteId) {
    // 只有当前地址就是这篇笔记时，页面标题才可信
    if (!location.pathname.includes(noteId)) return '';
    return document.title.replace(/\s*-\s*小红书\s*$/, '').trim();
  }

  async function save(records) {
    const groups = new Map();
    for (const r of records) {
      if (!r.noteId) continue;
      (groups.get(r.noteId) || groups.set(r.noteId, []).get(r.noteId)).push(r);
    }
    for (const [noteId, list] of groups) {
      const key = 'note:' + noteId;
      const stored = (await chrome.storage.local.get(key))[key];
      const note = stored || { noteId, title: '', url: '', comments: {} };
      note.title = pageTitle(noteId) || note.title || '笔记 ' + noteId;
      if (location.pathname.includes(noteId)) note.url = location.href;
      note.updatedAt = Date.now();
      for (const r of list) note.comments[r.id] = P.mergeRecord(note.comments[r.id], r);
      await chrome.storage.local.set({ [key]: note });
      chrome.runtime.sendMessage({ type: 'count', count: Object.keys(note.comments).length }).catch(() => {});
    }
  }
})();
