# QA 记录（问题 / 根因 / 修复）

> 20 分钟循环与验收过程中发现的问题及解决，一行一条。

| # | 日期 | 问题 | 根因 | 修复 |
|---|------|------|------|------|
| 1 | 09-30 | 生成器成功率极低（6×6 也 <5%） | 唯一化预算 maxCarves=forcedWish+3 过小，替代解杀不完 | 挖格预算按收敛需求放大 + 失败换种子重试 |
| 2 | 09-30 | 挖格后解数变 0 | 挖格行/列已有其它单格区块 → 一行两个强制格 | 挖格位置避开已占用行/列 |
| 3 | 09-30 | 大棋盘求解 84M 节点超限 | 升序候选列钻死子树 | 求解器加确定性随机候选序（shuffleSeed），节点数降至数百 |
| 4 | 09-30 | 提示引擎误报"区块已无候选格"矛盾 | ≤1 语义下区块可以不放猫（该检查当时是错的） | 移除该检查；后随规则升级为"恰好一猫"又恢复（此时正确） |
| 5 | 09-30 | 生成器产生空区块 id / 不连通区块 | 合并后 id 空洞；边界移动移走中间格后原区块断开共用 id | 结尾+操作后统一 compactIds；移动/挖格后 mergeRegionRest 碎片并入邻块 |
| 6 | 09-30 | CLI 把 plan.json 写到仓库外 | cli.js ROOT 路径多算一层（engine/ 在根下） | ROOT = resolve(__dirname, '..') |
| 7 | 09-30 | 大棋盘强制格≈N、难度塌缩到 42 | "≤1 猫/区块"语义下解空间过松，唯一化只能靠全挖格 | **规则升级为"每区块恰好一猫"**（taevas 确认）：区块数=N、双射约束收紧解空间，强制格降至 ~2、难度真实拉开（54~99） |
| 8 | 09-30 | 恰好语义下生成 100% count0 | 挖格/收紧用递增 id，max id ≠ N-1 被求解器判 K≠N | 每次产生新 id 的操作后立即 compactIds |
| 9 | 09-30 | 边界移动后区块含双猫 | R1 剩余碎片整块并入邻块时把 R1 的猫也带过去 | mergeRegionRest 增加 keepCell：含猫碎片保留原 id |
| 10 | 09-30 | 网页棋盘高度塌陷（空格 0px 高） | grid 行高由内容撑开，空格无内容 | .board 加 grid-auto-rows:1fr + .cell 加 aspect-ratio:1 |
| 11 | 09-30 | 验收驱动点击末行无效 | 目标格在视口外，elementFromPoint 返回 null | __zmm.tap/dragX 先 scrollIntoView |
| 12 | 09-30 | 胜利后重置无法继续操作 | reset 未清 won 标志、未移除胜利弹窗 | reset 清 won/移除弹窗/重置计时 |
| 13 | 09-30 | 空盘提示显示"本关已完成" | analyze 返回的 solved 是"推理链可走完"，不是"当前已完成" | 提示按当前猫数+零冲突判定已完成 |
| 14 | 09-30 | L100 生成耗时 120s | 挖格预算与难度目标脱钩，大量注定失败的尝试跑满预算 | maxCarves=forcedWish+4 快速失败 + 单次尝试 8s 限时 |
| 15 | 09-30 | 宫格无分隔、同色块内格子糊成一片（taevas 反馈：应像数独） | 样式只画了区块边界 | 双端 .cell 加 1px 半透明宫格细线，区块边界保持 3px 粗线 |
| 16 | 09-30 | 批量生成出现 29 组难度撞分 | 带内匹配(±5)允许不同关卡落同一分值 | genLevel 增加 usedScores 全局难度去重，撞分候选直接换尝试 |
| 17 | 09-30 | 同一颜色出现在多个不连通区块（taevas 确认：同色必连通） | 旧实现用贪心图着色复用 16 色 | 调色板扩到 24 色，区块独占一色（恒等映射），recolor 迁移 100 关 + validate 加恒等校验 |
| 18 | 09-30 | 提示「无猫猫区」cells 未转坐标导致高亮失效/跟随死循环 | point-* 提示直接把格索引塞进 cells | 统一 toRC 转 [r,c]；补单测（跟随提示可解到终局） |
| 19 | 09-30 | 换关后棋盘无法点击 | 胜利/失败遮罩挂在 body，renderGame 不清理 → 全屏挡住 elementFromPoint | renderGame 先移除遗留遮罩 |
| 20 | 09-30 | 仿射校准无法消除难度撞分（100 关 > 96 个可用整数） | 纯线性映射天生会碰撞 | 改为单调分段校准表：raw 全序排名 → 1..100 恰好占满，烘焙进 difficulty.js 保证双端复算一致 |
| 21 | 09-30 | recalibrate 去重重生成又产生 raw 撞车 | ZMM_FAST 重生成不做 raw 检查 | 去重循环校验新 raw 不在已占用集合，撞了换 seedBase 再试（≤12 次） |
| 22 | 09-30 | 设计文档交互表仍是旧模型（单击X→再点放猫） | 交互升级为「双击判定」后文档未同步 | GAME_DESIGN §2 更新为判定模型（人工X/系统X/失败2次）；QA 抽验 L025 跟随7类提示整局通过 |
| 23 | 09-30 | 提示缺系统级规则（taevas 提出：k 区块↔k 行子集排除、占位反证排除） | 引擎只有 k=1 指向规则 | hint.js 新增 subset（k=2..3 Hall 子集，权重5）+ reductio（单格反证，权重6），接入 analyze/nextHint/文档/难度；全库试错步 132→1，几乎全部纯逻辑可解 |
| 24 | 09-30 | 规则升级后难度撞分 21 组 | 校准表锚点用旧规则 raw，重算用新规则 raw → 错位 | recalibrate 加第 0 步：先按当前引擎重算全部 detail 再烘焙锚点 |
| 25 | 09-30 | recalibrate 烘焙拼接把 difficulty.js 写出语法错误 | 字符串手术依赖旧行格式，脆弱 | 改为整文件模板重写（calSrc 模板 + CAL_RAW/CAL_SCORE 注入） |
| 26 | 09-30 | 小程序棋盘无法触摸操作（代码审查发现） | onLoad 时 #board 未渲染，boundingClientRect 得 null，坐标换算全失败 | 测量挪到 onReady（首帧后），封装 measureBoard |
| 27 | 09-30 | 网页点「← 列表」卡在棋盘页 | location.hash 赋空串在 Chrome 不触发 hashchange，路由不执行 | 改主动路由 navigate()（replaceState + route），hashchange 仅作前进/后退兜底；全链路实测（点卡进关→通关→下一关→回列表）通过 |
| 28 | 09-30 | 拖动连标不含起点格，且双端行为不一致（小程序桩测试发现） | 两端都是 move 才标 X，按下不标；网页重写判定制时也丢了"按下即标" | 双端统一：空白格按下即标 X（起点属"经过的地方"），移动连标；已有 X 的格单击恢复空白；新增小程序页面桩测试 4 例纳入 npm test |
| 29 | 09-30 | 游戏文案满屏术语（taevas 反馈：要人话） | R4C5/区块B/候选格/八向紧贴等工程语言 | hint.js 全部文案重写（坐标→第r排第c列、区块→色名"薄荷绿"等、候选格→能住猫的格子），色名经 names 参数注入（core.PALETTE 单一来源）；规则说明口语化（"连在一起的同色格子""猜错2次这关就输了"）；文档重生成 |
| 30 | 09-30 | 小程序无法在本机跑起来验收 | CLI 服务端口需 GUI 内开启；touristappid 被新版工具拒绝 | taevas 开端口+导入（测试号 wx57df…）；引入 miniprogram-automator 全自动驱动真实模拟器（scripts/mp-automator.test.js）：列表100卡/棋盘渲染/双击判定/判错失败/跟随提示通关 全过，附 3 张模拟器截图 |
| 31 | 09-30 | 要做动画改造，原生版不适合重动效（taevas 决策） | 页面体系无逐帧动画能力 | 单独新建 cocos/（Cocos Creator 3.8.8，微信小游戏目标），不动原生版：boot.ts 全动态 UI（Graphics+Label+tween 零纹理），动画=猫弹跳/判错抖动红闪/彩纸/卡片入场；build-cocos 命令把引擎 UMD 转 TS + 100 关数据同步进工程（单一来源） |
| 32 | 10-01 | cocos 页面启动报 Boot 组件 corrupted 被移除，游戏黑屏 | 手写场景里 Boot 的压缩 uuid（sAewBw…）是非法值，与 boot.ts.meta uuid（b007b007-…）对不上 | 按 Cocos 压缩算法（保留前 5 位+base64）重算为 b007bAHAABAAIAAwP/uAAAB 并改 main.scene |
| 33 | 10-01 | 全场景不渲染，只见相机 clear color | 手写场景所有节点 _lscale 写成 (0,0,0)，整棵树缩成一个点 | main.scene 全部 _lscale 改 (1,1,1) |
| 34 | 10-01 | 节点树/坐标正确但仍 0 绘制 UI | 运行时 new Node() 默认 layer=DEFAULT(1<<30)，相机 visibility 只含 UI_2D | boot.ts 统一 uiNode() 工厂创建节点并挂 UI_2D 层 |
| 35 | 10-01 | 6 猫全部放上后胜利永不触发 | TS 降级 ES5 把 [...map.values()] 编成 [].concat(iterator)，concat 不展开迭代器恒为空 | 迭代器展开一律改 Array.from（judge 计数 + 驱动 state） |
| 36 | 10-01 | 图片资源运行时加载不到 spriteFrame | CLI 导入把 resources/img 全部标成 type=texture，没生成 spriteFrame 子资源 | 15 张图 meta 改 type=sprite-frame 并清 library 缓存重导入 |
| 37 | 10-01 | 画面被放大裁切、取景错位 | 手写场景 Canvas 未绑相机，ortho 恒 480，与代码设定的 720×1280 竖屏分辨率脱节 | onLoad 里 setDesignResolutionSize(720,1280,FIXED_HEIGHT) + 绑定 cameraComponent + update 每帧同步 ortho=可视高一半 |
| 38 | 10-01 | 冒烟就绪竞态：ready() 首个回调即真，猫图未加载完就开打 | loadAll 期间 frames 键逐个出现被误判为加载完成 | ready() 改为 loadAll 整体完成标志；catNode 缺图兜底回 🐱 |
| 39 | 10-01 | 4 路毒舌评审 62 条：high 17 条全修 + med 15 条（视觉融合度/提示高亮自杀/列表 stagger 写反/星级静音/退场零动画/失败囚禁/无 BGM/零总进度/终局无仪式/20×20 性能/微信包过期/示例 appid/emoji 混搭等） | 手写场景底子 + 迭代快，缺成品级打磨 | boot.ts 全量重构：单 Graphics 棋盘（400 格 1dc）+ 惰性渲染件、猫脚下阴影、卡通字全局、✕ 图标化、统一退场动画、提示高亮关弹窗后脉冲点亮、失败双按钮、finale 结算、总进度/继续按钮/页码、星级 ding 音、toast、按压即时反馈、真 appid、wx 构建新鲜度守卫；余项（猫换色变体/BGM 曲目）挂后台 |
| 40 | 10-01 | 【待查】章节色卡贴图（card_green 等 5 张）运行时不渲染，fallback 暖白卡在用（功能无损） | Cocos asset-db 对「先建后改 meta type」的导入时序不确定：uuid 被重写、spriteFrame 子资产不生成、构建产物 config 有路径但加载链路断——手写 meta/脚本删缓存/两段式构建均未能稳定修复 | 章节色素材与 CHAPTERS.card 映射代码已入库（修好导入即自动点亮）；需 Cocos Creator 编辑器 GUI 内排查 asset-db 导入（或用官方 API 批量生成 meta）；相关脚本与色卡已留档 asset-candidates/generated/card-tiles/ |
