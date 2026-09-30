/* 小程序端到端验收（miniprogram-automator 驱动真实微信开发者工具）
 * 用法：先 `cli auto --project ... --auto-port 9420`，再 `node scripts/mp-automator.test.js`
 * 覆盖：页面栈、关卡列表渲染、进入游戏、触摸（经 page.callMethod 直调页面方法）、
 * 双击判定/判错计失败、提示、胜利、截图。 */
'use strict';
const automator = require('miniprogram-automator');

(async () => {
  const mini = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const log = [];

  /* 1. 基础连接与页面栈 */
  const sys = await mini.systemInfo();
  log.push('连接 ✓ 平台=' + sys.platform + ' 窗口=' + sys.windowWidth + 'x' + sys.windowHeight);

  /* 2. 列表页渲染（100 关） */
  let page = await mini.currentPage();
  if (page.path !== 'pages/list/list') {
    await mini.reLaunch('/pages/list/list');
    page = await mini.currentPage();
  }
  await page.waitFor(600);
  const cards = await page.$$('.card');
  log.push('列表页: ' + cards.length + ' 张关卡卡片（期望 100）');

  /* 3. 进入 L1 游戏 */
  await mini.navigateTo('/pages/game/game?id=1');
  page = await mini.currentPage();
  await page.waitFor(1200); /* 等渲染与 onReady 测量 */
  const cells = await page.$$('.cell');
  log.push('L1 棋盘: ' + cells.length + ' 格（期望 36）');

  /* 触摸工具：真实走 onTouchStart/onTouchEnd（含双击时序） */
  const meta = await page.callMethod('cellMeta'); /* 见下方 game.js 注入 */
  const tap = async (r, c) => {
    const p = [meta.left + c * meta.cellPx + 2, meta.top + r * meta.cellPx + 2];
    await page.callMethod('onTouchStart', { touches: [{ clientX: p[0], clientY: p[1] }] });
    await page.callMethod('onTouchEnd', { changedTouches: [{ clientX: p[0], clientY: p[1] }] });
  };
  const dbl = async (r, c) => { await tap(r, c); await tap(r, c); };
  const state = async () => await page.callMethod('debugState');

  /* 4. 双击判定 L1 全部答案 → 胜利 */
  const st0 = await state();
  for (const [r, c] of st0.solution) await dbl(r, c);
  const st1 = await state();
  log.push('双击判定全解: 猫=' + st1.cats + '/' + st1.n + ' 猜错=' + st1.fails + ' 胜利=' + st1.won);
  await page.waitFor(400);

  /* 5. 截图（胜利弹层） */
  await mini.screenshot({ path: 'docs/screenshots/mp-L001-win.png' });
  log.push('截图 ✓ docs/screenshots/mp-L001-win.png');

  /* 6. 重置 → 判错 2 次 → 失败弹层 → 截图 */
  await page.callMethod('onTapReset');
  await page.waitFor(300);
  const st2 = await state();
  let wrongs = [];
  outer: for (let r = 0; r < st2.n; r++) for (let c = 0; c < st2.n; c++) {
    if (!st2.solution.some(s => s[0] === r && s[1] === c)) { wrongs.push([r, c]); if (wrongs.length === 2) break outer; }
  }
  for (const [r, c] of wrongs) await dbl(r, c);
  const st3 = await state();
  log.push('判错 2 次: 猜错=' + st3.fails + ' 失败=' + st3.failed + '（期望 2/true）');
  await page.waitFor(400);
  await mini.screenshot({ path: 'docs/screenshots/mp-L001-fail.png' });

  /* 7. 重试 → 跟随提示通关（引擎 nextHint 驱动） */
  await page.callMethod('onTapReset');
  await page.waitFor(300);
  const CatChess = require('../miniprogram/utils/engine/index.js');
  let hinted = 0;
  for (let k = 0; k < 80; k++) {
    const st = await state();
    const names = st.regionColors.map(ci => CatChess.PALETTE[ci][1]);
    const res = CatChess.nextHint(st.level, st.catsList, st.xsList, names);
    if (res.solved) break;
    const h = res.hint;
    if (h.action === 'cat') {
      await dbl(h.cells[0][0], h.cells[0][1]);
      if ((await state()).fails > 0) { log.push('✗ 提示误导!'); break; }
    } else if (h.action === 'x') {
      for (const [r, c] of h.cells) {
        const stc = await state();
        if (!stc.marks[r * stc.n + c]) await tap(r, c);
      }
    }
    hinted++;
  }
  const st4 = await state();
  log.push('跟随提示: ' + hinted + ' 步 → 胜利=' + st4.won + ' 猫=' + st4.cats + '/' + st4.n + ' 猜错=' + st4.fails);
  await mini.screenshot({ path: 'docs/screenshots/mp-L001-hint-win.png' });

  console.log(log.join('\n'));
  const ok = st1.won && st3.failed && st4.won && st4.fails === 0 && cards.length === 100 && cells.length === 36;
  await mini.disconnect();
  process.exit(ok ? 0 : 2);
})().catch(e => { console.error('自动化失败:', e.message); process.exit(1); });
