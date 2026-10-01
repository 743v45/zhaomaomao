#!/usr/bin/env python3
"""把 cocos/assets/resources/img 下所有 png 的导入类型强制为 sprite-frame（Cocos CLI 导入默认 texture 的坑）。
构建前运行；同时清理对应 library 缓存强制重导入。"""
import json, glob, os
n = 0
for f in glob.glob(os.path.join(os.path.dirname(__file__), '..', 'cocos', 'assets', 'resources', 'img', '*.png.meta')):
    d = json.load(open(f))
    if d.get('userData', {}).get('type') != 'sprite-frame':
        d['userData']['type'] = 'sprite-frame'
        json.dump(d, open(f, 'w'), ensure_ascii=False, indent=2)
        u = d['uuid']
        lp = os.path.join(os.path.dirname(__file__), '..', 'cocos', 'library', u[:2], u + '.json')
        if os.path.exists(lp):
            os.remove(lp)
        n += 1
print(f'[fix-img-meta] 修正 {n} 张')
