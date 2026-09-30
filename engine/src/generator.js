/* 关卡生成器（Node CLI + web 生成器共用；小程序亦可加载）。
 * 浏览器/小程序加载方式：先加载 core.js、solver.js 再加载本文件（依赖注入回退到全局 CatChess）。
 * 规则语义：每个区块恰好一只猫 ⇒ 区块数 = n，每个区块由其猫格作种子生长而成。
 * 不变量（所有操作保持）：
 *   1. 区块总数恒为 n；2. 每个区块恰好含一只目标猫；3. 区块连通；
 *   4. 非猫格不允许单格区块（否则会强制在无猫处放猫，摧毁目标解）。
 * 唯一化双引擎：
 *   A. 边界移动（首选，不增加强制格）：把替代解的猫格 z 并入相邻且已含替代解另一只猫
 *      的区块 → 替代解「一区块两猫」被消灭；z 非目标猫格，目标解不受影响。
 *   B. 挖格（兜底）：把目标解猫格 p 挖成单格区块（强制放猫），原区块剩余部分并入邻块。
 * 生成结果恒满足：目标解合法、唯一解、区块连通、每区块恰好一猫。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.CatChess = root.CatChess || {}; Object.assign(root.CatChess, factory()); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 依赖解析：Node 走 require；浏览器（web/gen.html）无 require 时回退到 self 上已合并的全局 CatChess */
  const solver = typeof require === 'function' ? require('./solver') : self.CatChess;
  const core = typeof require === 'function' ? require('./core') : self.CatChess;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  function neighbors4(n, i) {
    const r = Math.floor(i / n), c = i % n;
    const out = [];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out;
  }

  /* 随机解：列排列，相邻行猫的列差 ≥ 2（八邻禁贴），随机序回溯 */
  function randomSolution(n, rng) {
    const cols = new Array(n).fill(-1), used = new Array(n).fill(false);
    let nodes = 0;
    function bt(r) {
      if (r === n) return true;
      if (++nodes > 200000) return false;
      const order = shuffle(Array.from({ length: n }, (_, i) => i), rng);
      for (let oi = 0; oi < n; oi++) {
        const c = order[oi];
        if (used[c]) continue;
        if (r > 0 && Math.abs(c - cols[r - 1]) < 2) continue;
        used[c] = true; cols[r] = c;
        if (bt(r + 1)) return true;
        used[c] = false; cols[r] = -1;
      }
      return false;
    }
    if (!bt(0)) return null;
    return cols.map((c, r) => [r, c]);
  }

  /* 消灭意外单格：非猫格的 1 格区块并入相邻区块（绝不并入猫格单格，防止解除已有强制约束）。
   * protectedCells: 猫格集合（其单格区块 = 有意强制，保留）。失败返回 false。 */
  function fixAccidentalSingletons(grid, n, protectedCells) {
    const N = n * n;
    for (let pass = 0; pass < N; pass++) {
      const sizeMap = new Map();
      for (let i = 0; i < N; i++) sizeMap.set(grid[i], (sizeMap.get(grid[i]) || 0) + 1);
      let target = -1;
      for (let i = 0; i < N; i++) if (sizeMap.get(grid[i]) === 1 && !protectedCells.has(i)) { target = i; break; }
      if (target < 0) return true; /* 已全部清除 */
      const nbrs = neighbors4(n, target);
      let merged = false;
      /* 首选：并入相邻的非单格区块 */
      for (const j of nbrs) {
        if (grid[j] !== grid[target] && sizeMap.get(grid[j]) > 1) { grid[target] = grid[j]; merged = true; break; }
      }
      /* 次选：与相邻的另一个意外单格合并成 2 格区块 */
      if (!merged) for (const j of nbrs) {
        if (grid[j] !== grid[target] && sizeMap.get(grid[j]) === 1 && !protectedCells.has(j)) { grid[j] = grid[target]; merged = true; break; }
      }
      if (!merged) return false; /* 四周全是受保护单格 → 无法修复 */
    }
    return false;
  }

  /* 把区块 oldId 的剩余格子按连通碎片并入相邻区块。
   * avoidId：优先不并入的区块（如刚挖出的单格，保住其强制约束）。
   * keepCell：若提供，包含该格（猫格）的碎片保留 oldId，其余碎片并入邻块
   *（边界移动后原区块剩余部分带猫，不能整块解散，否则并出双猫区块）。 */
  function mergeRegionRest(grid, n, oldId, avoidId, keepCell) {
    const kept = new Set();
    if (keepCell != null && grid[keepCell] === oldId) {
      /* 先算出 keepCell 所在碎片 */
      const comp = [keepCell]; kept.add(keepCell);
      for (let qi = 0; qi < comp.length; qi++) {
        for (const j of neighbors4(n, comp[qi])) {
          if (grid[j] === oldId && !kept.has(j)) { kept.add(j); comp.push(j); }
        }
      }
    }
    for (let guard = 0; guard < n * n; guard++) {
      let start = -1;
      for (let i = 0; i < n * n; i++) if (grid[i] === oldId && !kept.has(i)) { start = i; break; }
      if (start < 0) return;
      const comp = [start]; const seen = new Set([start]);
      for (let qi = 0; qi < comp.length; qi++) {
        for (const j of neighbors4(n, comp[qi])) {
          if (grid[j] === oldId && !seen.has(j) && !kept.has(j)) { seen.add(j); comp.push(j); }
        }
      }
      let into1 = -1, into2 = -1;
      for (const i of comp) {
        for (const j of neighbors4(n, i)) {
          if (grid[j] !== oldId) {
            if (grid[j] !== avoidId) { into1 = grid[j]; break; }
            if (into2 < 0) into2 = grid[j];
          }
        }
        if (into1 >= 0) break;
      }
      const into = into1 >= 0 ? into1 : into2;
      if (into < 0) return; /* 孤立（理论不可达） */
      for (const i of comp) grid[i] = into;
    }
  }

  /* 区块编号压缩：合并/拆分会留下空洞与超大 id；求解器要求 id 连续（K = max+1 必须 = n）。
   * 返回压缩后的下一个可用 id。 */
  function compactIds(grid) {
    const remap = new Map();
    for (let i = 0; i < grid.length; i++) {
      if (!remap.has(grid[i])) remap.set(grid[i], remap.size);
      grid[i] = remap.get(grid[i]);
    }
    return remap.size;
  }

  const debug = { lastFail: '' };

  /* opts: { size, seed, forcedWish(强制单格数), horizBias(水平生长偏置 0~0.95), tighten(收紧大区块),
   *        tightenMin/tightenMax(收紧保留格数，默认 2~3；min 钳制 ≥2，避免收紧出单格猫区块) }
   * 返回 level（无 name/difficulty，由 CLI 补充）或 null（形状不佳，换种子重试） */
  function generate(opts) {
    debug.lastFail = '';
    const n = opts.size, rng = mulberry32(opts.seed >>> 0);
    const sol = randomSolution(n, rng);
    if (!sol) { debug.lastFail = 'perm'; return null; }

    const catSet = new Set(sol.map(rc => rc[0] * n + rc[1]));
    const shuffledCats = shuffle(sol.slice(), rng);
    const forcedWish = Math.max(0, Math.min(n - 1, opts.forcedWish | 0));
    const forcedSet = new Set(shuffledCats.slice(0, forcedWish).map(rc => rc[0] * n + rc[1]));

    /* 种子：全部猫格（forcedSet 保持单格，其余生长）——区块数恰为 n */
    let nextId = 0;
    const grid = new Array(n * n).fill(-1);
    for (const rc of sol) grid[rc[0] * n + rc[1]] = nextId++;
    const horizBias = Math.max(0, Math.min(0.95, opts.horizBias == null ? 0.5 : opts.horizBias));

    /* 先占 pass：非强制种子先各占 1 个空闲邻格（保证非强制区块 ≥2 格） */
    const growSeeds = [];
    for (let i = 0; i < n * n; i++) if (grid[i] >= 0 && !forcedSet.has(i)) growSeeds.push(i);
    shuffle(growSeeds, rng);
    for (const i of growSeeds) {
      for (const j of shuffle(neighbors4(n, i), rng)) {
        if (grid[j] === -1) { grid[j] = grid[i]; break; }
      }
    }

    /* 随机多源生长（水平偏置：条状区块钉住行，收紧解空间） */
    const queue = [];
    for (let i = 0; i < n * n; i++) if (grid[i] >= 0) queue.push(i);
    shuffle(queue, rng);
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi], id = grid[i], r = Math.floor(i / n), c = i % n;
      const h = shuffle([[r, c - 1], [r, c + 1]].filter(nb => nb[1] >= 0 && nb[1] < n).map(nb => nb[0] * n + nb[1]), rng);
      const v = shuffle([[r - 1, c], [r + 1, c]].filter(nb => nb[0] >= 0 && nb[0] < n).map(nb => nb[0] * n + nb[1]), rng);
      const nbrs = rng() < horizBias ? h.concat(v) : v.concat(h);
      for (const j of nbrs) {
        if (grid[j] === -1) { grid[j] = id; queue.push(j); }
      }
    }
    if (grid.indexOf(-1) >= 0) { debug.lastFail = 'unfilled'; return null; }

    /* 收紧 pass：把过大的猫区块裁小，剩余部分并入邻块（保持每区块恰一猫）。
     * 保留格数 = tightenMin ~ tightenMax（高阶大棋盘用大值，减少 1~4 格碎区块）。 */
    if (opts.tighten) {
      const tmn = Math.max(2, opts.tightenMin == null ? 2 : opts.tightenMin | 0);
      const tmx = Math.max(tmn, opts.tightenMax == null ? tmn + 1 : opts.tightenMax | 0);
      for (const rc of shuffle(sol.slice(), rng)) {
        const i0 = rc[0] * n + rc[1];
        if (forcedSet.has(i0)) continue;
        const R = grid[i0];
        let rSize = 0;
        for (let i = 0; i < n * n; i++) if (grid[i] === R) rSize++;
        if (rSize <= 4) continue;
        const take = tmn + (rng() < 0.5 ? tmx - tmn : 0);
        const A = new Set([i0]); const q = [i0];
        while (A.size < take && q.length) {
          const cur = q.shift();
          for (const j of shuffle(neighbors4(n, cur), rng)) {
            if (grid[j] === R && !A.has(j)) { A.add(j); q.push(j); if (A.size >= take) break; }
          }
        }
        const newId = nextId++;
        A.forEach(j => { grid[j] = newId; });
        mergeRegionRest(grid, n, R, newId);
      }
      nextId = compactIds(grid);
    }
    if (!fixAccidentalSingletons(grid, n, catSet)) { debug.lastFail = 'accidental1'; return null; }

    /* 枚举带重试：随机候选序偶尔钻死子树 → 快速低上限换种子重试，末次放宽 */
    let solveCalls = 0;
    const solveEnum = function () {
      let lastErr = null;
      for (let t = 0; t < 4; t++) {
        try {
          const seed = (opts.seed + (solveCalls++) * 2654435761 + t * 7919) >>> 0;
          const cap = t === 3 ? 3e7 : 3e6;
          return t % 2 === 0 ? solver.solve({ size: n, regions: grid }, 2, { shuffleSeed: seed, nodeCap: cap })
            : solver.solve({ size: n, regions: grid }, 2, { nodeCap: cap });
        } catch (e) { lastErr = e; }
      }
      throw lastErr;
    };

    const target = sol.slice().sort((a, b) => a[0] - b[0]);
    const targetSet = new Set(target.map(rc => rc[0] * n + rc[1]));
    let ops = 0;
    let carves = 0;
    /* 挖格预算与强制格期望挂钩：每挖一格 +1 强制格；超预算说明该种子形状与
     * 目标难度不匹配 → 快速失败换种子（大幅减少大棋盘废尝试耗时） */
    const maxCarves = forcedWish + 4;
    const maxOps = 5 * n + 30;
    const t0 = Date.now();

    /* 边界移动：把替代解猫格 z（非目标猫格）并入相邻且已含替代解另一只猫的区块 */
    const tryBorderMove = function (alt, minR1Size) {
      const altCells = alt.map(rc => rc[0] * n + rc[1]);
      const order = shuffle(altCells.slice(), rng);
      const r1Size = new Map();
      for (let i = 0; i < n * n; i++) r1Size.set(grid[i], (r1Size.get(grid[i]) || 0) + 1);
      for (const z of order) {
        if (targetSet.has(z)) continue;
        const R1 = grid[z];
        if (r1Size.get(R1) < minR1Size) continue; /* 避免移走后 R1 变单格（第一轮） */
        /* R1 的目标猫格（移动后其碎片保留 R1 id） */
        let r1Cat = -1;
        for (const rc of target) { const i = rc[0] * n + rc[1]; if (grid[i] === R1) { r1Cat = i; break; } }
        for (const u of shuffle(neighbors4(n, z), rng)) {
          const R2 = grid[u];
          if (R2 === R1) continue;
          let altCatInR2 = false;
          for (const a of altCells) if (grid[a] === R2) { altCatInR2 = true; break; }
          if (!altCatInR2) continue;
          grid[z] = R2;
          mergeRegionRest(grid, n, R1, R2, r1Cat); /* R1 剩余碎片并入邻块（含猫碎片保留） */
          if (!fixAccidentalSingletons(grid, n, catSet)) { return false; }
          return true;
        }
      }
      return false;
    };

    /* 挖格：{p} 单格强制 + 原区块剩余部分并入邻块 */
    const tryCarve = function (pick) {
      const R = grid[pick[0] * n + pick[1]];
      const newId = nextId++;
      grid[pick[0] * n + pick[1]] = newId;
      mergeRegionRest(grid, n, R, newId);
      nextId = compactIds(grid);
      if (!fixAccidentalSingletons(grid, n, catSet)) { return false; }
      return true;
    };

    for (;;) {
      let res;
      try { res = solveEnum(); }
      catch (e) { debug.lastFail = 'solvecap'; return null; }
      if (res.count === 0) { debug.lastFail = 'count0'; return null; }
      if (res.count === 1) break;
      const alt = res.solutions.find(s => s.some((rc, r) => rc[1] !== target[r][1]));
      if (!alt) break;
      const diff = [];
      for (const rc of target) if (alt[rc[0]][1] !== rc[1]) diff.push(rc);
      if (!diff.length) { debug.lastFail = 'diff0'; return null; }
      if (++ops > maxOps) { debug.lastFail = 'opslimit'; return null; }
      if (Date.now() - t0 > 8000) { debug.lastFail = 'timeout'; return null; }

      if (tryBorderMove(alt, 3)) continue;
      if (tryBorderMove(alt, 2)) continue;

      /* 挖格兜底：目标行/列不能已有其它单格区块（避免一行/列两个强制格） */
      const sizeMap = new Map();
      for (let i = 0; i < n * n; i++) sizeMap.set(grid[i], (sizeMap.get(grid[i]) || 0) + 1);
      const busyRows = new Set(), busyCols = new Set();
      for (let i = 0; i < n * n; i++) {
        if (sizeMap.get(grid[i]) === 1 && catSet.has(i)) { busyRows.add(Math.floor(i / n)); busyCols.add(i % n); }
      }
      const pickable = diff.filter(rc => !busyRows.has(rc[0]) && !busyCols.has(rc[1]));
      if (!pickable.length) { debug.lastFail = 'nopick'; return null; }
      const pick = pickable[Math.floor(rng() * pickable.length)];
      if (!tryCarve(pick)) { debug.lastFail = 'carvefail'; return null; }
      if (++carves > maxCarves) { debug.lastFail = 'carvelimit'; return null; }
    }

    /* 防御校验：每区块恰好一只目标猫、区块数 = n */
    {
      const catCount = new Map();
      for (const rc of target) {
        const k = grid[rc[0] * n + rc[1]];
        catCount.set(k, (catCount.get(k) || 0) + 1);
      }
      const K = core.regionCount(grid);
      if (K !== n || catCount.size !== n || Array.from(catCount.values()).some(v => v !== 1)) {
        debug.lastFail = 'invariant'; return null;
      }
    }

    compactIds(grid);

    /* 汇总 */
    const K0 = core.regionCount(grid);
    const sizes = new Array(K0).fill(0);
    for (let i = 0; i < grid.length; i++) sizes[grid[i]]++;
    const forced = [];
    for (let i = 0; i < n * n; i++) if (sizes[grid[i]] === 1) forced.push([Math.floor(i / n), i % n]);

    return {
      size: n,
      regions: grid.slice(),
      solution: target.map(rc => [rc[0], rc[1]]),
      forced: forced.sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      regionColors: core.computeRegionColors(n, grid)
    };
  }

  /* ---------- 小区块权重（区块形态质量，与难度正交）----------
   * 逐区块惩罚 p(s) = max(0, 5-s)^2（凸型：1格=16、2格=9、3格=4、4格=1、≥5格=0，
   * 单点最重罚——1 个单格比 4 个 4 格块还差 4 倍）。
   * P = Σp(s)；pn = P/K 按区块数（=棋盘边长）归一，跨尺寸可比；
   * W = clamp(round(100 - 10·pn), 0, 100)，越高越好，全 ≥5 格区块 = 100。 */
  function regionPenalty(regions) {
    const K = Math.max.apply(null, regions) + 1;
    const sizes = new Array(K).fill(0);
    for (let i = 0; i < regions.length; i++) sizes[regions[i]]++;
    let P = 0;
    const c = [0, 0, 0, 0];
    for (let s = 0; s < K; s++) {
      const sz = sizes[s];
      if (sz >= 1 && sz <= 4) c[sz - 1]++;
      P += Math.max(0, 5 - sz) * Math.max(0, 5 - sz);
    }
    return { P: P, pn: Math.round(P / K * 100) / 100, c1: c[0], c2: c[1], c3: c[2], c4: c[3] };
  }
  function weightOf(regions) {
    const pen = regionPenalty(regions);
    return Math.max(0, Math.min(100, Math.round(100 - 10 * pen.pn)));
  }

  return { generate: generate, mulberry32: mulberry32, regionPenalty: regionPenalty, weightOf: weightOf, debug: debug };
});
