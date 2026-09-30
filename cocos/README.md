# 猫棋 · Cocos Creator 动画版

Cocos Creator 3.8.x 工程，构建目标 **微信小游戏**。与原生小程序版（`../miniprogram/`）并存：
本版主打**动画体验**（猫落地弹跳、判错抖动红闪、彩纸庆祝、卡片入场、棋盘缩放转场），
逻辑与数据同源（`../engine/src` + `../levels`，经 `npm run build` 同步，禁止手改生成物）。

## 打开工程

1. 安装 [Cocos Creator 3.8.x](https://www.cocos.com/creator-download)（3.8.8 实测）
2. Cocos Dashboard → 导入本目录 `cocos/`（或直接用编辑器打开）
3. 打开唯一场景 `assets/scenes/main.scene`，Boot 组件已挂载，全 UI 动态生成
4. 预览 ▶ 即玩；构建发布 → 微信小游戏

> 若场景打开异常（手写场景与编辑器小版本不兼容时）：新建空场景 → Canvas 下建空节点挂
> `assets/scripts/boot.ts` 的 `Boot` 组件 → 保存为 main.scene 即可（30 秒）。

## 结构

```
cocos/
  package.json            # creator 版本声明
  buildConfig.wechatgame.json # 微信构建配置（appid + 引擎分离插件）
  assets/scenes/main.scene# 唯一场景（Canvas + Camera + Boot；节点 scale 已修正为 1）
  assets/scripts/boot.ts  # 全部 UI/交互/动画/音效/存档（Kenney 贴图 UI + AI 猫 sprite）
  assets/resources/       # 图片 + mp3 音效（构建时打进 resources bundle，勿手改 meta 的 type 字段）
  assets/scripts/engine/  # ← npm run build 生成（core/solver/hint TS 化）
  assets/scripts/levels-data.ts # ← npm run build 生成（100 关）
```

## 构建与验收（全部 CLI 化）

```
npm run build-cocos        # 引擎 UMD→TS + 关卡数据同步进工程
npm run build-cocos-web    # Cocos CLI 构建 web-mobile
npm run cocos-smoke        # headless 驱动 __zmmCocos：启动/L1通关/星级/解锁/存档 + 截图
npm run build-cocos-wx     # 微信小游戏构建（引擎分离插件）+ 删本地引擎兜底 + 4MB 体积校验
```

微信端验收：微信开发者工具 → 导入 `cocos/build/wechatgame/`（appid 已配测试号）→ 预览。

## 资源与授权

- UI/图标/背景/音效：Kenney（CC0）· 猫：AI 生成（idle 已入，happy/hurt/dead 待补，`asset-candidates/AI_CAT_BRIEF.md` 有规格）
- 素材选用标准见 `docs/ASSET_STANDARD.md`（卡通 Q 版一票否决门 + ≥9 分打分表）
- 猫四态图到位后直接覆盖 `assets/resources/img/cat_{happy,hurt,dead}.png` 重新构建即可热替换（代码自动识别，缺图自动降级 idle+变形动画）

## 已知坑（详见 docs/QA.md #32~38）

手写场景曾有：非法压缩 uuid / 节点 scale=0 / Canvas 未绑相机 / 横屏设计分辨率；运行时节点必须挂 UI_2D 层；ES5 降级下迭代器展开不可用；图片 meta 的 type 必须是 sprite-frame。

## 交互（与原生版同构）

单击空格标 ✕（人工笔记，再点取消）· 按住拖动连标 ✕ · **双击猜猫**：猜对锁定 🐱，
猜错系统 ✕ + 猜错计数，**猜错 2 次本局失败**。💡 提示 = 同一套人话推理引擎。

## 自动化驱动钩子

运行时全局 `__zmmCocos`（load/tap/dbltap/state/isWon...），供真机预览与调试器验收。
