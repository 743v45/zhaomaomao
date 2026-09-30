# 猫棋 zhaomaomao

每个颜色住一只猫的棋盘逻辑谜题。6×6 → 20×20，100 关，唯一解，难度 1~100。

**规则**：N×N 棋盘放 N 只猫 —— 每行、每列、每个同色连通块恰好 1 只猫；两只猫不能八向紧贴；单格色块必须放猫。

## 快速开始

```bash
npm install        # 无第三方依赖，仅需 Node ≥ 18
npm test           # 引擎单元测试
npm run validate   # 100 关全量校验（唯一解/恰一猫/连通/难度/权重/查重）
npm run audit-hints # 全量提示审计：每关空盘可渐进推导到终局、逐步跟随提示可通关、数据/提示结构化
npm run build      # 构建双端数据（web + miniprogram）
npm run serve      # http://localhost:8137/web/
npm run web-smoke  # 网页冒烟：headless 驱动游戏页通关 + 生成器页出图
```

- 网页版：`web/index.html`（或上方 serve 地址）
- **地图生成器（web 版）**：`web/gen.html` —— 点击即出图：选棋盘/目标难度/种子 → 染色棋盘 + 难度 + 小区块权重 + 唯一解校验 + 导出 JSON。实测 6~14 棋盘毫秒级，18~20 棋盘 0.1~4s（宽限收手 ≤ ~7s）。
- 生成配置单一来源：`engine/src/genconfig.js`（参数分档/权重阈值/重试预算），CLI 与 web 生成器共用同一份，改一处双端同步。
- 微信小程序：微信开发者工具导入 `miniprogram/`
- 设计文档：`docs/GAME_DESIGN.md` · 关卡总览：`docs/LEVEL_INDEX.md` · QA：`docs/QA.md`
- 项目 Agent 规则：`CLAUDE.md`

## 操作

单击空格标 ✕（排除）· 按住拖动连标 ✕ · 再点 ✕ 放猫 🐱 · 点猫收回。
