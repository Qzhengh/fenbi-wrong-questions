/*
 粉笔抓取器 · 主控（运行在隔离世界 / ISOLATED world，document_idle）
 作用：
   1. 接收拦截器抓到的 solution / getReport 响应体；
   2. 在页面右下角放一个按钮，显示就绪状态(几/2)；
   3. 点击 → 导出 bundle JSON（内含 solution / getReport 文本 + 错题图片 base64）。
 v0.2 新增：自动抓取错题图片，打包成 bundle，本地用 unbundle.py 解压后继续走 parse.py / build_docx.js。
*/
(function () {
  const TAG = '[FENBI-GRABBER]';
  const captured = { solution: null, getReport: null, solutionUrl: '', getReportUrl: '' };

  window.addEventListener('message', function (ev) {
    const d = ev && ev.data;
    if (!d || d.__fenbiGrabber !== true) return;
    // 只保留更长的响应体，避免后续心跳/空响应覆盖已抓到的有效数据
    if (d.kind === 'solution') {
      if (!captured.solution || (d.body && d.body.length > captured.solution.length)) {
        captured.solution = d.body; captured.solutionUrl = d.url;
      }
    }
    if (d.kind === 'getReport') {
      if (!captured.getReport || (d.body && d.body.length > captured.getReport.length)) {
        captured.getReport = d.body; captured.getReportUrl = d.url;
      }
    }
    updateButton();
  });

  // ---------- 接收 background Service Worker 的 fallback 数据 ----------
  function mergeFromBackground(resp) {
    if (!resp || !resp.ok || !resp.captured) return;
    const c = resp.captured;
    if (c.solution && !captured.solution) {
      captured.solution = c.solution;
      captured.solutionUrl = c.solutionUrl || '';
      console.log(TAG, '从 background 补到 solution，长度', c.solution.length);
    }
    if (c.getReport && !captured.getReport) {
      captured.getReport = c.getReport;
      captured.getReportUrl = c.getReportUrl || '';
      console.log(TAG, '从 background 补到 getReport，长度', c.getReport.length);
    }
    updateButton();
  }

  function queryBackground() {
    try {
      chrome.runtime.sendMessage({ action: 'getCaptured' }, function (resp) {
        console.log(TAG, 'background 查询返回', resp ? {solution: !!resp.captured.solution, getReport: !!resp.captured.getReport} : 'null');
        mergeFromBackground(resp);
      });
    } catch (e) { console.warn(TAG, '查询 background 失败', e); }
  }

  // 启动后轮询几次 background，补上 MAIN world 拦截器漏掉的请求
  let pollCount = 0;
  const pollIv = setInterval(function () {
    queryBackground();
    if (++pollCount >= 10) clearInterval(pollIv);
  }, 1000);
  queryBackground();

  // ---------- 下载工具 ----------
  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  // ---------- MD5（与 Python hashlib.md5 一致，输出 32 位小写 hex） ----------
  function md5(str) {
    var utf8 = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) utf8.push(c);
      else if (c < 0x800) {
        utf8.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c < 0xd800 || c >= 0xe000) {
        utf8.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else {
        i++;
        c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
        utf8.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f),
                   0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    var nblk = Math.ceil((utf8.length + 9) / 64);
    var blks = new Array(nblk * 16);
    for (var i = 0; i < blks.length; i++) blks[i] = 0;
    for (var i = 0; i < utf8.length; i++) blks[i >> 2] |= utf8[i] << ((i % 4) * 8);
    blks[i >> 2] |= 0x80 << ((i % 4) * 8);
    blks[nblk * 16 - 2] = utf8.length * 8;

    function add(x, y) {
      var lsw = (x & 0xFFFF) + (y & 0xFFFF);
      var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
      return (msw << 16) | (lsw & 0xFFFF);
    }
    function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
    function cmn(q, a, b, x, s, t) { return add(rol(add(add(a, q), add(x, t)), s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }

    var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (var i = 0; i < blks.length; i += 16) {
      var olda = a, oldb = b, oldc = c, oldd = d;
      a = ff(a, b, c, d, blks[i+ 0],  7, -680876936);
      d = ff(d, a, b, c, blks[i+ 1], 12, -389564586);
      c = ff(c, d, a, b, blks[i+ 2], 17,  606105819);
      b = ff(b, c, d, a, blks[i+ 3], 22, -1044525330);
      a = ff(a, b, c, d, blks[i+ 4],  7, -176418897);
      d = ff(d, a, b, c, blks[i+ 5], 12,  1200080426);
      c = ff(c, d, a, b, blks[i+ 6], 17, -1473231341);
      b = ff(b, c, d, a, blks[i+ 7], 22,  -45705983);
      a = ff(a, b, c, d, blks[i+ 8],  7, 1770035416);
      d = ff(d, a, b, c, blks[i+ 9], 12, -1958414417);
      c = ff(c, d, a, b, blks[i+10], 17,     -42063);
      b = ff(b, c, d, a, blks[i+11], 22, -1990404162);
      a = ff(a, b, c, d, blks[i+12],  7, 1804603682);
      d = ff(d, a, b, c, blks[i+13], 12,  -40341101);
      c = ff(c, d, a, b, blks[i+14], 17, -1502002290);
      b = ff(b, c, d, a, blks[i+15], 22,  1236535329);

      a = gg(a, b, c, d, blks[i+ 1],  5, -165796510);
      d = gg(d, a, b, c, blks[i+ 6],  9, -1069501632);
      c = gg(c, d, a, b, blks[i+11], 14,  643717713);
      b = gg(b, c, d, a, blks[i+ 0], 20, -373897302);
      a = gg(a, b, c, d, blks[i+ 5],  5, -701558691);
      d = gg(d, a, b, c, blks[i+10],  9,   38016083);
      c = gg(c, d, a, b, blks[i+15], 14, -660478335);
      b = gg(b, c, d, a, blks[i+ 4], 20, -405537848);
      a = gg(a, b, c, d, blks[i+ 9],  5,  568446438);
      d = gg(d, a, b, c, blks[i+14],  9, -1019803690);
      c = gg(c, d, a, b, blks[i+ 3], 14, -187363961);
      b = gg(b, c, d, a, blks[i+ 8], 20,  1163531501);
      a = gg(a, b, c, d, blks[i+13],  5, -1444681467);
      d = gg(d, a, b, c, blks[i+ 2],  9,  -51403784);
      c = gg(c, d, a, b, blks[i+ 7], 14,  1735328473);
      b = gg(b, c, d, a, blks[i+12], 20, -1926607734);

      a = hh(a, b, c, d, blks[i+ 5],  4,    -378558);
      d = hh(d, a, b, c, blks[i+ 8], 11, -2022574463);
      c = hh(c, d, a, b, blks[i+11], 16,  1839030562);
      b = hh(b, c, d, a, blks[i+14], 23,   -35309556);
      a = hh(a, b, c, d, blks[i+ 1],  4, -1530992060);
      d = hh(d, a, b, c, blks[i+ 4], 11,  1272893353);
      c = hh(c, d, a, b, blks[i+ 7], 16,  -155497632);
      b = hh(b, c, d, a, blks[i+10], 23, -1094730640);
      a = hh(a, b, c, d, blks[i+13],  4,  681279174);
      d = hh(d, a, b, c, blks[i+ 0], 11,  -358537222);
      c = hh(c, d, a, b, blks[i+ 3], 16,  -722521979);
      b = hh(b, c, d, a, blks[i+ 6], 23,    76029189);
      a = hh(a, b, c, d, blks[i+ 9],  4,  -640364487);
      d = hh(d, a, b, c, blks[i+12], 11,  -421815835);
      c = hh(c, d, a, b, blks[i+15], 16,   530742520);
      b = hh(b, c, d, a, blks[i+ 2], 23,  -995338651);

      a = ii(a, b, c, d, blks[i+ 0],  6, -198630844);
      d = ii(d, a, b, c, blks[i+ 7], 10, 1126891415);
      c = ii(c, d, a, b, blks[i+14], 15, -1416354905);
      b = ii(b, c, d, a, blks[i+ 5], 21,  -57434055);
      a = ii(a, b, c, d, blks[i+12],  6, 1700485571);
      d = ii(d, a, b, c, blks[i+ 3], 10, -1894986606);
      c = ii(c, d, a, b, blks[i+10], 15,   -1051523);
      b = ii(b, c, d, a, blks[i+ 1], 21, -2054922799);
      a = ii(a, b, c, d, blks[i+ 8],  6, 1873313359);
      d = ii(d, a, b, c, blks[i+15], 10,  -30611744);
      c = ii(c, d, a, b, blks[i+ 6], 15, -1560198380);
      b = ii(b, c, d, a, blks[i+13], 21,  1309151649);
      a = ii(a, b, c, d, blks[i+ 4],  6, -145523070);
      d = ii(d, a, b, c, blks[i+11], 10, -1120210379);
      c = ii(c, d, a, b, blks[i+ 2], 15,  718787259);
      b = ii(b, c, d, a, blks[i+ 9], 21, -343485551);

      a = add(a, olda);
      b = add(b, oldb);
      c = add(c, oldc);
      d = add(d, oldd);
    }

    function rhex(n) {
      var s = '', hex = '0123456789abcdef';
      for (var j = 0; j <= 3; j++) {
        s += hex.charAt((n >> (j * 8 + 4)) & 0x0F) + hex.charAt((n >> (j * 8)) & 0x0F);
      }
      return s;
    }
    return rhex(a) + rhex(b) + rhex(c) + rhex(d);
  }

  // ---------- URL 规范化（与 parse.py / claim_images.py 一致） ----------
  function normalizeUrl(src) {
    let url = src || '';
    if (url.startsWith('//')) url = 'https:' + url;
    else if (url.startsWith('/')) url = 'https://fb.fenbike.cn' + url;
    return url;
  }

  function fnameFromUrl(src) {
    return md5(normalizeUrl(src)).slice(0, 12) + '.png';
  }

  // ---------- 从 HTML 片段中提取 img src ----------
  function extractImgSrcs(html) {
    const urls = [];
    if (!html) return urls;
    const div = document.createElement('div');
    div.innerHTML = html;
    const imgs = div.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
      const s = imgs[i].getAttribute('src');
      if (s) urls.push(s);
    }
    return urls;
  }

  // ---------- 复现 parse.py 的错题图片 URL 收集 ----------
  function collectWrongImageUrls(solutionText, getReportText) {
    const sol = JSON.parse(solutionText);
    const rep = JSON.parse(getReportText);

    const sols = {};
    (sol.solutions || []).forEach(function (s) { sols[s.globalId] = s; });
    const mats = {};
    (sol.materials || []).forEach(function (m) { mats[m.globalId] = m; });
    const ua = rep.data && rep.data.userAnswers ? rep.data.userAnswers : {};

    // 建立 key -> materialKeys 映射
    const matkeys = {};
    function walk(node) {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (typeof node === 'object') {
        const nt = String(node.nodeType || '');
        if (nt === '2') {
          const mk = node.materialKeys;
          if (mk) {
            try { matkeys[node.key] = (typeof mk === 'string') ? JSON.parse(mk) : mk; }
            catch (e) { matkeys[node.key] = []; }
          }
        }
        (node.children || []).forEach(walk);
      }
    }
    walk(sol.card);

    const urls = new Set();
    Object.keys(ua).forEach(function (key) {
      if (ua[key].status !== -1) return;
      const s = sols[key];
      if (!s) return;

      // 题干、解析
      extractImgSrcs(s.content).forEach(function (u) { urls.add(normalizeUrl(u)); });
      extractImgSrcs(s.solution).forEach(function (u) { urls.add(normalizeUrl(u)); });

      // 选项/accessories
      (s.accessories || []).forEach(function (acc) {
        if (acc.type !== 101 && acc.type !== 102) return;
        (acc.options || []).forEach(function (opt) {
          extractImgSrcs(opt).forEach(function (u) { urls.add(normalizeUrl(u)); });
        });
      });

      // 共享材料
      (matkeys[key] || []).forEach(function (mk) {
        if (mats[mk]) {
          extractImgSrcs(mats[mk].content).forEach(function (u) { urls.add(normalizeUrl(u)); });
        }
      });
    });

    return Array.from(urls);
  }

  // ---------- 取图：先尝试 crossOrigin canvas，失败再请求 SW fetch ----------
  function fetchImageCrossOrigin(url) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('crossOrigin load failed')); };
      img.src = url;
    });
  }

  function fetchImageViaSW(url) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({ action: 'fetchImage', url: url }, function (resp) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (resp && resp.ok && resp.dataUrl) resolve(resp.dataUrl);
        else reject(new Error((resp && resp.error) || 'unknown'));
      });
    });
  }

  async function grabImage(url, onProgress) {
    // 先尝试 crossOrigin canvas（可拿到解密后的像素）
    try {
      const dataUrl = await fetchImageCrossOrigin(url);
      if (onProgress) onProgress(url, 'canvas');
      return { ok: true, dataUrl: dataUrl, via: 'canvas' };
    } catch (e) {
      // fallback：请求 background SW 跨域 fetch
      try {
        const dataUrl = await fetchImageViaSW(url);
        if (onProgress) onProgress(url, 'sw');
        return { ok: true, dataUrl: dataUrl, via: 'sw' };
      } catch (e2) {
        if (onProgress) onProgress(url, 'failed', e2.message || String(e2));
        return { ok: false, error: e2.message || String(e2), via: 'failed' };
      }
    }
  }

  // ---------- 图片诊断（保留并增强） ----------
  function imageDiagnostic() {
    const lines = [];
    const imgs = Array.prototype.slice.call(document.images || []);
    const canvases = Array.prototype.slice.call(document.querySelectorAll('canvas'));
    let http = 0, blob = 0, data = 0, other = 0;
    const samples = [];
    imgs.forEach(function (im) {
      const s = im.currentSrc || im.src || '';
      if (/^https?:/.test(s)) http++;
      else if (/^blob:/.test(s)) blob++;
      else if (/^data:/.test(s)) data++;
      else other++;
      if (samples.length < 6 && s) samples.push(s.length > 100 ? s.slice(0, 100) + '…' : s);
    });

    lines.push('===== 粉笔抓取器 · 图片诊断 =====');
    lines.push('content <img> 总数: ' + imgs.length +
               ' | http(s):' + http + ' blob:' + blob + ' data:' + data + ' 其它:' + other);
    lines.push('<canvas> 总数: ' + canvases.length);
    lines.push('样本里是否见到公式图(formula/latex): ' +
               (samples.some(function (s) { return /formula|latex/i.test(s); }) ? '是' : '未在样本中看到'));
    lines.push('src 样本:');
    samples.forEach(function (s, i) { lines.push('  ' + (i + 1) + '. ' + s); });

    let taintTest = '未找到可测试的图片';
    const target = imgs.find(function (im) {
      const s = im.currentSrc || im.src || '';
      return (im.naturalWidth || im.width) > 24 && !/^data:/.test(s);
    });
    if (target) {
      try {
        const c = document.createElement('canvas');
        const w = target.naturalWidth || target.width;
        const h = target.naturalHeight || target.height;
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(target, 0, 0, w, h);
        const url = c.toDataURL('image/png');
        taintTest = '成功 ✅ 能从渲染图导出 PNG（toDataURL 长度 ' + url.length +
                    '，被测图 ' + w + '×' + h + '）→ 加密图可用 canvas 方案抓取';
      } catch (e) {
        taintTest = '失败 ❌ ' + (e && e.name) + ': ' + (e && e.message) +
                    ' → 该图 canvas 被污染，v0.2 用 crossOrigin 重载 / Service Worker 兜底';
      }
    }
    lines.push('canvas 快照测试: ' + taintTest);
    lines.push('===============================');
    return lines.join('\n');
  }

  // ---------- 导出主流程 ----------
  async function doExport() {
    const haveS = !!captured.solution, haveR = !!captured.getReport;
    const diag = imageDiagnostic();
    console.log(TAG + '\n' + diag);

    if (!haveS || !haveR) {
      const miss = [haveS ? null : 'solution', haveR ? null : 'getReport'].filter(Boolean).join(' 和 ');
      alert('还没抓到 ' + miss + '。\n\n请在本报告页按 ⌘R / F5 刷新一次，' +
            '让抓取器在页面加载时拦到请求；刷新后等按钮变绿(2/2)再点导出。');
      return;
    }

    // 收集错题图片 URL
    let imageUrls = [];
    try {
      imageUrls = collectWrongImageUrls(captured.solution, captured.getReport);
      console.log(TAG, '识别到错题图片 URL 数:', imageUrls.length);
    } catch (e) {
      console.error(TAG, '解析错题图片 URL 失败', e);
      alert('解析图片 URL 时出错：' + (e.message || e));
      return;
    }

    setButtonBusy('正在抓图 0/' + imageUrls.length);

    const images = {};
    let done = 0, canvasOk = 0, swOk = 0, failed = 0;
    const failedUrls = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const res = await grabImage(url, function (_, via, err) {
        if (via === 'canvas') canvasOk++;
        else if (via === 'sw') swOk++;
        else if (via === 'failed') failed++;
      });
      done++;
      if (res.ok) {
        const fn = fnameFromUrl(url);
        images[fn] = res.dataUrl;
      } else {
        failedUrls.push({ url: url, error: res.error });
        console.warn(TAG, '取图失败', url, res.error);
      }
      setButtonBusy('正在抓图 ' + done + '/' + imageUrls.length +
                    ' (canvas:' + canvasOk + ' sw:' + swOk + ' 失败:' + failed + ')');
    }

    // 构建 bundle（作为备份）
    const bundle = {
      version: '0.3',
      capturedAt: new Date().toISOString(),
      solution: captured.solution,
      getReport: captured.getReport,
      images: images,
      meta: {
        totalUrls: imageUrls.length,
        success: Object.keys(images).length,
        canvasOk: canvasOk,
        swOk: swOk,
        failed: failedUrls
      }
    };

    setButtonBusy('正在生成 Word...');

    try {
      // 解析并生成 docx
      const data = window.FenbiParser.buildItems(captured.solution, captured.getReport);
      const result = window.FenbiDocxBuilder.buildDocx(data, images);
      const blob = await docx.Packer.toBlob(result.doc);
      downloadBlob('错题集.docx', blob);

      // 同时下载 bundle 作为备份（用户可忽略）
      const bundleText = JSON.stringify(bundle);
      const bundleName = 'fenbi-bundle-' + new Date().getTime() + '.json';
      setTimeout(function () {
        downloadBlob(bundleName, new Blob([bundleText], { type: 'application/json;charset=utf-8' }));
      }, 600);

      setTimeout(function () { resetButton(); }, 2000);

      let summary = '✅ 已导出 错题集.docx\n' +
                    '题目：' + data.items.length + ' 道\n' +
                    '图片：识别 ' + imageUrls.length + ' 张，成功 ' + Object.keys(images).length + ' 张\n';
      if (result.missing.length) {
        summary += '⚠️ 有 ' + result.missing.length + ' 张图缺失（Word 中显示占位框）\n';
        console.warn(TAG, '缺图清单', result.missing);
      } else {
        summary += '✅ 所有图片完整\n';
      }
      summary += '\n备份 bundle 也已下载：' + bundleName;
      console.log(TAG + '\n' + summary);
      alert(summary);
    } catch (e) {
      console.error(TAG, '生成 Word 失败', e);
      // 出错时退回到只导出 bundle
      const bundleText = JSON.stringify(bundle);
      const bundleName = 'fenbi-bundle-' + new Date().getTime() + '.json';
      downloadBlob(bundleName, new Blob([bundleText], { type: 'application/json;charset=utf-8' }));
      alert('生成 Word 失败：' + (e.message || e) + '\n\n已导出备份 bundle ' + bundleName +
            '，可继续用 python3 unbundle.py → parse.py → build_docx.js 出 Word。');
      setTimeout(function () { resetButton(); }, 2000);
    }
  }

  // ---------- 悬浮按钮 ----------
  let btn = null;
  function makeButton() {
    if (document.getElementById('fb-grabber-btn')) return;
    if (!document.body) return;
    btn = document.createElement('button');
    btn.id = 'fb-grabber-btn';
    btn.textContent = '生成错题集 Word';
    const css = {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647,
      padding: '10px 14px', background: '#2E75B6', color: '#fff', border: 'none',
      borderRadius: '8px', fontSize: '14px', cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,.3)', fontFamily: 'sans-serif'
    };
    for (const k in css) btn.style[k] = css[k];
    btn.addEventListener('click', doExport);
    document.body.appendChild(btn);
    updateButton();
  }
  function updateButton() {
    if (!btn) return;
    const n = (captured.solution ? 1 : 0) + (captured.getReport ? 1 : 0);
    btn.textContent = (n === 2) ? '生成错题集 Word ✅(2/2)' : ('生成错题集 Word (' + n + '/2 已就绪)');
    btn.style.background = (n === 2) ? '#2E7D32' : '#2E75B6';
    btn.disabled = false;
  }
  function setButtonBusy(text) {
    if (!btn) return;
    btn.textContent = text;
    btn.style.background = '#F57C00';
    btn.disabled = true;
  }
  function resetButton() {
    updateButton();
  }

  // 有的页面渲染较晚，轮询挂按钮
  let tries = 0;
  const iv = setInterval(function () {
    makeButton();
    if (++tries > 40 || document.getElementById('fb-grabber-btn')) clearInterval(iv);
  }, 500);

  console.log(TAG, '主控已就绪（ISOLATED world）v0.2');
})();
