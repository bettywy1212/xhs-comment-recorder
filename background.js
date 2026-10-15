importScripts('lib/parse.js');
const P = self.XhsParse;

// 两张图片之间的间隔，避免短时间内集中请求
const GAP_MS = 400;

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;
  // 在扩展图标上显示当前标签页已记录的评论数，方便确认正在记录
  if (msg.type === 'count' && sender.tab) {
    const tabId = sender.tab.id;
    chrome.action.setBadgeText({ tabId, text: String(msg.count) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#ff2442' });
  }
  if (msg.type === 'downloadImages' && msg.noteId) downloadImages(msg.noteId);
});

const running = new Set();

// 进度存在 storage.session 里，弹窗关掉再打开也能看到
function setProgress(noteId, progress) {
  return chrome.storage.session.set({ ['dl:' + noteId]: progress });
}

// 等一个下载结束，返回 true 表示成功
function waitForDownload(id) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(ok);
    };
    const onChanged = (delta) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete') finish(true);
      if (delta.state.current === 'interrupted') finish(false);
    };
    const timer = setTimeout(() => finish(false), 60000);
    chrome.downloads.onChanged.addListener(onChanged);
    // 下载可能在监听开始前就已经结束了
    chrome.downloads.search({ id }).then(([item]) => {
      if (item && item.state === 'complete') finish(true);
      if (item && item.state === 'interrupted') finish(false);
    });
  });
}

async function downloadImages(noteId) {
  if (running.has(noteId)) return;
  running.add(noteId);
  try {
    const key = 'note:' + noteId;
    const note = (await chrome.storage.local.get(key))[key];
    const tasks = note ? P.imageTasks(note) : [];
    const progress = { total: tasks.length, done: 0, failed: 0, finished: false };
    await setProgress(noteId, progress);

    for (const task of tasks) {
      let ok = false;
      try {
        const id = await chrome.downloads.download({
          url: task.url,
          filename: task.path,
          conflictAction: 'overwrite',
          saveAs: false,
        });
        ok = await waitForDownload(id);
      } catch (err) {
        console.warn('[小红书评论记录器] 图片下载失败', task.url, err);
      }
      ok ? progress.done++ : progress.failed++;
      await setProgress(noteId, progress);
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
    progress.finished = true;
    await setProgress(noteId, progress);
  } finally {
    running.delete(noteId);
  }
}
