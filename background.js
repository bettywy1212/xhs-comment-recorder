// 在扩展图标上显示当前标签页已记录的评论数，方便确认正在记录
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'count' && sender.tab) {
    const tabId = sender.tab.id;
    chrome.action.setBadgeText({ tabId, text: String(msg.count) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#ff2442' });
  }
});
