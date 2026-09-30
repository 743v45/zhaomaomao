# 猫棋（zhaomaomao）项目 Agent 规则

## 规则语义（最高优先级，2026-09-30 经 taevas 确认）

1. **同一颜色连通块 = 有且只有 1 只猫**（恰好一只，不是"至多一只"）⇒ 区块数恒等于棋盘边长 N，猫与区块一一对应。
2. 每行恰好 1 只猫；每列恰好 1 只猫（共 N 只猫，N×N 棋盘）。
3. 任意两只猫不能八向紧贴（Chebyshev 距离 ≥ 2；行互异时只需相邻行列差 ≥ 2）。
4. 单格色块必须放猫（规则 1 的自然推论，作为玩家提示保留）。
5. **同色必连通**：同一种颜色全盘只属于一个连通块（颜色即区块身份，regionColors 恒等映射，调色板 24 色）。

## 架构与同步（双端同源）

- 游戏核心逻辑只在 `engine/src/*.js`（UMD：Node/浏览器/小程序三端通用），禁止在 `web/` 或 `miniprogram/` 复制或另写规则逻辑。
- 生成配置单一来源 `engine/src/genconfig.js`（参数分档/权重阈值/重试预算），CLI 与 web 生成器共用，改一处双端同步；禁止在 web 侧另写参数。
- web 地图生成器 `web/gen.html`（点击出图/导出 JSON/种子复现）仅供预览与调试；正式关卡入库必须走 CLI gen（难度全局唯一/哈希查重是关卡库约束）。
- 网页冒烟：`npm run web-smoke`（headless chrome-headless-shell + CDP，游戏页通关 + 生成器页出图）；需要本地服务 `npm run serve`。
- 任何 engine 改动后必须依次执行：
  1. `npm test`（单元测试全绿）
  2. `node engine/cli.js validate --all`
  3. `npm run build`（同步 levels-data 到 web 与 miniprogram、复制引擎到 miniprogram/utils/engine/）
  4. 网页抽验至少 1 关（`python3 -m http.server 8137` → http://localhost:8137/web/，或 `npm run web-smoke`）
- 关卡数据唯一来源 `levels/L*.json`；`web/levels-data.js`、`miniprogram/data/levels.js`、`miniprogram/utils/engine/` 均为 `npm run build` 生成物，禁止手改。
- 微信小程序无法在本机自动化验收，须保持与 web 版逻辑同构（同一份引擎 + 相同交互模型：单击标 X → 再点放猫 → 点猫收回；按住拖动连标 X）。

## 关卡流水线（全部走 CLI，禁止手写关卡 JSON）

- 生成：`node engine/cli.js gen --id N --size S`（目标难度按 levels/plan.json，带 ±5；自动哈希查重、唯一解校验、生成文档）。
- 批量：`node engine/cli.js gen-batch --from A --to B`。
- 校验：`node engine/cli.js validate --all`（唯一解 / 解与配置一致 / 区块连通 / 恰好一猫 / 强制格⊆解 / 难度复算 / 全局难度唯一 / 哈希查重 / 文档存在）。
- 文档：`node engine/cli.js docs` 重新生成全部关卡文档；`node engine/cli.js index` 更新总览表。
- 验收回写：`node engine/cli.js accept --id N --status pass|fail --note "..."` 或 `accept-batch --file results.json`。
- 单关失败最多重试 3 次；仍失败则删除半成品文件并在 docs/QA.md 登记。

## 难度模型（difficulty.js，常数已固化勿随手改）

raw = 尺寸分(0~38) + 逻辑分(4~42, 来自 hint 推理链加权: 强制1/唯一2/指向4/试错8) + 强制格分(0~8)；
最终分 = clamp(round((raw-4)*1.15+4), 3, 99)。改公式必须重新校准全部关卡难度并重新验收。

## 素材标准（2026-10-01 经 taevas 确认）

- **美术主旨 = 卡通 Q 版**（chibi 圆润明快休闲）。风格契合是一票否决门：写实/硬核像素/暗黑风一律不收，先过门再打分。
- 素材搜集与选用执行打分表 `docs/ASSET_STANDARD.md`：造型可爱度3 / 线条2 / 配色百搭2 / 棋子可读性1.5 / 状态覆盖1 / 技术规格0.5，总分 10。
- **选用门槛 ≥9.0 分**；8.0~8.9 仅备选（须报用户确认）；<8 放弃。找素材阶段就定向高分来源（知名画师/热门包/精选合集），宁缺毋滥。
- 仅收 CC0（或明写 public domain），可商用+可再分发；授权不明一律放弃。
- 搜集时必须逐图亲眼（Read 看图）打分，禁止按文件名猜。

## Subagent 纪律

- 关卡生成 subagent 并发 ≤ 4；只用 CLI，不改 engine；批次按尺寸区间划分（避免同尺寸并发查重竞争）。

## 验收标准（双保险）

- 引擎验收：validate 全绿（数学层面：唯一解、恰一猫、连通、难度复算一致、无重复）。
- 网页操作验收：经真实 UI 事件（pointer 派发，window.__zmm 驱动接口）按解答操作 → 胜利判定为真；记录进每关文档「验收记录」节。
- 验收遇到问题：修复 → 最多重试 3 次 → 登记 docs/QA.md（问题/根因/修复，一行一条）。

## 20 分钟 QA 循环

由会话内 `/loop` 驱动：检查游戏有没有问题（引擎测试、validate、audit-hints 全量提示审计、网页抽验），发现问题修复并把已解决项追加到 docs/QA.md。
