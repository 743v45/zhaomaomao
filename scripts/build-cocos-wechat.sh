#!/bin/bash
# 微信小游戏构建流水线：Cocos CLI 构建（引擎分离插件）→ 删除未被引用的本地引擎兜底目录 → 主包体积校验
# 用法: npm run build-cocos-wx
set -e
cd "$(dirname "$0")/.."
~/Applications/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project "$PWD/cocos" --build "configPath=$PWD/cocos/buildConfig.wechatgame.json"
OUT=cocos/build/wechatgame
# import-map 已把全部引擎块映射到 plugin:cocos/，本地 cocos-js 不会被加载，纯占包体
grep -q 'plugin:cocos/' "$OUT/src/import-map.js" && rm -rf "$OUT/cocos-js"
SIZE_KB=$(du -sk "$OUT" | cut -f1)
echo "微信主包体积: ${SIZE_KB}KB（上限 4096KB）"
if [ "$SIZE_KB" -gt 4096 ]; then echo "✗ 超出微信主包限制"; exit 1; fi
echo "✓ 微信小游戏构建完成: $OUT（微信开发者工具导入该目录预览/上传）"
