const P = self.XhsParse;
const $ = (id) => document.getElementById(id);

async function loadNotes() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith('note:'))
    .map((k) => all[k])
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function currentNoteId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = tab && tab.url && tab.url.match(/xiaohongshu\.com\/(?:explore|discovery\/item|user\/profile\/[^/]+)\/([0-9a-f]{24})/);
  return m ? m[1] : '';
}

function safeFileName(name) {
  return (name || '小红书评论').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
}

function download(notes, name) {
  const blob = new Blob([P.toCSV(notes)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeFileName(name)}_${P.formatTime(Date.now()).replace(/[: ]/g, '-')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function noteCard(note, el) {
  const c = P.countRecords(note.comments);
  el.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = note.title || note.noteId;
  title.title = note.title || '';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `评论 ${c.top} 条 · 回复 ${c.reply} 条 · 共 ${c.total} 条`;
  const buttons = document.createElement('div');
  buttons.className = 'buttons';
  const exportBtn = document.createElement('button');
  exportBtn.textContent = '导出 CSV';
  exportBtn.onclick = () => download([note], note.title);
  const delBtn = document.createElement('button');
  delBtn.className = 'secondary danger';
  delBtn.textContent = '删除';
  delBtn.onclick = async () => {
    if (confirm(`删除“${note.title || note.noteId}”的记录？`)) await chrome.storage.local.remove('note:' + note.noteId);
  };
  buttons.append(exportBtn, delBtn);
  el.append(title, meta, buttons);
  return el;
}

async function render() {
  const [notes, curId] = await Promise.all([loadNotes(), currentNoteId()]);

  const current = notes.find((n) => n.noteId === curId);
  $('current').hidden = !curId;
  if (curId) {
    if (current) noteCard(current, $('current-body'));
    else $('current-body').textContent = '这篇笔记还没有记录到评论。如果评论区已经显示，请刷新页面后再滑动。';
  }

  const list = $('notes');
  list.innerHTML = '';
  for (const n of notes) list.append(noteCard(n, document.createElement('li')));
  $('empty').hidden = notes.length > 0;

  $('export-all').onclick = () => notes.length && download(notes, '小红书评论_全部');
  $('clear-all').onclick = async () => {
    if (notes.length && confirm('清空所有已记录的评论？')) await chrome.storage.local.remove(notes.map((n) => 'note:' + n.noteId));
  };
}

chrome.storage.onChanged.addListener(render);
render();
