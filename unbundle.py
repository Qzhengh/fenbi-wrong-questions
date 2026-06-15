#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
解压 fenbi-grabber v0.2 导出的 bundle JSON。

用法：
    python3 unbundle.py fenbi-bundle-xxx.json

输出：
    solution.txt    —— parse.py 第1个输入
    getReport.txt   —— parse.py 第2个输入
    images/         —— base64 图片按 md5 文件名落地

然后继续跑：
    python3 parse.py solution.txt getReport.txt
    node build_docx.js
"""
import sys, os, json, re

def main():
    if len(sys.argv) < 2:
        print("用法: python3 unbundle.py fenbi-bundle-xxx.json"); sys.exit(1)

    path = sys.argv[1]
    data = json.load(open(path, encoding='utf-8'))

    if data.get('version') != '0.2':
        print(f"警告：bundle 版本 {data.get('version')} 不是预期的 0.2，继续解压...")

    # 写文本
    open('solution.txt', 'w', encoding='utf-8').write(data.get('solution', ''))
    open('getReport.txt', 'w', encoding='utf-8').write(data.get('getReport', ''))
    print("已写出 solution.txt / getReport.txt")

    # 写图片
    images = data.get('images', {})
    os.makedirs('images', exist_ok=True)
    ok = 0; bad = 0
    for fn, data_url in images.items():
        m = re.match(r'^data:image/([a-zA-Z0-9]+);base64,(.*)$', data_url)
        if not m:
            print(f"  跳过非 base64 数据: {fn}"); bad += 1; continue
        try:
            raw = __import__('base64').b64decode(m.group(2))
            with open(os.path.join('images', fn), 'wb') as f:
                f.write(raw)
            ok += 1
        except Exception as e:
            print(f"  写入失败 {fn}: {e}"); bad += 1

    meta = data.get('meta', {})
    print(f"图片解压：成功 {ok} 张，失败/跳过 {bad} 张")
    print(f"  (bundle 统计：识别 {meta.get('totalUrls')} 张，成功 {meta.get('success')} 张，"
          f"canvas {meta.get('canvasOk')}, SW {meta.get('swOk')}, 失败 {len(meta.get('failed', []))})")
    print("\n下一步：python3 parse.py solution.txt getReport.txt")

if __name__ == '__main__':
    main()
