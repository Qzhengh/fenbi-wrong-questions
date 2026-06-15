/*
 粉笔抓取器 · 数据解析器（浏览器版 parse.py）
 作用：把 solution / getReport JSON 解析成与 errors.json 的 items 一致的结构，
       供 docx-builder.js 直接生成 Word。
 运行在 ISOLATED world，依赖 DOM 解析 HTML。
*/
(function () {
  const TAG = '[FENBI-PARSER]';

  // ---------- MD5（与 Python hashlib.md5 一致） ----------
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

  function normalizeUrl(src) {
    var url = src || '';
    if (url.indexOf('//') === 0) url = 'https:' + url;
    else if (url.indexOf('/') === 0) url = 'https://fb.fenbike.cn' + url;
    return url;
  }

  function fnameFromUrl(src) {
    return md5(normalizeUrl(src)).slice(0, 12) + '.png';
  }

  // ---------- HTML entity 解码（用 textarea  trick） ----------
  const _unescapeEl = document.createElement('textarea');
  function unescapeHtml(s) {
    _unescapeEl.innerHTML = s;
    return _unescapeEl.value;
  }

  // ---------- 文本分段（对应 parse.py _text_segments） ----------
  function textSegments(htmlfrag) {
    if (!htmlfrag) return [];
    var s = htmlfrag;
    s = s.replace(/<\/p\s*>/gi, '\n');
    s = s.replace(/<p\b[^>]*>/gi, '\n');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<[^>]+>/g, '');
    s = unescapeHtml(s);

    var segs = [];
    var first = true;
    var lines = s.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim().replace(/\xa0/g, ' ').trim();
      if (!t) continue;
      segs.push({ type: 'text', val: t, nl: !first });
      first = false;
    }
    return segs;
  }

  // ---------- HTML 拆成 parts（对应 parse.py html_to_parts） ----------
  function htmlToParts(h) {
    var parts = [];
    if (!h) return parts;
    var pos = 0;
    var re = /<img[^>]*>/gi;
    var m;
    while ((m = re.exec(h)) !== null) {
      var pre = h.substring(pos, m.index);
      parts = parts.concat(textSegments(pre));
      var tag = m[0];
      var srcMatch = tag.match(/src=\\?"?([^"\\>\s]+)/);
      var wMatch = tag.match(/width=\\?"?(\d+)/);
      var hMatch = tag.match(/height=\\?"?(\d+)/);
      var srcval = srcMatch ? srcMatch[1] : '';
      var isTex = /flag="tex"/.test(tag) || /flag=\\"tex\\"/.test(tag) ||
                  /latex/.test(srcval) || /formula/.test(srcval);
      parts.push({
        type: 'img',
        src: srcval,
        w: wMatch ? parseInt(wMatch[1], 10) : 0,
        h: hMatch ? parseInt(hMatch[1], 10) : 0,
        is_tex: isTex
      });
      pos = m.index + m[0].length;
    }
    parts = parts.concat(textSegments(h.substring(pos)));
    return parts;
  }

  // ---------- Card 树遍历 ----------
  function walkCard(card) {
    var section = {};
    var matkeys = {};
    var order = [];
    function walk(node) {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (typeof node === 'object') {
        var nt = String(node.nodeType || '');
        if (nt === '1') {
          var sec = node.name || '';
          (node.children || []).forEach(function (c) {
            if (String(c.nodeType || '') === '2') {
              section[c.key] = sec;
              var mk = c.materialKeys;
              if (mk) {
                try { matkeys[c.key] = (typeof mk === 'string') ? JSON.parse(mk) : mk; }
                catch (e) { matkeys[c.key] = []; }
              }
            }
          });
        }
        if (nt === '2') order.push(node.key);
        (node.children || []).forEach(walk);
      }
    }
    walk(card);
    var gno = {};
    for (var i = 0; i < order.length; i++) gno[order[i]] = i + 1;
    return { section: section, matkeys: matkeys, order: order, gno: gno };
  }

  // ---------- 主入口 ----------
  function buildItems(solutionText, getReportText) {
    var sol = JSON.parse(solutionText);
    var rep = JSON.parse(getReportText);

    var sols = {};
    (sol.solutions || []).forEach(function (s) { sols[s.globalId] = s; });
    var mats = {};
    (sol.materials || []).forEach(function (m) { mats[m.globalId] = m; });
    var ua = rep.data && rep.data.userAnswers ? rep.data.userAnswers : {};

    var tree = walkCard(sol.card);
    var section = tree.section;
    var matkeys = tree.matkeys;
    var gno = tree.gno;

    var wrong = Object.keys(ua).filter(function (k) { return ua[k].status === -1; });
    wrong.sort(function (a, b) { return (gno[a] || 99999) - (gno[b] || 99999); });

    var NUM2LETTER = ['A', 'B', 'C', 'D', 'E', 'F'];
    var items = [];

    wrong.forEach(function (k) {
      var s = sols[k];
      if (!s) { console.warn(TAG, '题号', k, '在 solution 中找不到'); return; }

      var stem = htmlToParts(s.content || '');
      var materials = (matkeys[k] || []).filter(function (mk) { return mats[mk]; })
        .map(function (mk) { return htmlToParts(mats[mk].content || ''); });
      var opts = [];
      (s.accessories || []).forEach(function (acc) {
        if (acc.type !== 101 && acc.type !== 102) return;
        (acc.options || []).forEach(function (o) { opts.push(htmlToParts(o)); });
      });
      var solParts = htmlToParts(s.solution || '');
      var ch = (s.correctAnswer || {}).choice;
      var ans = '';
      if (String(ch).match(/^\d+$/) && parseInt(ch, 10) < 6) {
        ans = NUM2LETTER[parseInt(ch, 10)];
      } else {
        ans = String(ch);
      }

      items.push({
        key: k,
        section: section[k] || '?',
        gno: gno[k] || 0,
        stem: stem,
        materials: materials,
        options: opts,
        answer: ans,
        solution: solParts
      });
    });

    return {
      title: sol.name || '错题集',
      items: items
    };
  }

  // 暴露全局
  window.FenbiParser = {
    buildItems: buildItems,
    htmlToParts: htmlToParts,
    textSegments: textSegments,
    normalizeUrl: normalizeUrl,
    fnameFromUrl: fnameFromUrl,
    md5: md5
  };

  console.log(TAG, '解析器已就绪');
})();
