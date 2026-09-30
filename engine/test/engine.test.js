/* 引擎单元测试：node --test engine/test/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const CatChess = {};
Object.assign(CatChess,
  require('../src/core'),
  require('../src/solver'),
  require('../src/hint'),
  require('../src/difficulty'),
  require('../src/generator'));

test('求解器：4×4 每行一个区块 → 恰 2 个「相邻行列差≥2」排列', () => {
  const regions = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3];
  const level = { size: 4, regions: regions };
  const res = CatChess.solve(level, 10);
  assert.strictEqual(res.count, 2);
  const keys = res.solutions.map(s => s.map(rc => rc[1]).join('')).sort();
  assert.deepStrictEqual(keys, ['1302', '2031']);
});

test('求解器：单格区块强制（R1C2 单格）→ 唯一解', () => {
  /* 恰好规则：K=4；r0=1 由单格强制，r1=3/r2=0/r3=2 由排除链推出 → 唯一解 [1,3,0,2] */
  const regions = [2, 1, 2, 2,
                   2, 2, 2, 2,
                   3, 3, 3, 3,
                   0, 0, 0, 0];
  const level = { size: 4, regions: regions };
  const res = CatChess.solve(level, 10);
  assert.strictEqual(res.count, 1);
  assert.deepStrictEqual(res.solutions[0].map(rc => rc[1]), [1, 3, 0, 2]);
});

test('求解器：区块数 ≠ n（恰好规则）→ 0 解', () => {
  const regions = [0, 0, 1, 1,
                   0, 0, 1, 1,
                   2, 2, 3, 3,
                   2, 2, 3, 3]; /* K=4 ✓ 但换成 K=5 的下面这个 */
  assert.ok(CatChess.solve({ size: 4, regions: regions }, 5).count >= 1); /* 四象限区块仍可解 */
  const bad = [0, 0, 1, 1,
               0, 0, 1, 1,
               2, 2, 3, 3,
               2, 2, 4, 4]; /* K=5 ≠ 4 */
  assert.strictEqual(CatChess.solve({ size: 4, regions: bad }, 5).count, 0);
});

test('求解器：区块过少（放不下 N 只猫）→ 0 解', () => {
  const regions = new Array(16).fill(0);
  const res = CatChess.solve({ size: 4, regions: regions }, 5);
  assert.strictEqual(res.count, 0);
});

test('放置校验：行/列/区块/八邻冲突全部可检出；isWin 判定', () => {
  const regions = [0, 0, 1, 1,
                   0, 0, 1, 1,
                   2, 2, 3, 3,
                   2, 2, 3, 3];
  const level = { size: 4, regions: regions };
  /* 同行 (R1C1,R1C3)、同列 (R1C1,R3C1)、同区块 (R1C1,R2C2 同区块0)、八邻 (R1C1,R2C2 对角) */
  const vi = CatChess.checkPlacement(level, [[0, 0], [0, 2], [1, 1], [2, 0]]);
  const types = vi.map(v => v.type).sort();
  assert.ok(types.includes('row'), '应检出同行冲突');
  assert.ok(types.includes('col'), '应检出同列冲突');
  assert.ok(types.includes('region'), '应检出同区块冲突');
  assert.ok(types.includes('adj'), '应检出八邻相邻');
  const ok = [[0, 1], [1, 3], [2, 0], [3, 2]];
  assert.strictEqual(CatChess.checkPlacement(level, ok).length, 0);
  assert.strictEqual(CatChess.isWin(level, ok), true);
});

test('生成器：6×6 多样本恒唯一解、区块连通、强制格 ⊆ 解', () => {
  let checked = 0;
  for (let s = 0; s < 20 && checked < 8; s++) {
    const lv = CatChess.generate({ size: 6, seed: 1000 + s * 37, forcedWish: 2, horizBias: 0.5 });
    if (!lv) continue; /* 个别种子形状不佳跳过（CLI 层有重试） */
    checked++;
    const res = CatChess.solve(lv, 5);
    assert.strictEqual(res.count, 1, 'seed ' + s + ' 应唯一解');
    assert.strictEqual(CatChess.checkPlacement(lv, lv.solution).length, 0);
    assert.strictEqual(CatChess.regionCount(lv.regions), 6, '区块数必须 = n');
    for (const rc of lv.forced) {
      assert.ok(lv.solution.some(c => c[0] === rc[0] && c[1] === rc[1]), '强制格必须在解中');
    }
    /* 连通性抽查 */
    const n = 6, g = lv.regions, K = CatChess.regionCount(g);
    const sizes = new Array(K).fill(0); g.forEach(id => sizes[id]++);
    for (let k = 0; k < K; k++) {
      const start = g.indexOf(k), seen = new Set([start]), stack = [start];
      while (stack.length) {
        const i = stack.pop(), r = (i / n) | 0, c = i % n;
        for (const nb of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
          const j = nb[0] * n + nb[1];
          if (nb[0] >= 0 && nb[0] < n && nb[1] >= 0 && nb[1] < n && g[j] === k && !seen.has(j)) { seen.add(j); stack.push(j); }
        }
      }
      assert.strictEqual(seen.size, sizes[k], '区块 ' + k + ' 应连通');
    }
  }
  assert.ok(checked >= 5, '成功样本应足够多');
});

