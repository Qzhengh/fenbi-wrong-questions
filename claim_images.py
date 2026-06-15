#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
认领已手动补好的图片。

背景：某些图下载彻底失败时，errors.json 里它的 local 字段是 null。
你按缺图清单手动补了图（文件名正确放进 images/），但 errors.json 没更新，
导致生成 Word 时仍报缺。这个脚本把已补好的图"认领"回 errors.json。

用法：
    python3 claim_images.py
然后重新生成：
    node build_docx.js
"""
import json, os, hashlib

def fname_from_url(src):
    url = src
    if url.startswith('//'): url = 'https:' + url
    elif url.startswith('/'): url = 'https://fb.fenbike.cn' + url
    return hashlib.md5(url.encode()).hexdigest()[:12] + '.png'

def is_usable(fpath):
    try:
        if not os.path.exists(fpath): return False
        with open(fpath, 'rb') as f:
            b = f.read(8)
        if len(b) < 8: return False
        is_png = b[0]==0x89 and b[1]==0x50 and b[2]==0x4e and b[3]==0x47
        is_jpg = b[0]==0xff and b[1]==0xd8
        return is_png or is_jpg
    except: return False

def main():
    if not os.path.exists('errors.json'):
        print("找不到 errors.json"); return
    data = json.load(open('errors.json', encoding='utf-8'))

    claimed = 0; still_missing = 0
    def fix_parts(parts):
        nonlocal claimed, still_missing
        for p in (parts or []):
            if p.get('type') != 'img': continue
            if p.get('local'):   # 已有文件名，跳过
                continue
            # local 为空：算出应有文件名，看 images 里有没有
            fn = fname_from_url(p.get('src', ''))
            fpath = os.path.join('images', fn)
            if is_usable(fpath):
                p['local'] = fn        # 认领：补上账
                claimed += 1
            else:
                still_missing += 1

    for it in data['items']:
        fix_parts(it.get('stem'))
        for m in it.get('materials', []): fix_parts(m)
        for o in it.get('options', []): fix_parts(o)
        fix_parts(it.get('solution'))

    json.dump(data, open('errors.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print(f"认领完成：")
    print(f"  成功认领（已补好的图）：{claimed} 张")
    if still_missing:
        print(f"  仍缺失（还没补或文件名不对）：{still_missing} 张")
    print(f"\n现在重新生成： node build_docx.js")

if __name__ == '__main__':
    main()
