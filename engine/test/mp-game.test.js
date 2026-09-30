/* 小程序 game 页面逻辑测试（Node 桩环境，无需微信开发者工具）
 * 覆盖：onLoad/onReady 测量时机、触摸→坐标换算、单击人工X/拖动连标/双击判定、
 * 判错计失败、失败2次弹层、重试重置、胜利、提示。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

/* ---- wx / Page 桩 ---- */
function makeStub() {
  const storage = {};
  const modals = [];
  const nav = [];
  let rectCb = null;
  global.wx = {
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 700 }),
    setNavigationBarTitle: () => {},
    getStorageSync: k => (k in storage ? storage[k] : undefined),
    setStorageSync: (k, v) => { storage[k] = v; },
    showModal: o => modals.push(o),
    navigateTo: o => nav.push(['to', o.url]),
    redirectTo: o => nav.push(['redirect', o.url]),
    navigateBack: () => nav.push(['back'])
  };
  global.Page = def => {
    def.data = def.data || {};
    def.setData = function (a, b) {
      if (typeof a === 'string') {
        const m = a.match(/^(.+?)\[(\d+)\]\.(.+)$/);
        if (m) this.data[m[1]][Number(m[2])][m[3]] = b;
        else this.data[a] = b;
      } else {
        Object.assign(this.data, a);
      }
    };
    global.__page = def;
  };
  let boardRect = null; /* 默认 null：模拟「未渲染」状态 */
  global.wx.createSelectorQuery = () => ({
    select: () => ({
      boundingClientRect: cb => { rectCb = cb; return { exec: () => rectCb(boardRect) }; }
    })
  });
  return {
    modals, nav, storage,
    setBoardRect: r => { boardRect = r; } /* 测试中模拟渲染完成 */
  };
}

function loadPage() {
  delete require.cache[require.resolve(path.join(__dirname, '../../miniprogram/pages/game/game.js'))];
  require(path.join(__dirname, '../../miniprogram/pages/game/game.js'));
  return global.__page;
}

const LEVELS = require(path.join(__dirname, '../../miniprogram/data/levels.js'));
const CELL = 30; /* 375-24=351 → 11×11 时 351/11=31.9；测试统一用小盘 6×6: floor(351/6)=58 —— 见各用例计算 */
const RECT = { left: 12, top: 100 };

function touchEvent(cells, phase) {
  /* cells: [[x,y],...]；start/move 用 touches，end 用 changedTouches */
  const list = cells.map(p => ({ clientX: p[0], clientY: p[1] }));
  return phase === 'end' ? { changedTouches: list } : { touches: list };
}

test('小程序页面：onLoad 时不测量（防未渲染 null），onReady 后可操作', () => {
  const stub = makeStub();
  const page = loadPage();
  page.onLoad({ id: 1 });
  /* onLoad 后 rect 仍为 null → 触摸应安全返回 -1 而不崩溃 */
  page.onTouchStart(touchEvent([[30, 130]], 'start'));
  assert.deepStrictEqual(page.marks, {}, '未测量时触摸不应产生标记');
  /* onReady 后测量生效 */
  stub.setBoardRect(RECT);
  page.onReady();
  assert.ok(page.rect, 'onReady 后应持有棋盘位置');
});

