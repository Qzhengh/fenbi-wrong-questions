#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
粉笔错题集 - 第1步：解析原始数据 + 下载图片 + 输出 errors.json

用法：
    python3 parse.py solution.txt getReport.txt

输入：
    solution.txt  —— 浏览器里 solution 请求的 Response（题目内容）
    getReport.txt —— 浏览器里 getReport 请求的 Response（对错状态）
    （两个文件可以是纯文本，也可以是 TextEdit 存的 RTF，脚本都能处理）

输出：
    errors.json   —— 挑出的错题（含文字、本地图片路径、答案、解析）
    images/       —— 下载好的图片文件夹

判定规则（已锁定）：只收 status == -1 的题（做错）。
    status==1 做对（不收），status==10 没作答（不收）。
"""
import sys, os, re, json, html, hashlib

# ---------- 工具：把可能是RTF的文件读成纯JSON文本 ----------
def _balance_json(text):
    """从text里截取第一个完整JSON对象的字符串"""
    i = text.find('{')
    if i < 0: return text
    depth = 0
    for j in range(i, len(text)):
        if text[j] == '{': depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                return text[i:j+1]
    return text[i:]

def read_maybe_rtf(path):
    raw = open(path, 'r', encoding='utf-8', errors='ignore').read()
    s = raw.lstrip()
    # 纯JSON：直接以 { 开头（且不是RTF）
    if s.startswith('{') and '\\rtf' not in raw[:50]:
        return raw
    # RTF：还原 \uXXXXX 中文、\{ \} 花括号、去控制字
    start = raw.find('"code"')
    if start < 0: start = raw.find('"name"')
    seg = raw[raw.rfind('{', 0, start):] if start > 0 else raw
    seg = seg.replace('\\uc0', '')
    seg = re.sub(r'\\u(\d+) ?', lambda m: chr(int(m.group(1))), seg)
    seg = seg.replace('\\{', '{').replace('\\}', '}')
    seg = seg.replace('\\\n', '').replace('\n', '')
    seg = re.sub(r'\\{2,}"', r'\\"', seg)
    return seg

def extract_json(text):
    """从文本里截取第一个完整JSON对象并解析"""
    chunk = _balance_json(text)
    try:
        return json.loads(chunk)
    except json.JSONDecodeError:
        chunk2 = re.sub(r'\\{2,}"', r'\\"', chunk).replace('\\\\', '\\')
        return json.loads(chunk2)

# ---------- HTML 拆成 文字/图片 片段（保留顺序，保留段落换行） ----------
def _text_segments(htmlfrag):
    """把一段HTML文字转成若干文字片段，按 <p>/<br> 分段。
    返回 [{'type':'text','val':...,'nl':bool}]，nl=True 表示此片段前要换行/另起段。"""
    if not htmlfrag:
        return []
    s = htmlfrag
    # 段落/换行标记 → 统一换成 \n
    s = re.sub(r'</p\s*>', '\n', s, flags=re.I)
    s = re.sub(r'<p\b[^>]*>', '\n', s, flags=re.I)
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    # 删掉其余所有标签
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    # 按换行拆，每段去掉首尾空白(含全角空格\xa0)；空段落跳过
    segs = []
    first = True
    for line in s.split('\n'):
        t = line.strip().strip('\xa0').strip()
        if not t:
            continue
        segs.append({'type': 'text', 'val': t, 'nl': (not first)})
        first = False
    return segs

def html_to_parts(h):
    parts = []; pos = 0
    for m in re.finditer(r'<img[^>]*>', h or ''):
        pre = h[pos:m.start()]
        parts.extend(_text_segments(pre))
        tag = m.group(0)
        src = re.search(r'src=\\?"?([^"\\>\s]+)', tag)
        w = re.search(r'width=\\?"?(\d+)', tag)
        hh = re.search(r'height=\\?"?(\d+)', tag)
        srcval = src.group(1) if src else ''
        is_tex = ('flag="tex"' in tag) or ('flag=\\"tex\\"' in tag) \
                 or ('latex' in srcval) or ('formula' in srcval)
        parts.append({'type': 'img',
                      'src': srcval,
                      'w': int(w.group(1)) if w else 0,
                      'h': int(hh.group(1)) if hh else 0,
                      'is_tex': is_tex})
        pos = m.end()
    parts.extend(_text_segments(h[pos:]))
    return parts

# ---------- 图片可用性检查 ----------
def is_usable_image(fpath):
    """文件存在且是合法 PNG/JPG"""
    try:
        if not os.path.exists(fpath): return False
        with open(fpath, 'rb') as f:
            b = f.read(8)
        if len(b) < 8: return False
        is_png = b[0] == 0x89 and b[1] == 0x50 and b[2] == 0x4e and b[3] == 0x47
        is_jpg = b[0] == 0xff and b[1] == 0xd8
        return is_png or is_jpg
    except: return False

# ---------- 下载图片 ----------
def download_images(parts_list, outdir):
    """给所有 img 片段下载图片，写入本地路径 local 字段。返回 (成功数, 失败列表)"""
    os.makedirs(outdir, exist_ok=True)
    import urllib.request, time
    ok = 0; failed = []
    cache = {}
    PNG_SIG = b'\x89PNG\r\n\x1a\n'
    PNG_END = b'IEND\xaeB`\x82'   # PNG文件正常结尾标记

    def clean_png(data):
        # 去掉开头杂字节，使PNG签名在最前
        if not data.startswith(PNG_SIG):
            pos = data.find(PNG_SIG)
            if pos > 0:
                data = data[pos:]
        return data

    def is_complete_png(data):
        # 完整PNG应以签名开头、以IEND结尾
        return data.startswith(PNG_SIG) and (PNG_END in data[-12:])

    def fetch(url):
        # 带较完整的请求头，模拟从粉笔网页访问（解决某些图床的防盗链）
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Referer': 'https://www.fenbi.com/',
            'Accept': 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()

    for parts in parts_list:
        for p in parts:
            if p.get('type') != 'img': continue
            src = p.get('src', '')
            if not src:
                p['local'] = None; failed.append('(空链接)'); continue
            url = src
            if url.startswith('//'): url = 'https:' + url
            elif url.startswith('/'): url = 'https://fb.fenbike.cn' + url
            if url in cache:
                p['local'] = cache[url]; ok += 1; continue
            name = hashlib.md5(url.encode()).hexdigest()[:12] + '.png'
            fpath = os.path.join(outdir, name)

            # 本地已有合法图片：直接认领，跳过下载
            if is_usable_image(fpath):
                p['local'] = name; cache[url] = name; ok += 1
                continue

            data = None; last_err = ''
            for attempt in range(3):   # 最多试3次
                try:
                    raw = fetch(url)
                    raw = clean_png(raw)
                    if is_complete_png(raw):
                        data = raw; break
                    else:
                        last_err = f'第{attempt+1}次下载内容不完整(大小{len(raw)})'
                        time.sleep(1)
                except Exception as e:
                    last_err = str(e)[:60]
                    time.sleep(1)

            if data is not None:
                with open(fpath, 'wb') as f:
                    f.write(data)
                p['local'] = name; cache[url] = name; ok += 1
            else:
                p['local'] = None
                failed.append(url + ' -> ' + last_err)
    return ok, failed

# ---------- 主流程 ----------
def main():
    if len(sys.argv) < 3:
        print("用法: python3 parse.py solution.txt getReport.txt"); sys.exit(1)
    sol_path, rep_path = sys.argv[1], sys.argv[2]

    print("读取 solution ...")
    sol = extract_json(read_maybe_rtf(sol_path))
    print("读取 getReport ...")
    rep = extract_json(read_maybe_rtf(rep_path))

    sols = {s['globalId']: s for s in sol['solutions']}
    mats = {m['globalId']: m for m in sol['materials']}
    ua = rep['data']['userAnswers']

    # 从 card 建立：板块 / 全卷题号 / materialKeys
    section = {}; matkeys = {}; order = []
    def walk(node):
        if isinstance(node, dict):
            if str(node.get('nodeType')) == '1':
                sec = node.get('name', '')
                for c in node.get('children', []) or []:
                    if str(c.get('nodeType')) == '2':
                        section[c['key']] = sec
                        mk = c.get('materialKeys', '[]')
                        try: mk = json.loads(mk) if isinstance(mk, str) else mk
                        except: mk = []
                        matkeys[c['key']] = mk
            if str(node.get('nodeType')) == '2':
                order.append(node['key'])
            for c in (node.get('children') or []): walk(c)
        elif isinstance(node, list):
            for c in node: walk(c)
    walk(sol['card'])
    gno = {k: i + 1 for i, k in enumerate(order)}

    # 挑错题：status == -1
    wrong = [k for k, v in ua.items() if v.get('status') == -1]
    wrong.sort(key=lambda k: gno.get(k, 99999))   # 按全卷题号升序

    NUM2LETTER = ['A', 'B', 'C', 'D', 'E', 'F']    # 0-based
    items = []
    all_parts = []   # 收集所有含图片的片段，统一下载
    for k in wrong:
        s = sols.get(k)
        if not s:
            print(f"  ⚠️ 题号 {k} 在 solution 中找不到，跳过")
            continue
        stem = html_to_parts(s.get('content', ''))
        materials = [html_to_parts(mats[mk]['content']) for mk in matkeys.get(k, []) if mk in mats]
        opts = []
        for acc in (s.get('accessories') or []):
            if acc.get('type') in (101, 102):
                for o in acc['options']:
                    opts.append(html_to_parts(o))
        sol_parts = html_to_parts(s.get('solution', ''))
        ch = s.get('correctAnswer', {}).get('choice', '')
        answer = NUM2LETTER[int(ch)] if str(ch).isdigit() and int(ch) < 6 else str(ch)
        item = {'key': k, 'section': section.get(k, '?'), 'gno': gno.get(k, 0),
                'stem': stem, 'materials': materials, 'options': opts,
                'answer': answer, 'solution': sol_parts}
        items.append(item)
        all_parts += [stem] + materials + opts + [sol_parts]

    print(f"\n挑出错题 {len(items)} 道。开始下载图片 ...")
    ok, failed = download_images(all_parts, 'images')
    print(f"图片下载完成：成功 {ok} 张，失败 {len(failed)} 张")
    if failed:
        print("  失败清单（这些图将在Word里显示为占位框，请到【❓待核对】手动处理）：")
        for f in failed[:20]:
            print("   -", f)

    out = {'title': sol.get('name', '错题集'),
           'items': items,
           'stats': {'total_wrong': len(items),
                     'img_ok': ok, 'img_failed': len(failed),
                     'failed_list': failed}}
    json.dump(out, open('errors.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print("\n✅ 已生成 errors.json")
    # 板块统计
    from collections import Counter
    print("各板块错题数：", dict(Counter(it['section'] for it in items)))

if __name__ == '__main__':
    main()
