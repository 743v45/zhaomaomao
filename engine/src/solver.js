/* 猫棋求解器：枚举所有合法放置。
 * 规则：每行恰好 1 猫、每列恰好 1 猫、每个区块恰好 1 猫（⇒ 区块数 = 棋盘边长 n）、
 * 相邻行猫列差 ≥ 2（八邻禁贴）、单格区块即强制放猫（恰好规则的特例）。
 * 行列约束 ⇒ 猫的位置是一个列排列；八邻约束在行互异前提下只约束相邻行；
 * 区块恰好一猫 ⇒ n 只猫与 n 个区块双射。
 * UMD 三端通用；网页/小程序提示功能直接复用本求解器。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.CatChess = root.CatChess || {}; Object.assign(root.CatChess, factory()); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 返回 { count, solutions }：count 为解数（最多收集 maxSolutions 个即停），
   * 唯一解判定请用 solve(level, 2).count === 1。
   * opts.shuffleSeed：提供时按行确定性打乱候选列序（生成期枚举大量解时避免
   * 系统性钻入死子树，实测可将节点数从数十万/数千万降至数百）。
   * opts.nodeCap：节点上限（默认 3e7），超限抛错（capped=true）。 */
  function solve(level, maxSolutions, opts) {
    if (maxSolutions == null) maxSolutions = 2;
    const n = level.size, g = level.regions;
    let K = 0; for (let i = 0; i < g.length; i++) if (g[i] + 1 > K) K = g[i] + 1;
    if (K !== n) return { count: 0, solutions: [] }; /* 恰好一猫 ⇒ 区块数必须等于 n */

    const sizes = new Array(K).fill(0);
    const regMaxRow = new Array(K).fill(-1);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const k = g[r * n + c];
      sizes[k]++;
      if (r > regMaxRow[k]) regMaxRow[k] = r;
    }

    /* 每行的强制列（该行存在单格区块）；同行两个单格区块 ⇒ 直接无解 */
    const rowForced = new Array(n).fill(-1);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (sizes[g[r * n + c]] === 1) {
        if (rowForced[r] !== -1 && rowForced[r] !== c) return { count: 0, solutions: [] };
        rowForced[r] = c;
      }
    }

    /* 候选列序：默认升序；shuffleSeed 时按 prev 行确定性打乱 */
    let orders = null;
    if (opts && opts.shuffleSeed != null) {
      let s = (opts.shuffleSeed >>> 0) || 1;
      const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
      orders = [];
      for (let k = 0; k <= n; k++) {
        const arr = Array.from({ length: n }, (_, c) => c);
        for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
        orders.push(arr);
      }
    }

    const colUsed = new Array(n).fill(false), regUsed = new Array(K).fill(false);
    const cur = new Array(n).fill(-1);
    const solutions = [];
    let nodes = 0; const NODE_CAP = (opts && opts.nodeCap) || 3e7;

    (function dfs(r, prev) {
      if (solutions.length >= maxSolutions) return;
      if (r === n) { solutions.push(cur.map((c, rr) => [rr, c])); return; }
      if (++nodes > NODE_CAP) { const e = new Error('solver node cap exceeded'); e.capped = true; throw e; }
      /* 恰好一猫剪枝：未用区块的所有格子都在已过行 → 该区块永远无猫 → 剪枝 */
      for (let k = 0; k < K; k++) if (!regUsed[k] && regMaxRow[k] < r) return;

      if (rowForced[r] >= 0) {
        const c = rowForced[r];
        if (!colUsed[c] && !(prev >= 0 && Math.abs(c - prev) < 2) && !regUsed[g[r * n + c]]) {
          colUsed[c] = true; regUsed[g[r * n + c]] = true; cur[r] = c;
          dfs(r + 1, c);
          colUsed[c] = false; regUsed[g[r * n + c]] = false; cur[r] = -1;
        }
        return;
      }
      for (let ci = 0; ci < n; ci++) {
        const c = orders ? orders[prev + 1][ci] : ci;
        if (colUsed[c]) continue;
        if (prev >= 0 && Math.abs(c - prev) < 2) continue;
        const rg = g[r * n + c];
        if (regUsed[rg]) continue;
        colUsed[c] = true; regUsed[rg] = true; cur[r] = c;
        dfs(r + 1, c);
        colUsed[c] = false; regUsed[rg] = false; cur[r] = -1;
        if (solutions.length >= maxSolutions) return;
      }
    })(0, -1);

    return { count: solutions.length, solutions };
  }

  return { solve };
});