test('小程序页面：单击人工X切换、拖动连标、双击判定、判错计失败', () => {
  const stub = makeStub();
  stub.setBoardRect(RECT);
  const page = loadPage();
  page.onLoad({ id: 1 });
  page.onReady();
  const lv = page.level, n = lv.size;
  const cellPx = page.cellPx;
  const xy = (r, c) => [RECT.left + c * cellPx + 2, RECT.top + r * cellPx + 2];
  const tap = (r, c) => { page.onTouchStart(touchEvent([xy(r, c)], 'start')); page.onTouchEnd(touchEvent([xy(r, c)], 'end')); };
  const dbl = (r, c) => { tap(r, c); tap(r, c); };

  /* 单击 → 人工X；再单击 → 恢复（中间隔断双击检测——两次快速单击本身会触发判定，属规格行为） */
  tap(0, 0);
  assert.strictEqual(page.marks[0], 1, '单击应标人工X');
  page.lastTap = { i: -1, t: 0 };
  tap(0, 0);
  assert.strictEqual(page.marks[0], undefined, '再单击应恢复空白');

  /* 拖动连标 */
  page.onTouchStart(touchEvent([xy(1, 0)], 'start'));
  page.onTouchMove(touchEvent([xy(1, 1)], 'move'));
  page.onTouchMove(touchEvent([xy(1, 2)], 'move'));
  page.onTouchEnd(touchEvent([xy(1, 2)], 'end'));
  assert.ok(page.marks[n + 0] === 1 && page.marks[n + 1] === 1 && page.marks[n + 2] === 1, '拖动路径 3 格应连标 X');

  /* 双击判定：答案格 → 猫 */
  const [r1, c1] = lv.solution[0];
  dbl(r1, c1);
  assert.strictEqual(page.sys[r1 * n + c1], 'cat', '双击答案格应锁定为猫');
  assert.strictEqual(page.fails, 0);

  /* 双击判定：非答案格 → 系统X + 失败+1 */
  let wrong = null;
  outer: for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!lv.solution.some(s => s[0] === r && s[1] === c) && !(page.sys[r * n + c])) { wrong = [r, c]; break outer; }
  }
  dbl(wrong[0], wrong[1]);
  assert.strictEqual(page.sys[wrong[0] * n + wrong[1]], 'x', '判错格应变系统X');
  assert.strictEqual(page.fails, 1, '失败应 +1');

  /* 人工标记不影响系统判定 */
  tap(r1, c1);
  assert.strictEqual(page.marks[r1 * n + c1], undefined, '单击猫格不应产生人工X');
  tap(wrong[0], wrong[1]);
  assert.strictEqual(page.marks[wrong[0] * n + wrong[1]], undefined, '单击系统X格不应产生人工X');

  /* 再判错一次 → 失败 2 次 → 弹失败层 */
  let wrong2 = null;
  outer2: for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!lv.solution.some(s => s[0] === r && s[1] === c) && !(page.sys[r * n + c])) { wrong2 = [r, c]; break outer2; }
  }
  dbl(wrong2[0], wrong2[1]);
  assert.strictEqual(page.fails, 2);
  assert.strictEqual(page.failed, true, '失败 2 次应标记本关失败');
  assert.strictEqual(stub.modals.length, 1, '应弹出失败层');
});

test('小程序页面：重试重置后可重新通关、胜利写进度', () => {
  const stub = makeStub();
  stub.setBoardRect(RECT);
  const page = loadPage();
  page.onLoad({ id: 1 });
  page.onReady();
  const lv = page.level, n = lv.size;
  const cellPx = page.cellPx;
  const tap = (r, c) => { page.onTouchStart(touchEvent([[RECT.left + c * cellPx + 2, RECT.top + r * cellPx + 2]], 'start')); page.onTouchEnd(touchEvent([[RECT.left + c * cellPx + 2, RECT.top + r * cellPx + 2]], 'end')); };

  /* 失败 2 次 */
  let w = [];
  outer: for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!lv.solution.some(s => s[0] === r && s[1] === c)) { w.push([r, c]); if (w.length === 2) break outer; }
  }
  w.forEach(([r, c]) => { tap(r, c); tap(r, c); });
  assert.strictEqual(page.failed, true);

  /* 重试（失败弹层确认按钮）→ 状态全清 */
  stub.modals[0].success({ confirm: true });
  assert.strictEqual(page.fails, 0, '重试应清失败计数');
  assert.strictEqual(page.failed, false);
  assert.deepStrictEqual(page.sys, {}, '重试应清系统判定');

  /* 全判对 → 胜利 + 进度写入 */
  lv.solution.forEach(([r, c]) => { tap(r, c); tap(r, c); });
  assert.strictEqual(page.won, true, '应胜利');
  assert.strictEqual(stub.storage.zmm_won[1], 1, '进度应写入');
  assert.strictEqual(stub.modals.length, 2, '应弹出胜利层');
});

test('小程序页面：提示走通（含新推理规则）', () => {
  const stub = makeStub();
  stub.setBoardRect(RECT);
  const page = loadPage();
  page.onLoad({ id: 3 });
  page.onReady();
  const CatChess = require(path.join(__dirname, '../../miniprogram/utils/engine/index.js'));
  const lv = page.level, n = lv.size;
  const cellPx = page.cellPx;
  const tap = (r, c) => { page.onTouchStart(touchEvent([[RECT.left + c * cellPx + 2, RECT.top + r * cellPx + 2]], 'start')); page.onTouchEnd(touchEvent([[RECT.left + c * cellPx + 2, RECT.top + r * cellPx + 2]], 'end')); };
  let ok = false, hints = 0;
  for (let k = 0; k < 120; k++) {
    const res = CatChess.nextHint(lv, page.catsList(), page.xsList());
    if (res.solved) { ok = true; break; }
    if (res.error) break;
    hints++;
    const h = res.hint;
    if (h.action === 'cat') { tap(h.cells[0][0], h.cells[0][1]); tap(h.cells[0][0], h.cells[0][1]); if (page.fails > 0) break; }
    else if (h.action === 'x') h.cells.forEach(([r, c]) => tap(r, c));
    else break;
  }
  assert.ok(ok && page.won && page.fails === 0, '跟随提示应通关且零判错（用了 ' + hints + ' 次提示）');
});
