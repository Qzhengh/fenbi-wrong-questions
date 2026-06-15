/*
 粉笔抓取器 · 拦截器（运行在页面 JS 上下文 / MAIN world，document_start）
 作用：在粉笔自己的脚本发请求之前，给 fetch 和 XHR 打补丁，
       把 solution / getReport 两个响应体偷一份出来，
       通过 window.postMessage 交给隔离世界的 content.js。
 不改变页面任何行为（响应用 clone 读，不影响粉笔自己消费）。
*/
(function () {
  const TAG = '[FENBI-GRABBER]';

  // 判断一个 URL 是哪类接口。用 URL 分隔符做边界，避免误伤 "resolution" 之类。
  function kindOf(url) {
    if (!url) return null;
    if (/getreport/i.test(url)) return 'getReport';
    if (/(^|[\/?=&])solutions?([?\/&]|$)/i.test(url)) return 'solution';
    return null;
  }

  function send(kind, url, body) {
    try {
      window.postMessage({ __fenbiGrabber: true, kind: kind, url: url, body: body }, '*');
      console.log(TAG, '抓到', kind, '长度=', body ? body.length : 0, url);
    } catch (e) {
      console.warn(TAG, 'postMessage 失败', e);
    }
  }

  // ---- 补丁 fetch ----
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function () {
        const args = arguments;
        const p = origFetch.apply(this, args);
        try {
          const req = args[0];
          const url = (typeof req === 'string') ? req : (req && req.url) || '';
          const kind = kindOf(url);
          if (kind) {
            p.then(function (resp) {
              try {
                resp.clone().text().then(function (t) { send(kind, url, t); }).catch(function () {});
              } catch (e) {}
            }).catch(function () {});
          }
        } catch (e) {}
        return p;
      };
    }
  } catch (e) { console.warn(TAG, 'fetch 补丁失败', e); }

  // ---- 补丁 XHR ----
  try {
    const XO = XMLHttpRequest.prototype.open;
    const XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__fbUrl = url; } catch (e) {}
      return XO.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      try {
        const kind = kindOf(this.__fbUrl);
        if (kind) {
          this.addEventListener('load', function () {
            try {
              let t = '';
              try { t = this.responseText; } catch (_) {}
              if (!t && this.response && typeof this.response === 'object') {
                try { t = JSON.stringify(this.response); } catch (_) {}
              }
              if (t) send(kind, this.__fbUrl, t);
            } catch (e) {}
          });
        }
      } catch (e) {}
      return XS.apply(this, arguments);
    };
  } catch (e) { console.warn(TAG, 'XHR 补丁失败', e); }

  console.log(TAG, '拦截器已安装（MAIN world）');

  // ---- 兜底：从 performance timeline 里找已发出的 solution/getReport，再 fetch 一次 ----
  // 有些页面在拦截器注入前就已发请求，上面补丁会漏。这里通过浏览器 Performance API
  // 读取已完成的资源 URL，然后主动重新请求，把响应体补回来。
  const capturedFromPerf = { solution: false, getReport: false };
  function tryFetchFromPerf(url, kind) {
    if (capturedFromPerf[kind]) return;
    // getReport 重抓会报 "无效DeviceSid"，跳过；只尝试 solution 兜底
    if (kind === 'getReport') return;
    fetch(url, { method: 'GET', credentials: 'same-origin' })
      .then(function (resp) { return resp.text(); })
      .then(function (text) {
        // 过滤掉心跳/空响应：必须像 JSON 且足够长
        if (text && text.length > 1000 && /^\s*\{/.test(text)) {
          capturedFromPerf[kind] = true;
          send(kind, url, text);
        }
      })
      .catch(function () {});
  }
  function perfFallback() {
    try {
      const entries = performance.getEntriesByType('resource');
      entries.forEach(function (entry) {
        const url = entry.name;
        const kind = kindOf(url);
        if (kind) tryFetchFromPerf(url, kind);
      });
    } catch (e) {}
  }
  // 页面加载后 1s 开始轮询，持续 15s
  setTimeout(function () {
    perfFallback();
    let tries = 0;
    const iv = setInterval(function () {
      perfFallback();
      if (++tries >= 14 || (capturedFromPerf.solution && capturedFromPerf.getReport)) {
        clearInterval(iv);
      }
    }, 1000);
  }, 1000);
})();