test('提示引擎：从空盘可推到终局，且步序一致于解', () => {
  let lv = null;
  for (let s = 0; s < 20 && !lv; s++) lv = CatChess.generate({ size: 8, seed: 700 + s * 31, forcedWish: 2, horizBias: 0.5 });
  assert.ok(lv, '应能生成 8×8 样本');
  const tr = CatChess.analyze(lv);
  assert.ok(tr.solved, '应推理完成，错误: ' + (tr.error || ''));
  assert.strictEqual(tr.cats.length, 8);
  const a = tr.cats.map(c => c.join(',')).sort().join(';');
  const b = lv.solution.map(c => c.join(',')).sort().join(';');
  assert.strictEqual(a, b);
});

test('提示引擎：矛盾局面（错误 X 标满一行）应报错', () => {
  let lv = null;
  for (let s = 0; s < 20 && !lv; s++) lv = CatChess.generate({ size: 6, seed: 30 + s * 11, forcedWish: 1, horizBias: 0.5 });
  assert.ok(lv, '应能生成 6×6 样本');
  const xs = [];
  for (let c = 0; c < 6; c++) xs.push([0, c]);
  const tr = CatChess.analyze(lv, [], xs);
  assert.ok(tr.error, '应报告矛盾');
});

test('难度打分：同一关打分确定、范围合法', () => {
  let lv = null;
  for (let s = 0; s < 20 && !lv; s++) lv = CatChess.generate({ size: 10, seed: 20 + s * 13, forcedWish: 2, horizBias: 0.5 });
  assert.ok(lv, '应能生成 10×10 样本');
  const tr = CatChess.analyze(lv);
  const s1 = CatChess.score(lv, tr);
  const s2 = CatChess.score(lv, CatChess.analyze(lv));
  assert.strictEqual(s1.total, s2.total);
  assert.ok(s1.total >= 3 && s1.total <= 99);
});

test('单步提示：类型结构化、优先级有序、可从空盘提示到完成', () => {
  let lv = null;
  for (let s = 0; s < 30 && !lv; s++) lv = CatChess.generate({ size: 6, seed: 900 + s * 17, forcedWish: 2, horizBias: 0.5 });
  assert.ok(lv, '应能生成 6×6 样本');
  const cats = [], xs = [];
  const seen = new Set();
  for (let k = 0; k < 60; k++) {
    const res = CatChess.nextHint(lv, cats, xs);
    assert.ok(!res.error, '不应报错: ' + (res.error || ''));
    if (res.solved) break;
    const h = res.hint;
    assert.ok(h.type && h.label && h.action && h.text, '提示结构完整');
    assert.ok(['conflict', 'x-prop', 'forced', 'row-single', 'col-single', 'region-single', 'point-row', 'point-col', 'point-region', 'subset', 'reductio', 'trial'].includes(h.type), '类型合法: ' + h.type);
    seen.add(h.type);
    if (h.action === 'cat') cats.push(h.cells[0]);
    else if (h.action === 'x') for (const rc of h.cells) xs.push(rc);
    else break;
  }
  assert.strictEqual(cats.length, 6, '跟随提示应放满 6 只猫');
  assert.strictEqual(CatChess.isWin(lv, cats), true, '跟随提示的结果应等于唯一解');
});

test('单步提示：冲突优先（双猫同行第一优先级）', () => {
  const lv = CatChess.generate({ size: 6, seed: 901, forcedWish: 1, horizBias: 0.5 });
  if (!lv) return;
  const res = CatChess.nextHint(lv, [lv.solution[0], [lv.solution[0][0], (lv.solution[0][1] + 2) % 6]], []);
  assert.ok(res.hint && res.hint.type === 'conflict', '应优先提示冲突');
});

test('单步提示：判错后的系统 X 应参与排除（x-prop 提示未标记的无猫区）', () => {
  let lv = null;
  for (let s = 0; s < 30 && !lv; s++) lv = CatChess.generate({ size: 6, seed: 400 + s * 7, forcedWish: 2, horizBias: 0.5 });
  assert.ok(lv);
  const cat0 = lv.solution[0];
  const res = CatChess.nextHint(lv, [cat0], []);
  assert.ok(res.hint && res.hint.type === 'x-prop', '放第一只猫后应提示无猫区排除，实际: ' + (res.hint && res.hint.type));
  assert.ok(res.hint.cells.length >= 1, '应给出可标记格');
});

