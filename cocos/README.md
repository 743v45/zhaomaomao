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
  assets/scenes/main.scene# 唯一场景（Canvas + Camera + Boot）
  assets/scripts/boot.ts  # 全部 UI/交互/动画（Graphics+Label+tween，无纹理资源）
  assets/scripts/engine/  # ← npm run build 生成（core/solver/hint TS 化）
  assets/scripts/levels-data.ts # ← npm run build 生成（100 关）
```

## 交互（与原生版同构）

单击空格标 ✕（人工笔记，再点取消）· 按住拖动连标 ✕ · **双击猜猫**：猜对锁定 🐱，
猜错系统 ✕ + 猜错计数，**猜错 2 次本局失败**。💡 提示 = 同一套人话推理引擎。

## 自动化驱动钩子

运行时全局 `__zmmCocos`（load/tap/dbltap/state/isWon...），供真机预览与调试器验收。
