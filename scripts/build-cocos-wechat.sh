#!/bin/bash
# 微信小游戏构建流水线：Cocos CLI 构建（引擎分离插件）→ 删除未被引用的本地引擎兜底目录 → 主包体积校验
# 用法: npm run build-cocos-wx
set -e
cd "$(dirname "$0")/.."
CC_BIN="${COCOS_CREATOR:-$HOME/Applications/CocosCreator.app/Contents/MacOS/CocosCreator}"
[ -x "$CC_BIN" ] || CC_BIN=/Applications/CocosCreator.app/Contents/MacOS/CocosCreator
STAMP=$(mktemp)
touch "$STAMP"
# 编辑器 CLI 可能带脏退出码（窗口恢复噪音），构建成功与否以产物新鲜度为准
"$CC_BIN" --project "$PWD/cocos" --build "configPath=$PWD/cocos/buildConfig.wechatgame.json" > /tmp/zmm-wx-build.log 2>&1 || \
  echo "⚠ Cocos CLI 退出码非零，继续校验产物新鲜度"
OUT=cocos/build/wechatgame
if [ ! -d "$OUT" ] || ! find "$OUT/game.js" -newer "$STAMP" | grep -q .; then
  echo "✗ 构建产物未更新——构建失败，日志: /tmp/zmm-wx-build.log"
  tail -20 /tmp/zmm-wx-build.log
  exit 1
fi
# import-map 已把全部引擎块映射到 plugin:cocos/，本地 cocos-js 不会被加载，纯占包体
if [ -d "$OUT/cocos-js" ] && grep -q 'plugin:cocos/' "$OUT/src/import-map.js"; then
  rm -rf "$OUT/cocos-js"
fi
SIZE_KB=$(du -sk "$OUT" | cut -f1)
echo "微信主包体积: ${SIZE_KB}KB（上限 4096KB）"
if [ "$SIZE_KB" -gt 4096 ]; then echo "✗ 超出微信主包限制"; exit 1; fi
echo "✓ 微信小游戏构建完成: $OUT（微信开发者工具导入该目录预览/上传）"
