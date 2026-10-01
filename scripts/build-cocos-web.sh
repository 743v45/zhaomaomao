#!/bin/bash
# web 构建两段式：首段构建会让 CLI 以 texture 误导入新图 → 修正 meta → 有修补则二次构建
set -e
cd "$(dirname "$0")/.."
CC_BIN="${COCOS_CREATOR:-$HOME/Applications/CocosCreator.app/Contents/MacOS/CocosCreator}"
[ -x "$CC_BIN" ] || CC_BIN=/Applications/CocosCreator.app/Contents/MacOS/CocosCreator
python3 scripts/fix-img-meta.py
STAMP=$(mktemp); touch "$STAMP"
"$CC_BIN" --project "$PWD/cocos" --build "platform=web-mobile;debug=false" > /tmp/zmm-web-build.log 2>&1 || echo "⚠ CLI 脏退出码，以产物新鲜度为准"
find cocos/build/web-mobile/index.html -newer "$STAMP" | grep -q . || { echo "✗ 构建失败"; tail -20 /tmp/zmm-web-build.log; exit 1; }

OUT2=$(python3 scripts/fix-img-meta.py)
echo "$OUT2"
case "$OUT2" in *"修正 0"*) echo "✓ web-mobile 构建完成（无需二次构建）";; *)
  echo "↻ meta 有修补，二次构建…"
  "$CC_BIN" --project "$PWD/cocos" --build "platform=web-mobile;debug=false" > /tmp/zmm-web-build2.log 2>&1 || true
  echo "✓ web-mobile 构建完成（二次）";;
esac