test('小区块权重：惩罚凸型逐级递减（16/9/4/1/0），归一换算与钳制正确', () => {
  /* K=6：区块尺寸 1/2/3/4/5/10 → P = 16+9+4+1 = 30，pn = 5，W = 50 */
  const regions = [0,
                   1, 1,
                   2, 2, 2,
                   3, 3, 3, 3,
                   4, 4, 4, 4, 4,
                   5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
  const pen = CatChess.regionPenalty(regions);
  assert.strictEqual(pen.P, 30);
  assert.strictEqual(pen.pn, 5);
  assert.strictEqual(pen.c1, 1); assert.strictEqual(pen.c2, 1);
  assert.strictEqual(pen.c3, 1); assert.strictEqual(pen.c4, 1);
  assert.strictEqual(CatChess.weightOf(regions), 50);
  /* 全 ≥5 格区块 → 满分 */
  const even = new Array(36).fill(0).map((_, i) => (i / 6) | 0);
  assert.strictEqual(CatChess.regionPenalty(even).P, 0);
  assert.strictEqual(CatChess.weightOf(even), 100);
  /* 全单格（极限）→ 钳制为 0 */
  assert.strictEqual(CatChess.weightOf([0, 1, 2, 3, 4, 5]), 0);
});

test('生成器收紧分档：tightenMin/Max 可调，大保留格数小区块惩罚更低', () => {
  const sumPen = (tmn, tmx) => {
    let sum = 0, got = 0;
    for (let s = 0; s < 6; s++) {
      const lv = CatChess.generate({ size: 12, seed: 3100 + s * 13, forcedWish: 1, horizBias: 0.5, tighten: true, tightenMin: tmn, tightenMax: tmx });
      if (!lv) continue;
      got++;
      assert.strictEqual(CatChess.regionCount(lv.regions), 12, '区块数必须 = n');
      sum += CatChess.regionPenalty(lv.regions).P;
    }
    assert.ok(got >= 3, '成功样本应足够多（实际 ' + got + '）');
    return sum / got;
  };
  const avgTight = sumPen(2, 3);
  const avgLoose = sumPen(5, 7);
  assert.ok(avgLoose < avgTight, '收紧保留 5~7 格的总惩罚应低于 2~3 格（' + avgLoose + ' < ' + avgTight + '）');
});

test('生成配置 genconfig：分档收紧与权重阈值（CLI 与 web 生成器共用同一份）', () => {
  const cfg = require('../src/genconfig');
  assert.strictEqual(cfg.DIFF_BAND, 5);
  assert.strictEqual(cfg.W_ACCEPT, 70);
  assert.strictEqual(cfg.WEIGHT_MIN_SIZE, 12);
  assert.ok(cfg.WEB_GRACE_MS > 0 && cfg.ATTEMPTS > 0 && cfg.ROUNDS > 0);
  const hi = cfg.paramSpace(16, 95, CatChess.mulberry32(7));
  assert.strictEqual(hi.tighten, true);
  assert.strictEqual(hi.tightenMin, 5); assert.strictEqual(hi.tightenMax, 7);
  const mid = cfg.paramSpace(12, 50, CatChess.mulberry32(7));
  assert.strictEqual(mid.tighten, true);
  assert.strictEqual(mid.tightenMin, 4); assert.strictEqual(mid.tightenMax, 5);
  const lo = cfg.paramSpace(6, 50, CatChess.mulberry32(7));
  assert.strictEqual(lo.tightenMin, 2); assert.strictEqual(lo.tightenMax, 3);
  assert.strictEqual(typeof lo.tighten, 'boolean'); /* 小棋盘保留概率开关 */
  const easy = cfg.paramSpace(20, 10, CatChess.mulberry32(7));
  const hard = cfg.paramSpace(20, 95, CatChess.mulberry32(7));
  assert.ok(easy.forcedWish > hard.forcedWish, '越难强制格越少');
});

test('生成器：浏览器模式加载（无 require/module，依赖全局 CatChess 注入）', () => {
  const vm = require('node:vm');
  const src = f => require('node:fs').readFileSync(require('node:path').join(__dirname, '../src', f), 'utf8');
  const ctx = vm.createContext({ self: {} }); /* 模拟浏览器全局：无 module / 无 require */
  for (const f of ['core.js', 'solver.js', 'generator.js', 'genconfig.js']) vm.runInContext(src(f), ctx, { filename: f });
  const CC = ctx.self.CatChess;
  assert.ok(CC && CC.generate && CC.paramSpace && CC.weightOf, '全局 CatChess 应合并生成器与配置');
  let lv = null;
  for (let s = 0; s < 10 && !lv; s++) lv = CC.generate({ size: 6, seed: 321 + s * 17, forcedWish: 1, horizBias: 0.5, tighten: true, tightenMin: 2, tightenMax: 3 });
  assert.ok(lv, '浏览器模式应能生成关卡');
  assert.strictEqual(CC.regionCount(lv.regions), 6);
  assert.strictEqual(CC.solve(lv, 5).count, 1, '浏览器模式生成的关卡应唯一解');
  assert.ok(CC.weightOf(lv.regions) >= 0);
});
