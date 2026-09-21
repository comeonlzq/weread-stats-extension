/* 后台 Service Worker：仅在微信读书页面启用侧边栏，其他页面点击图标回退为弹窗 */
'use strict';

const WEREAD_RE = /^https:\/\/weread\.qq\.com\//;

/** 按标签页启用/禁用侧边栏，并设置工具栏图标的点击行为 */
async function applyTab(tabId, url) {
  const isWr = typeof url === 'string' && WEREAD_RE.test(url);
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: isWr,
    });
  } catch { /* 标签页可能已关闭 */ }
  try {
    // 微信读书页：点击图标打开右侧侧边栏（清空 popup）；其他页：打开统计弹窗
    await chrome.action.setPopup({ tabId, popup: isWr ? '' : 'dashboard.html' });
  } catch { /* ignore */ }
}

async function init() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch { /* 旧版 Chrome 忽略 */ }
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((t) => applyTab(t.id, t.url)));
  } catch { /* ignore */ }
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.tabs.onCreated.addListener((tab) => applyTab(tab.id, tab.url));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'complete') applyTab(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId)
    .then((t) => applyTab(tabId, t.url))
    .catch(() => { /* ignore */ });
});
