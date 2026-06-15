/*
 粉笔抓取器 · 后台服务 (MV3 Service Worker)
 作用：
   1. content.js 受 CORS 限制无法直接 fetch 图床图片时，SW 拥有 host_permissions，
      可以跨域抓取图片并返回 base64 data URL。
   2. 监听 chrome.webRequest，捕获 solution / getReport 的请求 URL，然后主动重抓响应体。
      这是 MAIN world 拦截器的 fallback：如果页面在拦截器注入前就已发出请求，
      这里能补上，减少用户需要刷新的次数。
   3. 用 chrome.storage.session 暂存抓到的数据，避免 SW 被回收后丢失。
*/

const TAG = '[FENBI-GRABBER/SW]';
const STORAGE_KEY = 'captured';

// ---------- 读写 session storage（异步） ----------
function storageGet() {
  return new Promise((resolve) => {
    chrome.storage.session.get(STORAGE_KEY, (res) => {
      resolve(res[STORAGE_KEY] || { solution: null, getReport: null, solutionUrl: '', getReportUrl: '' });
    });
  });
}

function storageSet(value) {
  return new Promise((resolve) => {
    chrome.storage.session.set({ [STORAGE_KEY]: value }, resolve);
  });
}

// ---------- 图片抓取（content.js 请求） ----------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchImage') {
    fetch(request.url, { method: 'GET' })
      .then(resp => {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.blob();
      })
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ ok: true, dataUrl: reader.result });
        reader.onerror = () => sendResponse({ ok: false, error: 'FileReader failed' });
        reader.readAsDataURL(blob);
      })
      .catch(err => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
    return true; // 异步响应
  }

  if (request.action === 'getCaptured') {
    storageGet().then(captured => {
      sendResponse({ ok: true, captured: captured });
    });
    return true; // 异步响应
  }
});

// ---------- webRequest 监听 + 重抓 fallback ----------
function kindOf(url) {
  if (!url) return null;
  if (/getreport/i.test(url)) return 'getReport';
  if (/(^|[\/?=&])solutions?([?\/&]|$)/i.test(url)) return 'solution';
  return null;
}

async function fetchText(url) {
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return await resp.text();
}

async function tryCapture(kind, url) {
  const captured = await storageGet();
  if (captured[kind] && captured[kind].length > 1000) return; // 已有有效数据

  console.log(TAG, 'webRequest 捕获', kind, url);

  // getReport 重抓会报 "无效DeviceSid"，不能作为 fallback；只记录 URL，等 MAIN 拦截器。
  if (kind === 'getReport') {
    captured.getReportUrl = url;
    await storageSet(captured);
    return;
  }

  try {
    const text = await fetchText(url);
    if (!text || text.length <= 1000 || !/^\s*\{/.test(text)) {
      console.warn(TAG, 'SW 重抓内容无效，长度', text ? text.length : 0);
      return;
    }
    captured[kind] = text;
    captured[kind + 'Url'] = url;
    await storageSet(captured);
    console.log(TAG, 'SW 重抓成功', kind, '长度', text.length);
  } catch (e) {
    console.warn(TAG, 'SW 重抓失败', kind, e.message);
  }
}

if (chrome.webRequest && chrome.webRequest.onCompleted) {
  const filter = {
    urls: ['*://*.fenbi.com/*', '*://*.fenbike.cn/*']
    // 不限制 types，兼容 fetch/xhr/子框架等所有请求类型
  };
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      const kind = kindOf(details.url);
      if (!kind) return;
      console.log(TAG, 'onCompleted 捕获', kind, details.type, details.url);
      tryCapture(kind, details.url);
    },
    filter
  );
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      const kind = kindOf(details.url);
      if (!kind) return;
      console.log(TAG, 'onBeforeRequest 捕获', kind, details.type, details.url);
    },
    filter
  );
} else {
  console.warn(TAG, 'chrome.webRequest 不可用');
}

// ---------- 最早注入 interceptor.js（比 content_scripts document_start 更早） ----------
if (chrome.webNavigation && chrome.scripting) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    // 只处理主框架；frameId 0 是主框架
    if (details.frameId !== 0) return;
    // 只处理目标域名
    const url = details.url || '';
    if (!/\.fenbi\.com\//.test(url) && !/\.fenbike\.cn\//.test(url)) return;

    console.log(TAG, 'webNavigation 注入 interceptor，tabId=', details.tabId);
    chrome.scripting.executeScript({
      target: { tabId: details.tabId, frameIds: [0] },
      files: ['interceptor.js'],
      world: 'MAIN',
      injectImmediately: true
    }).catch(err => {
      console.warn(TAG, 'injectImmediately 失败', err && err.message);
    });
  });
} else {
  console.warn(TAG, 'chrome.webNavigation 或 chrome.scripting 不可用');
}
