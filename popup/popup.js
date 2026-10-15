const P = self.XhsParse;
const $ = (id) => document.getElementById(id);

// 正在导出 Excel 的笔记的进度文字，以及上一次导出的结果，弹窗重新渲染时保留
const exporting = new Map();
const lastMessages = new Map();

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

function saveFile(data, type, name, ext) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = `${safeFileName(name)}_${P.formatTime(Date.now()).replace(/[: ]/g, '-')}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function download(notes, name) {
  saveFile(P.toCSV(notes), 'text/csv;charset=utf-8', name, 'csv');
}

async function exportXlsx(note) {
  const id = note.noteId;
  const update = (text) => {
    exporting.set(id, text);
    render();
  };
  update('正在准备…');
  let msg;
  try {
    const { bytes, total, failed, failedFloors } = await self.XhsExport.noteToXlsx(note, (done, all) => {
      if (all) update(`正在加载图片 ${done}/${all}，请不要关闭弹窗…`);
    });
    saveFile(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', note.title, 'xlsx');
    if (failed) {
      const floors = [...new Set(failedFloors)].filter((f) => f !== '').slice(0, 5).join('、');
      msg =
        `已导出。${total} 张图片中有 ${failed} 张重试后仍未能加载` +
        (floors ? `（第 ${floors} 楼）` : '') +
        `，已在“图片链接”列标注“未能加载”，可以手动打开，或者稍后再导出一次。`;
    } else {
      msg = `已导出${total ? `，${total} 张图片全部加载成功` : ''}`;
    }
  } catch (err) {
    msg = '导出失败：' + (err && err.message ? err.message : err);
    console.error(err);
  }
  exporting.delete(id);
  lastMessages.set(id, msg);
  render();
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
  const imgCount = Object.values(note.comments || {}).reduce((n, r) => n + (r.images || []).length, 0);
  meta.textContent = `评论 ${c.top} 条 · 回复 ${c.reply} 条 · 共 ${c.total} 条` + (imgCount ? ` · 图片 ${imgCount} 张` : '');
  const buttons = document.createElement('div');
  buttons.className = 'buttons';
  const exportBtn = document.createElement('button');
  exportBtn.textContent = '导出 CSV';
  exportBtn.onclick = () => download([note], note.title);
  const busy = exporting.get(note.noteId);
  const xlsxBtn = document.createElement('button');
  xlsxBtn.textContent = busy ? '导出中…' : '导出 Excel';
  xlsxBtn.disabled = !!busy;
  xlsxBtn.onclick = () => exportXlsx(note);
  exportBtn.className = 'secondary';
  const status = document.createElement('div');
  status.className = 'meta status';
  status.textContent = busy || lastMessages.get(note.noteId) || '';
  // 旧版本采集的记录没有图片信息，提示重新采集
  const outdated = Object.values(note.comments || {}).some((r) => !('images' in r));
  const outdatedHint = document.createElement('div');
  outdatedHint.className = 'meta warn';
  outdatedHint.textContent = '这条记录来自旧版本插件，缺少图片信息。请删除后刷新笔记页面，重新滑一遍评论区。';
  const delBtn = document.createElement('button');
  delBtn.className = 'secondary danger';
  delBtn.textContent = '删除';
  delBtn.onclick = async () => {
    if (confirm(`删除“${note.title || note.noteId}”的记录？`)) await chrome.storage.local.remove('note:' + note.noteId);
  };
  buttons.append(xlsxBtn, exportBtn, delBtn);
  el.append(title, meta);
  if (outdated) el.append(outdatedHint);
  el.append(buttons);
  if (status.textContent) el.append(status);
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
