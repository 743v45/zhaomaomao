/* 猫棋提示引擎（人类逻辑推理链）：从任意局面推导下一步。
 * 步骤类型与权重：forced(1) 单格区块强制；single(2) 行/列/区块唯一候选；
 * pointing(4) 区块-行/列指向排除（k=1 子集）；subset(5) k=2..3 子集排除
 * （k 个区块的候选只落在 k 行/列 → 这些行/列的猫位属于它们 → 其他区块在此的格全排除）；
 * reductio(6) 反证排除（某格若有猫→某行/列/区块将无猫可放→矛盾→该格必无猫）；
 * trial(8) 逻辑不足需试错；x(0) 放猫后的排除传播。
 * 难度打分（difficulty.js）与每关提示文档均基于本引擎输出。UMD 三端通用。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.CatChess = root.CatChess || {}; Object.assign(root.CatChess, factory()); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WEIGHTS = { x: 0, forced: 1, single: 2, pointing: 4, subset: 5, reductio: 6, trial: 8 };
  const TYPE_LABEL = { x: '排除', forced: '强制', single: '唯一', pointing: '指向', subset: '子集', reductio: '反证', trial: '试错' };

  function letter(i) {
    let s = ''; i = i + 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  /* 面向玩家的口语文案：坐标用「第r排第c列」，区块优先用颜色名（由调用方传入，
   * 来源 core.PALETTE 单一事实源），无颜色名时退回「X 色块」 */
  function makeNames(level, namesGiven) {
    if (namesGiven && namesGiven.length) return namesGiven;
    return null;
  }

  /* level: {size, regions, solution}; catsGiven/xsGiven: [[r,c],...]（0 基，玩家当前局面，可省略）
   * 返回 { solved, steps, cats } 或 { error, steps } */
  function analyze(level, catsGiven, xsGiven, namesGiven) {
    const n = level.size, g = level.regions;
    const names = makeNames(level, namesGiven);
    const nameOf = k => (names && names[k]) || (letter(k) + ' 色块');
    let K = 0; for (let i = 0; i < g.length; i++) if (g[i] + 1 > K) K = g[i] + 1;
    const sizes = new Array(K).fill(0);
    for (let i = 0; i < g.length; i++) sizes[g[i]]++;
    const regCells = Array.from({ length: K }, () => []);
    const rowCells = Array.from({ length: n }, () => []);
    const colCells = Array.from({ length: n }, () => []);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      regCells[g[r * n + c]].push([r, c]); rowCells[r].push([r, c]); colCells[c].push([r, c]);
    }
    const solRow = new Array(n).fill(-1);
    for (const rc of level.solution) solRow[rc[0]] = rc[1];

    const X = new Set(), C = new Set();
    (xsGiven || []).forEach(rc => X.add(rc[0] * n + rc[1]));
    (catsGiven || []).forEach(rc => C.add(rc[0] * n + rc[1]));
    const catRow = new Array(n).fill(false), catCol = new Array(n).fill(false), catReg = new Array(K).fill(false);
    const pending = [];
    C.forEach(i => pending.push([Math.floor(i / n), i % n]));
    for (const rc of catsGiven || []) { catRow[rc[0]] = true; catCol[rc[1]] = true; catReg[g[rc[0] * n + rc[1]]] = true; }

    const steps = [];
    const nm = (r, c) => '第' + (r + 1) + '排第' + (c + 1) + '列';

    function tryMark(marks, r, c) {
      const i = r * n + c;
      if (!C.has(i) && !X.has(i)) { X.add(i); marks.push([r, c]); }
    }
    function propagate() {
      while (pending.length) {
        const rc = pending.shift(), r = rc[0], c = rc[1];
        const marks = [];
        for (let cc = 0; cc < n; cc++) tryMark(marks, r, cc);
        for (let rr = 0; rr < n; rr++) tryMark(marks, rr, c);
        const rg = g[r * n + c];
        for (const cell of regCells[rg]) tryMark(marks, cell[0], cell[1]);
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n) tryMark(marks, rr, cc);
        }
        steps.push({ type: 'x', weight: 0, text: nm(r, c) + '住了一只猫 → 同排、同列、同一块' + nameOf(rg) + '、还有紧挨着它的格子都没有猫（' + marks.length + ' 格标 ✕）', cells: marks });
      }
    }
    function place(r, c, type, text) {
      const i = r * n + c;
      C.add(i); pending.push([r, c]);
      catRow[r] = true; catCol[c] = true; catReg[g[i]] = true;
      steps.push({ type: type, weight: WEIGHTS[type], text: text, cells: [[r, c]] });
    }
    const cand = cells => cells.filter(rc => { const i = rc[0] * n + rc[1]; return !C.has(i) && !X.has(i); });

    /* 子集排除（k=2..3）：返回是否取得排除进展（步骤已记录、X 已更新） */
    const subsetOnce = function () {
      const rowMask = new Array(K).fill(0), colMask = new Array(K).fill(0);
      const active = [];
      for (let k = 0; k < K; k++) {
        if (catReg[k]) continue;
        const cs = cand(regCells[k]);
        if (!cs.length) continue;
        active.push(k);
        for (const rc of cs) { rowMask[k] |= 1 << rc[0]; colMask[k] |= 1 << rc[1]; }
      }
      const pop = m => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };
      const tryDim = function (dim) {
        const mask = dim === 'row' ? rowMask : colMask;
        const lineName = dim === 'row' ? '行' : '列';
        const A = active;
        for (let a = 0; a < A.length; a++) for (let b = a + 1; b < A.length; b++) {
          for (let c3 = b + 1; c3 <= A.length; c3++) {
            const kset = c3 < A.length ? [A[a], A[b], A[c3]] : [A[a], A[b]];
            let um = 0;
            for (const k of kset) um |= mask[k];
            if (pop(um) !== kset.length) continue;
            const marks = [];
            for (let line = 0; line < n; line++) {
              if (!(um & (1 << line))) continue;
              if (dim === 'row' ? catRow[line] : catCol[line]) continue;
              for (const rc of (dim === 'row' ? rowCells[line] : colCells[line])) {
                if (kset.indexOf(g[rc[0] * n + rc[1]]) >= 0) continue;
                tryMark(marks, rc[0], rc[1]);
              }
            }
            if (marks.length) {
              const names = kset.map(letter).join('、');
              const lines = [];
              for (let l = 0; l < n; l++) if (um & (1 << l)) lines.push(l + 1);
              const names2 = kset.map(nameOf).join('、');
              steps.push({ type: 'subset', weight: WEIGHTS.subset, text: names2 + ' 这 ' + kset.length + ' 块的猫只能住第 ' + lines.join('、') + (dim === 'row' ? ' 排' : ' 列') + ' → 这几' + lineName + '的猫位被它们包了，其它色块在这里的 ' + marks.length + ' 格都没有猫', cells: marks });
              return true;
            }
          }
        }
        return false;
      };
      return tryDim('row') || tryDim('col');
    };

    /* 反证排除：候选格 x 假设有猫 → 传播 → 某行/列/区块候选空 → 矛盾 → x 必无猫 */
    const reductioOnce = function () {
      const Xv = (rr, cc) => X.has(rr * n + cc) || C.has(rr * n + cc);
      for (let r0 = 0; r0 < n; r0++) {
        if (catRow[r0]) continue;
        for (const rc of rowCells[r0]) {
          const i = rc[0] * n + rc[1];
          if (C.has(i) || X.has(i)) continue;
          const c0 = rc[1], k0 = g[i];
          const killed = (rr, cc) => rr === r0 || cc === c0 || g[rr * n + cc] === k0 || (Math.abs(rr - r0) <= 1 && Math.abs(cc - c0) <= 1);
          let why = null;
          for (let rr = 0; rr < n && !why; rr++) {
            if (catRow[rr] || rr === r0) continue;
            let alive = false;
            for (const t of rowCells[rr]) if (!killed(t[0], t[1]) && !Xv(t[0], t[1])) { alive = true; break; }
            if (!alive) why = '第 ' + (rr + 1) + ' 行';
          }
          for (let cc = 0; cc < n && !why; cc++) {
            if (catCol[cc] || cc === c0) continue;
            let alive = false;
            for (const t of colCells[cc]) if (!killed(t[0], t[1]) && !Xv(t[0], t[1])) { alive = true; break; }
            if (!alive) why = '第 ' + (cc + 1) + ' 列';
          }
          for (let k = 0; k < K && !why; k++) {
            if (catReg[k] || k === k0) continue;
            let alive = false;
            for (const t of regCells[k]) if (!killed(t[0], t[1]) && !Xv(t[0], t[1])) { alive = true; break; }
            if (!alive) why = '区块 ' + letter(k);
          }
          if (why) {
            steps.push({ type: 'reductio', weight: WEIGHTS.reductio, text: '假如 ' + nm(r0, c0) + ' 住猫，' + why + '就没有格子能住猫了（矛盾）→ 这格肯定没猫', cells: [[r0, c0]] });
            X.add(i);
            return true;
          }
        }
      }
      return false;
    };

    for (let iter = 0; iter < 5000; iter++) {
      propagate();
      if (C.size === n) {
        return { solved: true, steps: steps, cats: Array.from(C).map(i => [Math.floor(i / n), i % n]) };
      }
      /* 矛盾检测（对玩家局面：错放的猫或错标的 X）。
       * 恰好规则下：无猫区块若已无候选格 = 矛盾（每个区块都必须有一只猫）。 */
      for (let r = 0; r < n; r++) if (!catRow[r] && cand(rowCells[r]).length === 0)
        return { error: '第 ' + (r + 1) + ' 行已无可放猫的格子 —— 请检查已放的猫或 X 标记', steps: steps };
      for (let c = 0; c < n; c++) if (!catCol[c] && cand(colCells[c]).length === 0)
        return { error: '第 ' + (c + 1) + ' 列已无可放猫的格子 —— 请检查已放的猫或 X 标记', steps: steps };
      for (let k = 0; k < K; k++) if (!catReg[k] && cand(regCells[k]).length === 0)
        return { error: '区块 ' + letter(k) + ' 已无候选格 —— 请检查已放的猫或 X 标记', steps: steps };

      let acted = false, xProgress = false;

      /* 1. 单格区块强制 */
      for (let k = 0; k < K; k++) {
        if (sizes[k] === 1 && !catReg[k]) {
          const rc = regCells[k][0], i = rc[0] * n + rc[1];
          if (!X.has(i)) { place(rc[0], rc[1], 'forced', nameOf(k) + '色块只有' + nm(rc[0], rc[1]) + '这一格 → 猫必须住这儿'); acted = true; break; }
        }
      }
      /* 2. 行/列/区块唯一候选 */
      if (!acted) for (let r = 0; r < n; r++) if (!catRow[r]) {
        const cs = cand(rowCells[r]);
        if (cs.length === 1) { place(cs[0][0], cs[0][1], 'single', '第' + (r + 1) + '排能住猫的格子只剩 ' + nm(cs[0][0], cs[0][1])); acted = true; break; }
      }
      if (!acted) for (let c = 0; c < n; c++) if (!catCol[c]) {
        const cs = cand(colCells[c]);
        if (cs.length === 1) { place(cs[0][0], cs[0][1], 'single', '第' + (c + 1) + '列能住猫的格子只剩 ' + nm(cs[0][0], cs[0][1])); acted = true; break; }
      }
      if (!acted) for (let k = 0; k < K; k++) if (!catReg[k]) {
        const cs = cand(regCells[k]);
        if (cs.length === 1) { place(cs[0][0], cs[0][1], 'single', nameOf(k) + '色块能住猫的格子只剩 ' + nm(cs[0][0], cs[0][1])); acted = true; break; }
      }
      if (acted) continue;

      /* 3. 指向排除：区块候选 ⊆ 某行/列 → 该行/列其它格排除；行/列候选 ⊆ 某区块 → 区块其它格排除 */
      scan1:
      for (let k = 0; k < K; k++) {
        if (catReg[k]) continue;
        const cs = cand(regCells[k]); if (cs.length < 2) continue;
        const rowsSet = new Set(cs.map(rc => rc[0])), colsSet = new Set(cs.map(rc => rc[1]));
        if (rowsSet.size === 1) {
          const r0 = cs[0][0], marks = [];
          for (const rc of rowCells[r0]) if (g[rc[0] * n + rc[1]] !== k) tryMark(marks, rc[0], rc[1]);
          if (marks.length) { steps.push({ type: 'pointing', weight: 4, text: nameOf(k) + '色块的猫只能住第' + (r0 + 1) + '排 → 这排其它格子都没有猫', cells: marks }); xProgress = true; break scan1; }
        }
        if (colsSet.size === 1) {
          const c0 = cs[0][1], marks = [];
          for (const rc of colCells[c0]) if (g[rc[0] * n + rc[1]] !== k) tryMark(marks, rc[0], rc[1]);
          if (marks.length) { steps.push({ type: 'pointing', weight: 4, text: nameOf(k) + '色块的猫只能住第' + (c0 + 1) + '列 → 这列其它格子都没有猫', cells: marks }); xProgress = true; break scan1; }
        }
      }
      if (!xProgress) scan2:
      for (let r = 0; r < n; r++) {
        if (catRow[r]) continue;
        const cs = cand(rowCells[r]); if (cs.length < 2) continue;
        const regs = new Set(cs.map(rc => g[rc[0] * n + rc[1]]));
        if (regs.size === 1) {
          const k = cs[0][0] * 0 + g[cs[0][0] * n + cs[0][1]], marks = [];
          for (const rc of regCells[k]) if (rc[0] !== r) tryMark(marks, rc[0], rc[1]);
          if (marks.length) { steps.push({ type: 'pointing', weight: 4, text: '第' + (r + 1) + '排的猫只能住进' + nameOf(k) + '色块 → 这块的其它格子都没有猫', cells: marks }); xProgress = true; break scan2; }
        }
      }
      if (!xProgress) scan3:
      for (let c = 0; c < n; c++) {
        if (catCol[c]) continue;
        const cs = cand(colCells[c]); if (cs.length < 2) continue;
        const regs = new Set(cs.map(rc => g[rc[0] * n + rc[1]]));
        if (regs.size === 1) {
          const k = g[cs[0][0] * n + cs[0][1]], marks = [];
          for (const rc of regCells[k]) if (rc[1] !== c) tryMark(marks, rc[0], rc[1]);
          if (marks.length) { steps.push({ type: 'pointing', weight: 4, text: '第' + (c + 1) + '列的猫只能住进' + nameOf(k) + '色块 → 这块的其它格子都没有猫', cells: marks }); xProgress = true; break scan3; }
        }
      }
      if (xProgress) continue;

      /* 3.5 子集排除（Hall 子集，k=2..3）：k 个区块的候选只落在 k 行/列
       *    → 这些行/列的猫位必属这 k 个区块 → 其他区块在这些行/列上的候选格全排除 */
      if (subsetOnce()) continue;
      /* 3.6 反证排除：某候选格若有猫 → 某行/列/区块将无猫可放 → 矛盾 → 该格必无猫 */
      if (reductioOnce()) continue;

      /* 4. 基础逻辑不足 → 试错（借助已知解答选对分支） */
      let best = -1, bestLen = Infinity;
      for (let r = 0; r < n; r++) if (!catRow[r]) {
        const l = cand(rowCells[r]).length;
        if (l > 0 && l < bestLen) { bestLen = l; best = r; }
      }
      if (best < 0) return { error: '推理卡住：存在无候选的行', steps: steps };
      const c0 = solRow[best];
      if (c0 < 0 || X.has(best * n + c0)) return { error: '第 ' + (best + 1) + ' 行的答案格被标了 X —— 请检查 X 标记', steps: steps };
      place(best, c0, 'trial', '推理走不动了，需要大胆假设：第' + (best + 1) + '排的猫就住在 ' + nm(best, c0));
    }
    return { error: '推理迭代超限（异常）', steps: steps };
  }

  return { analyze: analyze, nextHint: nextHint, WEIGHTS: WEIGHTS, TYPE_LABEL: TYPE_LABEL };

  /* ---------- 结构化单步提示 ----------
   * 按类型优先级（由浅入深）给出当前局面的下一步：
   *   0 conflict   冲突提醒（行/列/区块双猫、八邻紧贴）
   *   1 x-prop     无猫区排除：已放猫的行/列/区块/紧贴 8 格还有未标 X 的
   *   2 forced     强制放猫：单格区块还没放猫
   *   3 row-single / col-single / region-single：唯一候选放猫
   *   4 point-*    指向排除：区块候选聚于一行/列 → 该行/列其它格；行/列候选聚于一块 → 该块其它格
   *   5 trial      试错假设（基础逻辑不足）
   * 返回 { solved, hint: { type, label, priority, action:'cat'|'x', text, cells } } 或 { error } */
  function nextHint(level, catsGiven, xsGiven, namesGiven) {
    const n = level.size, g = level.regions;
    const names = makeNames(level, namesGiven);
    const nameOf = k => (names && names[k]) || (letter(k) + ' 色块');
    const cats = catsGiven || [], xs = xsGiven || [];
    const catSet = new Set(cats.map(rc => rc[0] * n + rc[1]));
    const userX = new Set(xs.map(rc => rc[0] * n + rc[1]));
    const nm = (r, c) => '第' + (r + 1) + '排第' + (c + 1) + '列';

    /* 0. 冲突检测 */
    const rowHas = new Array(n).fill(false), colHas = new Array(n).fill(false);
    const regHas = new Map();
    for (const rc of cats) {
      const r = rc[0], c = rc[1], k = g[r * n + c];
      if (rowHas[r]) return { hint: { type: 'conflict', label: '有冲突', priority: 0, action: 'think', text: '第' + (r + 1) + '排已经有猫了 —— 先把多放的猫收回去', cells: cats.filter(x => x[0] === r) } };
      if (colHas[c]) return { hint: { type: 'conflict', label: '有冲突', priority: 0, action: 'think', text: '第' + (c + 1) + '列已经有猫了 —— 先把多放的猫收回去', cells: cats.filter(x => x[1] === c) } };
      if (regHas.get(k) !== undefined) return { hint: { type: 'conflict', label: '有冲突', priority: 0, action: 'think', text: '这块' + nameOf(k) + '已经有猫了 —— 先把多放的猫收回去', cells: cats.filter(x => g[x[0] * n + x[1]] === k) } };
      rowHas[r] = true; colHas[c] = true; regHas.set(k, true);
    }
    for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) {
      if (Math.abs(cats[i][0] - cats[j][0]) <= 1 && Math.abs(cats[i][1] - cats[j][1]) <= 1)
        return { hint: { type: 'conflict', label: '有冲突', priority: 0, action: 'think', text: nm(cats[i][0], cats[i][1]) + ' 和 ' + nm(cats[j][0], cats[j][1]) + ' 挨太近了 —— 猫不能贴着猫，收回一只', cells: [cats[i], cats[j]] } };
    }
    if (cats.length === n) return { solved: true, hint: null };

    /* 虚拟排除集：用户已标 X ∪ 已放猫传播（行/列/区块/8邻） */
    const vX = new Set(userX);
    for (const rc of cats) {
      const r = rc[0], c = rc[1], k = g[r * n + c];
      for (let cc = 0; cc < n; cc++) vX.add(r * n + cc);
      for (let rr = 0; rr < n; rr++) vX.add(rr * n + c);
      for (let i = 0; i < n * n; i++) if (g[i] === k) vX.add(i);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n) vX.add(rr * n + cc);
      }
    }
    const cand = i => !catSet.has(i) && !vX.has(i);

    /* 1. 无猫区排除：可由已放猫直接排除、但玩家还没标 X 的格子 */
    {
      const unmarked = [];
      for (const i of vX) if (!userX.has(i) && !catSet.has(i)) unmarked.push([Math.floor(i / n), i % n]);
      if (unmarked.length)
        return { hint: { type: 'x-prop', label: '无猫猫区排除', priority: 1, action: 'x', cells: unmarked.slice(0, 12), text: '猫已经放好了 ' + unmarked.length + ' 个格子：跟它同排、同列、同一色块、紧挨着的格子都不可能再有猫，标上 ✕', count: unmarked.length } };
    }

    /* 2. 强制放猫：单格区块 */
    {
      const sizes = new Map();
      for (let i = 0; i < n * n; i++) sizes.set(g[i], (sizes.get(g[i]) || 0) + 1);
      for (let i = 0; i < n * n; i++) {
        if (sizes.get(g[i]) === 1) {
          const r = Math.floor(i / n), c = i % n;
          if (!catSet.has(i) && !userX.has(i)) {
            const k = g[i];
            return { hint: { type: 'forced', label: '必须住这', priority: 2, action: 'cat', cells: [[r, c]], text: nameOf(k) + '色块只有' + nm(r, c) + '这一格，每块必须住一只猫 → 猫必须住这儿' } };
          }
        }
      }
    }

    const rowCells = [], colCells = [];
    for (let r = 0; r < n; r++) { rowCells[r] = []; for (let c = 0; c < n; c++) rowCells[r].push(r * n + c); }
    for (let c = 0; c < n; c++) { colCells[c] = []; for (let r = 0; r < n; r++) colCells[c].push(r * n + c); }
    let K = 0; for (let i = 0; i < n * n; i++) if (g[i] + 1 > K) K = g[i] + 1;
    const regCells = Array.from({ length: K }, () => []);
    for (let i = 0; i < n * n; i++) regCells[g[i]].push(i);

    /* 3. 唯一候选：行 / 列 / 区块 */
    for (let r = 0; r < n; r++) if (!rowHas[r]) {
      const cs = rowCells[r].filter(cand);
      if (cs.length === 1) return { hint: { type: 'row-single', label: '只剩这一格', priority: 3, action: 'cat', cells: [[Math.floor(cs[0] / n), cs[0] % n]], text: '第' + (r + 1) + '排排除来排除去，能住猫的只剩 ' + nm(Math.floor(cs[0] / n), cs[0] % n) } };
    }
    for (let c = 0; c < n; c++) if (!colHas[c]) {
      const cs = colCells[c].filter(cand);
      if (cs.length === 1) return { hint: { type: 'col-single', label: '只剩这一格', priority: 3, action: 'cat', cells: [[Math.floor(cs[0] / n), cs[0] % n]], text: '第' + (c + 1) + '列排除来排除去，能住猫的只剩 ' + nm(Math.floor(cs[0] / n), cs[0] % n) } };
    }
    for (let k = 0; k < K; k++) if (!regHas.has(k)) {
      const cs = regCells[k].filter(cand);
      if (cs.length === 1) return { hint: { type: 'region-single', label: '只剩这一格', priority: 3, action: 'cat', cells: [[Math.floor(cs[0] / n), cs[0] % n]], text: nameOf(k) + '色块排除来排除去，能住猫的只剩 ' + nm(Math.floor(cs[0] / n), cs[0] % n) } };
    }

    /* 4. 指向排除 */
    const unmarkedOnly = list => list.filter(i => !userX.has(i) && !catSet.has(i));
    const toRC = list => list.slice(0, 12).map(i => [Math.floor(i / n), i % n]);
    for (let k = 0; k < K; k++) {
      if (regHas.has(k)) continue;
      const cs = regCells[k].filter(cand);
      if (cs.length < 2) continue;
      const rows = new Set(cs.map(i => Math.floor(i / n))), cols = new Set(cs.map(i => i % n));
      if (rows.size === 1) {
        const r = Math.floor(cs[0] / n);
        const marks = unmarkedOnly(rowCells[r].filter(i => g[i] !== k));
        if (marks.length) return { hint: { type: 'point-row', label: '猫位锁定', priority: 4, action: 'x', cells: toRC(marks), text: nameOf(k) + '色块的猫只能住第' + (r + 1) + '排 → 这排剩下的 ' + marks.length + ' 格都没有猫，标 ✕', count: marks.length } };
      }
      if (cols.size === 1) {
        const c = cs[0] % n;
        const marks = unmarkedOnly(colCells[c].filter(i => g[i] !== k));
        if (marks.length) return { hint: { type: 'point-col', label: '猫位锁定', priority: 4, action: 'x', cells: toRC(marks), text: nameOf(k) + '色块的猫只能住第' + (c + 1) + '列 → 这列剩下的 ' + marks.length + ' 格都没有猫，标 ✕', count: marks.length } };
      }
    }
    for (let r = 0; r < n; r++) {
      if (rowHas[r]) continue;
      const cs = rowCells[r].filter(cand);
      if (cs.length < 2) continue;
      const regs = new Set(cs.map(i => g[i]));
      if (regs.size === 1) {
        const k = g[cs[0]];
        const marks = unmarkedOnly(regCells[k].filter(i => Math.floor(i / n) !== r));
        if (marks.length) return { hint: { type: 'point-region', label: '猫位锁定', priority: 4, action: 'x', cells: toRC(marks), text: '第' + (r + 1) + '排的猫只能住进' + nameOf(k) + '色块 → 这块剩下的 ' + marks.length + ' 格都没有猫，标 ✕', count: marks.length } };
      }
    }
    for (let c = 0; c < n; c++) {
      if (colHas[c]) continue;
      const cs = colCells[c].filter(cand);
      if (cs.length < 2) continue;
      const regs = new Set(cs.map(i => g[i]));
      if (regs.size === 1) {
        const k = g[cs[0]];
        const marks = unmarkedOnly(regCells[k].filter(i => i % n !== c));
        if (marks.length) return { hint: { type: 'point-region', label: '猫位锁定', priority: 4, action: 'x', cells: toRC(marks), text: '第' + (c + 1) + '列的猫只能住进' + nameOf(k) + '色块 → 这块剩下的 ' + marks.length + ' 格都没有猫，标 ✕', count: marks.length } };
      }
    }

    /* 4.5 子集排除（Hall 子集，k=2..3）：k 个区块候选只落在 k 行/列 → 猫位锁定 → 其他区块在此排除 */
    {
      const rowMask = new Array(K).fill(0), colMask = new Array(K).fill(0);
      const active = [];
      for (let k = 0; k < K; k++) {
        if (regHas.has(k)) continue;
        const cs = regCells[k].filter(cand);
        if (!cs.length) continue;
        active.push(k);
        for (const i of cs) { rowMask[k] |= 1 << Math.floor(i / n); colMask[k] |= 1 << (i % n); }
      }
      const pop = m => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };
      let hit = null;
      for (let dim = 0; dim < 2 && !hit; dim++) {
        const mask = dim === 0 ? rowMask : colMask;
        const lineName = dim === 0 ? '行' : '列';
        const A = active;
        for (let a = 0; a < A.length && !hit; a++) for (let b = a + 1; b < A.length && !hit; b++) {
          for (let c3 = b + 1; c3 <= A.length && !hit; c3++) {
            const kset = c3 < A.length ? [A[a], A[b], A[c3]] : [A[a], A[b]];
            let um = 0;
            for (const k of kset) um |= mask[k];
            if (pop(um) !== kset.length) continue;
            const marks = [];
            for (let line = 0; line < n; line++) {
              if (!(um & (1 << line))) continue;
              if (dim === 0 ? rowHas[line] : colHas[line]) continue;
              for (const i of (dim === 0 ? rowCells[line] : colCells[line])) {
                if (kset.indexOf(g[i]) >= 0) continue;
                if (!userX.has(i) && !catSet.has(i)) marks.push(i);
              }
            }
            if (marks.length) {
              const names = kset.map(letter).join('、');
              const lines = [];
              for (let l = 0; l < n; l++) if (um & (1 << l)) lines.push(l + 1);
              hit = { type: 'subset', label: '猫位锁定', priority: 4.5, action: 'x', cells: toRC(marks), text: kset.map(nameOf).join('、') + ' 这 ' + kset.length + ' 块的猫只能住第 ' + lines.join('、') + (dim === 0 ? ' 排' : ' 列') + ' → 这几' + lineName + '的猫位被它们包了，其它色块在这里的 ' + marks.length + ' 格都没有猫，标 ✕', count: marks.length };
            }
          }
        }
      }
      if (hit) return { hint: hit };
    }

    /* 4.6 反证排除：候选格若有猫 → 某行/列/区块将无猫可放 → 矛盾 → 该格必无猫 */
    {
      for (let r0 = 0; r0 < n; r0++) {
        if (rowHas[r0]) continue;
        for (const i of rowCells[r0]) {
          if (catSet.has(i) || vX.has(i) || userX.has(i)) continue; /* 已排除的无需反证 */
          const r = Math.floor(i / n), c0 = i % n, k0 = g[i];
          const killed = rr => { const rr2 = Math.floor(rr / n), cc2 = rr % n; return rr2 === r || cc2 === c0 || g[rr] === k0 || (Math.abs(rr2 - r) <= 1 && Math.abs(cc2 - c0) <= 1); };
          let why = null;
          for (let rr = 0; rr < n && !why; rr++) {
            if (rowHas[rr] || rr === r) continue;
            if (!rowCells[rr].some(t => !killed(t) && cand(t))) why = '第 ' + (rr + 1) + ' 行';
          }
          for (let cc = 0; cc < n && !why; cc++) {
            if (colHas[cc] || cc === c0) continue;
            if (!colCells[cc].some(t => !killed(t) && cand(t))) why = '第 ' + (cc + 1) + ' 列';
          }
          for (let k = 0; k < K && !why; k++) {
            if (regHas.has(k) || k === k0) continue;
            if (!regCells[k].some(t => !killed(t) && cand(t))) why = '区块 ' + letter(k);
          }
          if (why) {
            return { hint: { type: 'reductio', label: '这格没猫', priority: 4.6, action: 'x', cells: [[r, c0]], text: '假如 ' + nm(r, c0) + ' 住猫，' + why + '就没有格子能住猫了（矛盾）→ 这格肯定没猫，标 ✕' } };
          }
        }
      }
    }

    /* 5. 试错：基础逻辑不足，借助唯一解给假设方向 */
    {
      const solRow = new Array(n).fill(-1);
      for (const rc of level.solution) solRow[rc[0]] = rc[1];
      let best = -1, bestLen = Infinity;
      for (let r = 0; r < n; r++) if (!rowHas[r]) {
        const l = rowCells[r].filter(cand).length;
        if (l > 0 && l < bestLen) { bestLen = l; best = r; }
      }
      if (best < 0) return { error: '存在已无可放猫格子的行，请检查 X 标记或猫的位置' };
      const c0 = solRow[best];
      return { hint: { type: 'trial', label: '大胆假设', priority: 5, action: 'cat', cells: [[best, c0]], text: '推理走不动了，大胆假设：第' + (best + 1) + '排的猫就住在 ' + nm(best, c0) + '（这排只剩 ' + bestLen + ' 个格子可选）', count: bestLen } };
    }
  }
});
