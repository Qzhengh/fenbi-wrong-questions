/*
 粉笔抓取器 · DOCX 生成器（浏览器版 build_docx.js）
 作用：接收 parser.js 产出的结构化数据 + 图片字典，直接生成 .docx Blob。
 依赖全局 docx 对象（由 docx.min.js IIFE 构建暴露）。
*/
(function () {
  const TAG = '[FENBI-DOCX]';
  const docx = window.docx;
  if (!docx) { console.error(TAG, 'docx 库未加载'); return; }

  const Document = docx.Document, Packer = docx.Packer, Paragraph = docx.Paragraph,
        TextRun = docx.TextRun, ImageRun = docx.ImageRun, AlignmentType = docx.AlignmentType,
        HeadingLevel = docx.HeadingLevel, BorderStyle = docx.BorderStyle,
        PageNumber = docx.PageNumber, Footer = docx.Footer;

  const MAX_W_PX = 420;
  const FORMULA_TARGET_H = 26;
  const FORMULA_MAX_W = 380;

  const missingImgs = [];

  function normalizeUrl(src) {
    var url = src || '';
    if (url.indexOf('//') === 0) url = 'https:' + url;
    else if (url.indexOf('/') === 0) url = 'https://fb.fenbike.cn' + url;
    return url;
  }

  function fnameFromUrl(src) {
    return window.FenbiParser ? window.FenbiParser.fnameFromUrl(src) : '';
  }

  function recordMissing(p) {
    var url = p.src || '';
    if (url.indexOf('//') === 0) url = 'https:' + url;
    else if (url.indexOf('/') === 0) url = 'https://fb.fenbike.cn' + url;
    var file = fnameFromUrl(url);
    if (!file) return;
    if (!missingImgs.find(function (m) { return m.file === file; })) {
      missingImgs.push({ file: file, url: url, kind: isTexPart(p) ? '公式' : '图片' });
    }
  }

  function dataURLToUint8Array(dataUrl) {
    var idx = dataUrl.indexOf(',');
    if (idx < 0) return null;
    var b64 = dataUrl.slice(idx + 1);
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function isUsableImage(bytes) {
    if (!bytes || bytes.length < 8) return false;
    var isPNG = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    var isJPG = bytes[0] === 0xFF && bytes[1] === 0xD8;
    return isPNG || isJPG;
  }

  function realSize(bytes) {
    if (!bytes || bytes.length < 8) return null;
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes.length > 24) {
      return { w: view.getUint32(16, false), h: view.getUint32(20, false) };
    }
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      var i = 2;
      while (i < bytes.length) {
        if (bytes[i] !== 0xFF) { i++; continue; }
        var marker = bytes[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { h: view.getUint16(i + 5, false), w: view.getUint16(i + 7, false) };
        }
        i += 2 + view.getUint16(i + 2, false);
      }
    }
    return null;
  }

  function isTexPart(p) {
    if (p && typeof p.is_tex === 'boolean') return p.is_tex;
    return /formula|latex/.test((p && p.src) || '');
  }

  function calcDim(p, realW, realH) {
    var w = realW || p.w || 300, h = realH || p.h || 200;
    if (isTexPart(p)) {
      var r = FORMULA_TARGET_H / h;
      var nw = w * r, nh = h * r;
      if (nw > FORMULA_MAX_W) { r = FORMULA_MAX_W / w; nw = w * r; nh = h * r; }
      return { width: Math.max(1, Math.round(nw)), height: Math.max(1, Math.round(nh)) };
    } else {
      if (w <= MAX_W_PX) return { width: w, height: h };
      var r = MAX_W_PX / w;
      return { width: Math.round(w * r), height: Math.round(h * r) };
    }
  }

  function getImageBytes(p, images) {
    var fn = fnameFromUrl(p.src);
    if (fn && images[fn]) {
      var bytes = dataURLToUint8Array(images[fn]);
      if (isUsableImage(bytes)) return bytes;
    }
    return null;
  }

  function imgRun(p, images) {
    var bytes = getImageBytes(p, images);
    if (bytes) {
      var rs = realSize(bytes);
      var dim = calcDim(p, rs && rs.w, rs && rs.h);
      try {
        return new ImageRun({ data: bytes, transformation: { width: dim.width, height: dim.height } });
      } catch (e) {}
    }
    recordMissing(p);
    var label = isTexPart(p) ? '公式' : '图';
    return new TextRun({ text: '［' + label + '缺失 ' + (p.w || '?') + '×' + (p.h || '?') + ' 需手动补］',
                         size: 18, color: 'D08000', italics: true });
  }

  function imgParagraph(p, images) {
    var bytes = getImageBytes(p, images);
    if (bytes) {
      var rs = realSize(bytes);
      var dim = calcDim(p, rs && rs.w, rs && rs.h);
      try {
        var run = new ImageRun({ data: bytes, transformation: { width: dim.width, height: dim.height } });
        return new Paragraph({ spacing: { before: 60, after: 60 }, alignment: AlignmentType.CENTER, children: [run] });
      } catch (e) {}
    }
    recordMissing(p);
    return new Paragraph({ spacing: { before: 40, after: 40 }, alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.DASHED, size: 4, color: 'D08000', space: 6 },
                left: { style: BorderStyle.DASHED, size: 4, color: 'D08000', space: 6 },
                bottom: { style: BorderStyle.DASHED, size: 4, color: 'D08000', space: 6 },
                right: { style: BorderStyle.DASHED, size: 4, color: 'D08000', space: 6 } },
      children: [new TextRun({ text: '［图片缺失　原图 ' + (p.w || '?') + '×' + (p.h || '?') + 'px　需手动补］',
                               size: 18, color: 'D08000', italics: true })] });
  }

  function renderParts(parts, opts) {
    opts = opts || {};
    var indent = opts.indent || 0;
    var indentFirstLine = opts.indentFirstLine || false;
    var out = [];
    var runs = [];
    function flush() {
      if (runs.length) {
        var para = { spacing: { after: 80, line: 360 }, children: runs };
        if (indent && indentFirstLine) para.indent = { left: indent, firstLine: 480 };
        else if (indent) para.indent = { left: indent };
        out.push(new Paragraph(para));
        runs = [];
      }
    }
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.type === 'img' && !isTexPart(p)) {
        flush();
        out.push(imgParagraph(p, opts.images));
      } else if (p.type === 'img' && isTexPart(p)) {
        runs.push(imgRun(p, opts.images));
      } else if (p.type === 'text') {
        if (p.nl) flush();
        runs.push(new TextRun({ text: p.val, size: 22 }));
      }
    }
    flush();
    return out;
  }

  function isPlaceholderOptions(options) {
    if (!options || !options.length) return false;
    return options.every(function (opt) {
      return opt.length === 1 && opt[0].type === 'text' && /^[A-Z]$/.test(opt[0].val.trim());
    });
  }

  function matFingerprint(materials) {
    var sig = [];
    materials.forEach(function (mat) {
      mat.forEach(function (p) {
        sig.push(p.type === 'text' ? p.val : 'IMG:' + (p.src || ''));
      });
    });
    return sig.join('|');
  }

  function buildDocx(data, images) {
    missingImgs.length = 0;
    var children = [];
    var today = new Date().toISOString().slice(0, 10);

    // 标题
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: data.title, size: 32, bold: true })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
      children: [new TextRun({ text: '错题集（间隔重做用）　收集日期：' + today + '　共 ' + data.items.length + ' 题',
                             size: 20, color: '666666' })] }));
    children.push(new Paragraph({ spacing: { after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '2E75B6', space: 1 } },
      children: [new TextRun('')] }));

    var qno = 0, curSection = '';
    var seenMaterial = {};
    data.items.forEach(function (it) {
      if (it.section !== curSection) {
        curSection = it.section;
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 120 },
          children: [new TextRun({ text: '【' + it.section + '】', size: 26, bold: true, color: '2E75B6' })] }));
      }
      qno++;
      children.push(new Paragraph({ spacing: { before: 160, after: 60 },
        children: [new TextRun({ text: qno + '. ', size: 24, bold: true }),
                   new TextRun({ text: '（' + it.section + '　原卷第 ' + it.gno + ' 题）', size: 18, color: '888888' })] }));

      if (it.materials && it.materials.length) {
        var fp = matFingerprint(it.materials);
        if (seenMaterial[fp]) {
          var ref = seenMaterial[fp];
          children.push(new Paragraph({ spacing: { before: 40, after: 40 },
            children: [new TextRun({ text: '【材料】见上方第 ' + ref.qno + ' 题（原卷第 ' + ref.gno + ' 题）的材料',
                                   size: 20, italics: true, color: 'CC7000' })] }));
        } else {
          seenMaterial[fp] = { qno: qno, gno: it.gno };
          children.push(new Paragraph({ spacing: { before: 40, after: 40 },
            children: [new TextRun({ text: '【材料】', size: 20, bold: true, color: 'CC7000' })] }));
          it.materials.forEach(function (mat) {
            renderParts(mat, { indent: 240, indentFirstLine: true, images: images }).forEach(function (p) { children.push(p); });
          });
        }
        children.push(new Paragraph({ spacing: { after: 40 },
          children: [new TextRun({ text: '【问题】', size: 20, bold: true, color: 'CC7000' })] }));
      }

      renderParts(it.stem, { images: images }).forEach(function (p) { children.push(p); });

      if (isPlaceholderOptions(it.options)) {
        children.push(new Paragraph({ spacing: { after: 40 }, indent: { left: 240 },
          children: [new TextRun({ text: '（选项见上图）', size: 20, italics: true, color: '888888' })] }));
      } else {
        var NUM2LETTER = ['A', 'B', 'C', 'D', 'E', 'F'];
        it.options.forEach(function (opt, i) {
          var label = NUM2LETTER[i] || String.fromCharCode(65 + i);
          var first = opt[0];
          if (opt.length === 1 && first.type === 'text') {
            children.push(new Paragraph({ spacing: { after: 40 }, indent: { left: 240 },
              children: [new TextRun({ text: label + '. ', size: 22, bold: true }),
                         new TextRun({ text: first.val, size: 22 })] }));
          } else {
            children.push(new Paragraph({ spacing: { after: 20 }, indent: { left: 240 },
              children: [new TextRun({ text: label + '.', size: 22, bold: true })] }));
            renderParts(opt, { indent: 480, images: images }).forEach(function (p) { children.push(p); });
          }
        });
      }
    });

    // 答案页
    children.push(new Paragraph({ children: [], pageBreakBefore: true }));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '参考答案与解析', size: 30, bold: true })] }));
    children.push(new Paragraph({ spacing: { after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '2E75B6', space: 1 } },
      children: [new TextRun('')] }));

    qno = 0;
    data.items.forEach(function (it) {
      qno++;
      children.push(new Paragraph({ spacing: { before: 140, after: 40 },
        children: [new TextRun({ text: qno + '. ', size: 24, bold: true }),
                   new TextRun({ text: '正确答案：' + it.answer, size: 24, bold: true, color: '2E7D32' }),
                   new TextRun({ text: '　（原卷第 ' + it.gno + ' 题）', size: 18, color: '888888' })] }));
      renderParts(it.solution, { images: images }).forEach(function (p) { children.push(p); });
    });

    var doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 22 } } },
        paragraphStyles: [
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 32, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 26, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 180, after: 120 }, outlineLevel: 1 } }
        ] },
      sections: [{
        properties: { page: { size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '第 ', size: 18, color: '888888' }),
                     new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '888888' }),
                     new TextRun({ text: ' 页', size: 18, color: '888888' })] })] }) },
        children: children
      }]
    });

    return { doc: doc, missing: missingImgs.slice() };
  }

  window.FenbiDocxBuilder = { buildDocx: buildDocx };
  console.log(TAG, 'DOCX 生成器已就绪');
})();
