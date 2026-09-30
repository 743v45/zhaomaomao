/* 猫棋 CLI：关卡生成 / 校验 / 文档 / 索引 / 双端构建 / 验收回写。
 * 所有关卡操作必须经本 CLI（沉淀为代码，不做会话内临时编排）。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEVELS_DIR = path.join(ROOT, 'levels');
const DOCS_DIR = path.join(ROOT, 'docs');
const LEVEL_DOCS_DIR = path.join(DOCS_DIR, 'levels');

const CatChess = {};
Object.assign(CatChess,
  require('./src/core'),
  require('./src/solver'),
  require('./src/hint'),
  require('./src/difficulty'),
  require('./src/generator'),
  require('./src/genconfig'),
  require('./src/names'));

/* ---------- 工具 ---------- */
function padId(id) { return 'L' + String(id).padStart(3, '0'); }
function levelFile(id) { return path.join(LEVELS_DIR, padId(id) + '.json'); }
function docFile(id) { return path.join(LEVEL_DOCS_DIR, padId(id) + '.md'); }
function ensureDirs() { [LEVELS_DIR, LEVEL_DOCS_DIR, path.join(DOCS_DIR, 'acceptance'), path.join(DOCS_DIR, 'screenshots')].forEach(d => fs.mkdirSync(d, { recursive: true })); }
function loadLevels() {
  if (!fs.existsSync(LEVELS_DIR)) return [];
  return fs.readdirSync(LEVELS_DIR).filter(f => /^L\d{3}\.json$/.test(f))
    .map(f => JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, f), 'utf8')))
    .sort((a, b) => a.id - b.id);
}
function levelHash(size, regions) { return size + '|' + regions.join(','); }
function targetOf(id) { return Math.round(8 + (id - 1) * (92 / 99)); }

/* ---------- 关卡规划：id → 尺寸（6×6 起步，20×20 收官） ---------- */
function buildPlan() {
  const levels = [];
  for (let id = 1; id <= 100; id++) {
    levels.push({ id: id, size: 6 + Math.floor((id - 1) * 14 / 99), target: targetOf(id) });
  }
  return { levels: levels };
}

/* ---------- 生成参数：单一来源 engine/src/genconfig.js（与 web 生成器共用） ---------- */
const paramSpace = CatChess.paramSpace;

/* ---------- 生成单关（≤ROUNDS 轮 × ATTEMPTS 次尝试，预算见 genconfig） ----------
 * size ≥ WEIGHT_MIN_SIZE（高阶）：难度带内候选按小区块权重 W 最高者入选，W ≥ W_ACCEPT 提前接受；
 * 小棋盘：维持首个带内即返回。 */
function genLevel(id, size, target, seedBase) {
  const others = loadLevels().filter(l => l.id !== id);
  const existing = new Set(others.filter(l => l.size === size).map(l => l.hash));
  const usedScores = new Set(others.map(l => l.difficulty)); /* 难度全局唯一 */
  const useWeight = size >= CatChess.WEIGHT_MIN_SIZE;
  const band = CatChess.DIFF_BAND;
  let best = null;
  for (let round = 0; round < CatChess.ROUNDS; round++) {
    for (let a = 0; a < CatChess.ATTEMPTS; a++) {
      const seed = (seedBase == null ? id * 7919 : seedBase) + round * 100003 + a * 7 + 1;
      const jr = CatChess.mulberry32(seed ^ 0x9E3779B9);
      const ps = paramSpace(size, target, jr);
      let level;
      try { level = CatChess.generate({ size: size, seed: seed, forcedWish: ps.forcedWish, horizBias: ps.horizBias, tighten: ps.tighten, tightenMin: ps.tightenMin, tightenMax: ps.tightenMax }); }
      catch (e) { continue; }
      if (!level) continue;
      const hash = levelHash(level.size, level.regions);
      if (existing.has(hash)) continue;
      const trace = CatChess.analyze(level);
      if (trace.error) continue;
      const sc = CatChess.score(level, trace);
      if (!process.env.ZMM_FAST && usedScores.has(sc.total)) continue; /* 撞分 → 换尝试（ZMM_FAST=1 时跳过该约束，用于补齐后再全局重校准） */
      const rec = { level: level, trace: trace, sc: sc, seed: seed, off: Math.abs(sc.total - target), W: CatChess.weightOf(level.regions) };
      if (rec.off <= band) {
        if (!useWeight) return rec;
        if (!best || best.off > band || rec.W > best.W) best = rec; /* 带内：留权重最高 */
        if (rec.W >= CatChess.W_ACCEPT) return rec;
        continue; /* 带内但权重未达标：继续找更优 */
      }
      if (!best || (best.off > band && rec.off < best.off)) best = rec; /* 带外：仅作兜底 */
    }
    if (best && best.off <= band && (!useWeight || best.W >= CatChess.W_ACCEPT)) return best;
  }
  return best; /* 可能不在带内，由 validate 兜底报告 */
}

function finalizeLevel(rec, id, target) {
  const l = rec.level;
  return {
    id: id,
    name: CatChess.levelName(id, l.size),
    size: l.size,
    regions: l.regions,
    regionColors: l.regionColors,
    solution: l.solution,
    forced: l.forced,
    regionsCount: CatChess.regionCount(l.regions),
    difficulty: rec.sc.total,
    difficultyTarget: target,
    difficultyDetail: rec.sc.detail,
    weight: CatChess.weightOf(l.regions),
    weightDetail: CatChess.regionPenalty(l.regions),
    seed: rec.seed,
    hash: levelHash(l.size, l.regions)
  };
}

/* ---------- 文档生成 ---------- */
function gridLetters(level) {
  const n = level.size, out = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(CatChess.regionLetter(level.regions[r * n + c]));
    out.push(row.join(' '));
  }
  return out.join('\n');
}
function gridSolution(level) {
  const n = level.size, set = new Set(level.solution.map(rc => rc[0] * n + rc[1])), out = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(set.has(r * n + c) ? '🐱' : '·');
    out.push(row.join(' '));
  }
  return out.join('\n');
}
function acceptSection(level, oldDoc) {
  const engineLine = '- [引擎] 唯一解=1 ✓ · 难度 ' + level.difficulty + '（目标 ' + level.difficultyTarget + '）· 解与配置一致 ✓ · 区块连通 ✓ · 强制格 ' + level.forced.length + ' ⊆ 解 ✓';
  const lines = [engineLine, '- [网页] 待验收'];
  if (oldDoc) {
    const m = oldDoc.match(/## 验收记录\n([\s\S]*?)(\n## |$)/);
    if (m) {
      const old = m[1].split('\n').filter(s => s.trim().startsWith('- ['));
      if (old.length) return old;
    }
  }
  return lines;
}
function docFor(level) {
  const old = fs.existsSync(docFile(level.id)) ? fs.readFileSync(docFile(level.id), 'utf8') : null;
  const trace = CatChess.analyze(level, [], [], level.regionColors.map(ci => CatChess.PALETTE[ci][1]));
  const steps = trace.steps.filter(s => s.type !== 'x').map((s, i) =>
    (i + 1) + '. 【' + CatChess.TYPE_LABEL[s.type] + '】' + s.text);
  const xlines = trace.steps.filter(s => s.type === 'x').length;
  const forcedLines = level.forced.map(rc => {
    const g = level.regions[rc[0] * level.size + rc[1]];
    const col = CatChess.PALETTE[level.regionColors[g]][1];
    return '- ' + CatChess.cellName(rc[0], rc[1]) + '（区块 ' + CatChess.regionLetter(g) + '，' + col + '，单格强制放猫）';
  });
  const wd = level.weightDetail || CatChess.regionPenalty(level.regions);
  return '# ' + padId(level.id) + ' · ' + level.name + ' · ' + level.size + '×' + level.size + ' · 难度 ' + level.difficulty + '/100\n' +
    '\n' +
    '> 目标难度 ' + level.difficultyTarget + '（带 ±4）· 色块 ' + level.regionsCount + ' · 强制格 ' + level.forced.length + ' · seed ' + level.seed + '\n' +
    '> 小区块权重 ' + (level.weight != null ? level.weight : CatChess.weightOf(level.regions)) + '/100（P=' + wd.P + '，1格×' + wd.c1 + ' 2格×' + wd.c2 + ' 3格×' + wd.c3 + ' 4格×' + wd.c4 + '，越高越整块）\n' +
    '\n' +
    '## 色块图（字母 = 区块）\n' +
    '\n' +
    '```\n' + gridLetters(level) + '\n```\n' +
    '\n' +
    '## 解答\n' +
    '\n' +
    '```\n' + gridSolution(level) + '\n```\n' +
    '\n' +
    '## 强制格（单格色块必须放猫）\n' +
    '\n' +
    (forcedLines.length ? forcedLines.join('\n') : '-（本关无单格强制区块）') + '\n' +
    '\n' +
    '## 提示链（推理过程：' + steps.length + ' 步推理 + ' + xlines + ' 步排除传播）\n' +
    '\n' +
    steps.join('\n') + '\n' +
    '\n' +
    '## 验收记录\n' +
    acceptSection(level, old).join('\n') + '\n';
}

/* ---------- 校验 ---------- */
function validateLevel(level) {
  const errs = [];
  const n = level.size, g = level.regions;
  if (!Array.isArray(g) || g.length !== n * n) errs.push('regions 尺寸不符');
  if (errs.length) return errs;
  const K = CatChess.regionCount(g);
  const sizes = new Array(K).fill(0);
  for (let i = 0; i < g.length; i++) sizes[g[i]]++;
  if (sizes.some(s => s === 0)) errs.push('区块编号不连续');
  /* 连通性 */
  for (let k = 0; k < K; k++) {
    const start = g.indexOf(k);
    const seen = new Set([start]), stack = [start];
    while (stack.length) {
      const i = stack.pop(), r = Math.floor(i / n), c = i % n;
      for (const nb of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        const j = nb[0] * n + nb[1];
        if (nb[0] >= 0 && nb[0] < n && nb[1] >= 0 && nb[1] < n && g[j] === k && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
    }
    if (seen.size !== sizes[k]) errs.push('区块 ' + CatChess.regionLetter(k) + ' 不连通');
  }
  /* 解合法 */
  const cats = level.solution;
  if (cats.length !== n) errs.push('解的数量 ≠ ' + n);
  if (CatChess.checkPlacement(level, cats).length) errs.push('解违反放置规则');
  const forcedCells = [];
  for (let i = 0; i < n * n; i++) if (sizes[g[i]] === 1) forcedCells.push([Math.floor(i / n), i % n]);
  const fk = a => a.map(rc => rc.join(',')).sort().join(';');
  if (fk(forcedCells) !== fk(level.forced || [])) errs.push('forced 字段与单格区块不一致');
  for (const rc of forcedCells) if (!cats.some(c => c[0] === rc[0] && c[1] === rc[1])) errs.push('存在未放猫的单格区块');
  /* 唯一解且与存储一致 */
  let res;
  try { res = CatChess.solve(level, 2); } catch (e) { errs.push('求解异常: ' + e.message); return errs; }
  if (res.count !== 1) errs.push('解数=' + res.count + '（必须唯一）');
  else if (fk(res.solutions[0]) !== fk(cats)) errs.push('唯一解与存储解不一致');
  /* 难度复算 */
  const trace = CatChess.analyze(level);
  if (trace.error) errs.push('提示链异常: ' + trace.error);
  else {
    const sc = CatChess.score(level, trace);
    if (Math.abs(sc.total - level.difficulty) > 1) errs.push('难度复算 ' + sc.total + ' ≠ 存储 ' + level.difficulty);
  }
  /* 权重复算（小区块权重与存储一致） */
  const wExp = CatChess.weightOf(g);
  if (level.weight !== wExp) errs.push('权重复算 ' + wExp + ' ≠ 存储 ' + level.weight);
  /* 颜色：同色必连通 ⇒ 恒等映射，长度 = 区块数，且不超过调色板 */
  const Kc = CatChess.regionCount(g);
  if (!Array.isArray(level.regionColors) || level.regionColors.length !== Kc)
    errs.push('regionColors 与区块数不一致');
  else {
    for (let i = 0; i < Kc; i++) if (level.regionColors[i] !== i) { errs.push('regionColors 非恒等（同色必连通规则）'); break; }
    if (Kc > CatChess.PALETTE.length) errs.push('区块数超过调色板（同色必连通无法满足）');
  }
  /* 文档 */
  if (!fs.existsSync(docFile(level.id))) errs.push('缺少文档 ' + padId(level.id) + '.md');
  return errs;
}

/* ---------- 命令 ---------- */
const cmd = process.argv[2];
const arg = k => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : undefined; };
ensureDirs();

if (cmd === 'plan') {
  fs.writeFileSync(path.join(LEVELS_DIR, 'plan.json'), JSON.stringify(buildPlan(), null, 2));
  console.log('levels/plan.json 已生成（100 关，6×6 → 20×20）');
}

else if (cmd === 'probe') {
  /* 难度校准探针：各尺寸若干样本的分数分布 */
  const sizes = (arg('sizes') || '6,8,10,12,15,18,20').split(',').map(Number);
  for (const n of sizes) {
    const rows = [];
    for (const hard of [0.1, 0.5, 0.95]) {
      const target = Math.round(hard * 100);
      for (let s = 0; s < 3; s++) {
        const seed = n * 131 + s * 977 + Math.round(hard * 1000);
        const jr = CatChess.mulberry32(seed);
        const ps = paramSpace(n, target, jr);
        let lv; try { lv = CatChess.generate({ size: n, seed: seed, forcedWish: ps.forcedWish, horizBias: ps.horizBias, tighten: ps.tighten }); } catch (e) { lv = null; }
        if (!lv) { rows.push('  size ' + n + ' target ' + target + ' -> 生成失败'); continue; }
        const tr = CatChess.analyze(lv);
        if (tr.error) { rows.push('  size ' + n + ' target ' + target + ' -> 推理异常 ' + tr.error); continue; }
        const sc = CatChess.score(lv, tr);
        rows.push('  size ' + String(n).padStart(2) + ' target ' + String(target).padStart(3) +
          ' -> 分数 ' + String(sc.total).padStart(3) + '  [size ' + sc.detail.sizePts + ' logic ' + sc.detail.logicPts +
          ' dens ' + sc.detail.densityPts + ' forced ' + sc.detail.forcedPts + ' | K=' + sc.detail.regions + ' F=' + sc.detail.forced + ' trials=' + sc.detail.trials + ']');
      }
    }
    console.log(rows.join('\n'));
  }
}

else if (cmd === 'gen') {
  const id = Number(arg('id'));
  const size = Number(arg('size'));
  const target = arg('target') != null ? Number(arg('target')) : targetOf(id);
  const seedBase = arg('seed') != null ? Number(arg('seed')) : null;
  if (!id || !size) { console.error('用法: gen --id N --size S [--target D] [--seed B]'); process.exit(1); }
  const t0 = Date.now();
  const rec = genLevel(id, size, target, seedBase);
  if (!rec) { console.error(padId(id) + ' 生成失败（3 轮重试后仍无可用关卡）'); process.exit(2); }
  const level = finalizeLevel(rec, id, target);
  fs.writeFileSync(levelFile(id), JSON.stringify(level, null, 1));
  fs.writeFileSync(docFile(id), docFor(level));
  console.log(padId(id) + ' ✓ ' + level.size + '×' + level.size + ' 难度 ' + level.difficulty + '/目标 ' + target +
    (rec.off > 4 ? '（带外 ' + rec.off + '）' : '') + ' 色块 ' + level.regionsCount + ' 强制 ' + level.forced.length +
    ' 权重 ' + level.weight + ' [' + (Date.now() - t0) + 'ms]');
}

else if (cmd === 'gen-batch') {
  const from = Number(arg('from')), to = Number(arg('to'));
  const plan = JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, 'plan.json'), 'utf8'));
  const ok = [], fail = [];
  for (const p of plan.levels) {
    if (p.id < from || p.id > to) continue;
    if (fs.existsSync(levelFile(p.id))) { ok.push(p.id + '(已有,跳过)'); continue; }
    const t0 = Date.now();
    const rec = genLevel(p.id, p.size, p.target, null);
    if (!rec) { fail.push(p.id); console.error(padId(p.id) + ' ✗ 生成失败'); continue; }
    const level = finalizeLevel(rec, p.id, p.target);
    fs.writeFileSync(levelFile(p.id), JSON.stringify(level, null, 1));
    fs.writeFileSync(docFile(p.id), docFor(level));
    console.log(padId(p.id) + ' ✓ ' + level.size + '×' + level.size + ' 难度 ' + level.difficulty + '/目标 ' + p.target +
      (rec.off > 4 ? '（带外 ' + rec.off + '）' : '') + ' 权重 ' + level.weight + ' [' + (Date.now() - t0) + 'ms]');
    ok.push(p.id);
  }
  console.log('\n批量完成: 成功 ' + ok.length + ' 失败 ' + fail.length + (fail.length ? ' -> ' + fail.join(',') : ''));
  if (fail.length) process.exit(2);
}

else if (cmd === 'recolor') {
  /* 颜色语义迁移：同色必连通 ⇒ 每区块独占一色（恒等映射），重写全部关卡并重建文档 */
  const levels = loadLevels();
  for (const l of levels) {
    const K = CatChess.regionCount(l.regions);
    l.regionColors = Array.from({ length: K }, (_, i) => i);
    fs.writeFileSync(levelFile(l.id), JSON.stringify(l, null, 1));
  }
  for (const l of loadLevels()) fs.writeFileSync(docFile(l.id), docFor(l));
  console.log('已重着色 ' + levels.length + ' 关（每区块独占一色，同色必连通）并重建文档');
}

else if (cmd === 'weight') {
  /* 小区块权重回填：全部关卡写入 weight/weightDetail 并重建文档（保留验收记录） */
  const levels = loadLevels();
  for (const l of levels) {
    l.weight = CatChess.weightOf(l.regions);
    l.weightDetail = CatChess.regionPenalty(l.regions);
    fs.writeFileSync(levelFile(l.id), JSON.stringify(l, null, 1));
  }
  for (const l of loadLevels()) fs.writeFileSync(docFile(l.id), docFor(l));
  console.log('已回填小区块权重 ' + levels.length + ' 关并重建文档（生成时 size≥12 自动按权重择优，W≥70 提前接受）');
}

else if (cmd === 'stats') {
  /* 小区块分布统计：每关明细 + 按尺寸汇总（QA 循环用）。
   * 用法: stats [--from A --to B] [--summary 仅汇总] */
  const levels = loadLevels();
  const from = arg('from') != null ? Number(arg('from')) : 0;
  const to = arg('to') != null ? Number(arg('to')) : 999;
  const sel = levels.filter(l => l.id >= from && l.id <= to);
  if (!process.argv.includes('--summary')) {
    for (const l of sel) {
      const wd = l.weightDetail || CatChess.regionPenalty(l.regions);
      const K = l.regionsCount;
      const small = wd.c1 + wd.c2 + wd.c3 + wd.c4;
      console.log(padId(l.id) + ' ' + l.size + '×' + l.size + ' 难度' + String(l.difficulty).padStart(3) +
        ' 权重' + String(l.weight != null ? l.weight : CatChess.weightOf(l.regions)).padStart(4) +
        ' P=' + String(wd.P).padStart(4) + ' pn=' + wd.pn.toFixed(2) +
        ' | 1格×' + wd.c1 + ' 2格×' + wd.c2 + ' 3格×' + wd.c3 + ' 4格×' + wd.c4 +
        ' | ≤4格 ' + small + '/' + K + ' (' + Math.round(100 * small / K) + '%)');
    }
  }
  const bySize = new Map();
  for (const l of sel) {
    const wd = l.weightDetail || CatChess.regionPenalty(l.regions);
    const K = l.regionsCount;
    const small = wd.c1 + wd.c2 + wd.c3 + wd.c4;
    if (!bySize.has(l.size)) bySize.set(l.size, { cnt: 0, W: 0, small: 0, K: 0, c1: 0, c2: 0, c3: 0, c4: 0 });
    const b = bySize.get(l.size);
    b.cnt++; b.W += (l.weight != null ? l.weight : CatChess.weightOf(l.regions));
    b.small += small; b.K += K; b.c1 += wd.c1; b.c2 += wd.c2; b.c3 += wd.c3; b.c4 += wd.c4;
  }
  console.log('\n== 按尺寸汇总（权重 = 100 - 10·P/K，全 ≥5 格区块为 100）==');
  console.log('size 关数  平均权重  1格  2格  3格  4格  ≤4格占比');
  for (const s of [...bySize.keys()].sort((a, b) => a - b)) {
    const b = bySize.get(s);
    console.log(String(s).padStart(4) + String(b.cnt).padStart(5) + '  ' + (b.W / b.cnt).toFixed(1).padStart(6) +
      String(b.c1).padStart(5) + String(b.c2).padStart(5) + String(b.c3).padStart(5) + String(b.c4).padStart(5) +
      '  ' + (100 * b.small / b.K).toFixed(1) + '%');
  }
}

else if (cmd === 'audit-hints') {
  /* 全量提示与数据结构审计（QA 循环用）：
   * 1) 地图数据结构完整（字段齐全、数组形状正确）；
   * 2) analyze 全链：空盘可渐进推导到终局，且推导猫位 = 存储解，步骤字段结构化（type/weight/text/cells）；
   * 3) nextHint 渐进跟随：从空盘逐步应用每条提示（cat → 放猫，x → 标 X）直到 solved，终局 isWin。 */
  const levels = loadLevels();
  const NEED = ['id', 'name', 'size', 'regions', 'regionColors', 'solution', 'forced', 'regionsCount',
    'difficulty', 'difficultyTarget', 'difficultyDetail', 'weight', 'weightDetail', 'seed', 'hash'];
  let bad = 0;
  const typeAgg = {}; let totalSteps = 0, maxSteps = 0, hintCalls = 0;
  for (const l of levels) {
    const errs = [];
    /* 1) 数据结构 */
    const missing = NEED.filter(k => l[k] === undefined);
    if (missing.length) errs.push('缺字段: ' + missing.join(','));
    if (!Array.isArray(l.regions) || l.regions.length !== l.size * l.size) errs.push('regions 形状错误');
    if (Array.isArray(l.solution) && l.solution.length !== l.size) errs.push('solution 长度 ≠ n');
    if (!Array.isArray(l.weightDetail) && typeof l.weightDetail !== 'object') errs.push('weightDetail 非对象');
    /* 2) analyze 全链 */
    const tr = CatChess.analyze(l);
    if (tr.error || !tr.solved) errs.push('analyze 未解出: ' + (tr.error || '未到终局'));
    else {
      const a = tr.cats.map(c => c.join(',')).sort().join(';');
      const b = l.solution.map(c => c.join(',')).sort().join(';');
      if (a !== b) errs.push('analyze 推导猫位 ≠ 解');
      for (const st of tr.steps) {
        if (!(st.type in CatChess.TYPE_LABEL) || typeof st.text !== 'string' || !Array.isArray(st.cells) || typeof st.weight !== 'number') {
          errs.push('步骤结构缺失: ' + JSON.stringify(st).slice(0, 80)); break;
        }
        typeAgg[st.type] = (typeAgg[st.type] || 0) + 1; totalSteps++;
      }
      maxSteps = Math.max(maxSteps, tr.steps.length);
    }
    /* 3) nextHint 渐进跟随 */
    if (!errs.length) {
      const cats = [], xs = [];
      let guard = 0, done = false;
      while (guard++ < l.size * l.size * 6) {
        const res = CatChess.nextHint(l, cats, xs);
        if (res.error) { errs.push('nextHint 出错: ' + res.error); break; }
        if (res.solved) { done = true; break; }
        const h = res.hint;
        if (!h || !h.type || !h.action || !Array.isArray(h.cells) || !h.cells.length ||
            typeof h.text !== 'string' || typeof h.priority !== 'number') {
          errs.push('提示结构缺失: ' + JSON.stringify(h).slice(0, 80)); break;
        }
        hintCalls++;
        if (h.action === 'cat') cats.push(h.cells[0]);
        else if (h.action === 'x') for (const rc of h.cells) xs.push(rc);
        else { errs.push('未预期 action: ' + h.action); break; }
      }
      if (!done && !errs.length) errs.push('nextHint 循环超限');
      if (done && !CatChess.isWin(l, cats)) errs.push('跟随提示未通关');
    }
    if (errs.length) { bad++; console.log(padId(l.id) + ' ✗ ' + errs.join('；')); }
  }
  console.log('\n推理步骤分布: ' + Object.keys(typeAgg).map(k => CatChess.TYPE_LABEL[k] + '×' + typeAgg[k]).join(' · '));
  console.log('共 ' + levels.length + ' 关 · analyze 总步骤 ' + totalSteps + '（单关最多 ' + maxSteps +
    '）· nextHint 引导 ' + hintCalls + ' 次 · 数据/提示结构问题 ' + bad);
  process.exit(bad ? 1 : 0);
}

else if (cmd === 'recalibrate') {
  /* 全局难度仿射重校准（一次性迁移）：
   * 1) raw(=尺寸分+逻辑分+强制格分) 重复的关卡重生成（保证仿射可分）；
   * 2) 搜索仿射参数 (a,b)：映射后 100 个分数全不重复、范围尽量宽且封顶 ≤99；
   * 3) 把常数写死进 difficulty.js（引擎自包含，双端一致）；
   * 4) 重算全部关卡难度并重建文档。 */
  const plan = JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, 'plan.json'), 'utf8'));
  const rawOf = l => Math.round((l.difficultyDetail.sizePts + l.difficultyDetail.logicPts + l.difficultyDetail.forcedPts) * 100) / 100;
  let levels = loadLevels();
  /* 第 0 步：按当前引擎（含全部推理规则）重算每关 difficultyDetail，
   * 保证校准表锚点与最终复算使用同一套规则（否则规则升级后 raw 错位导致撞分） */
  for (const l of levels) {
    const sc = CatChess.score(l, CatChess.analyze(l));
    l.difficultyDetail = sc.detail;
    l.difficulty = sc.total;
    fs.writeFileSync(levelFile(l.id), JSON.stringify(l, null, 1));
  }
  levels = loadLevels();
  for (let attempt = 0; attempt < 8; attempt++) {
    const byRaw = new Map();
    levels.forEach(l => { const r = rawOf(l); if (!byRaw.has(r)) byRaw.set(r, []); byRaw.get(r).push(l); });
    const dups = [...byRaw.entries()].filter(e => e[1].length > 1);
    if (!dups.length) break;
    process.env.ZMM_FAST = '1'; /* 去重阶段不限制撞分（校准表负责全局唯一） */
    for (const e of dups) for (const l of e[1].slice(1)) {
      const p = plan.levels.find(x => x.id === l.id);
      /* 保留组内第一个，其余重生成到 raw 不再撞为止（换 seedBase 多次尝试） */
      const taken = new Set(levels.filter(x => x.id !== l.id).map(rawOf));
      let done = false;
      for (let t = 0; t < 12 && !done; t++) {
        const rec = genLevel(l.id, p.size, p.target, l.id * 7919 + attempt * 99991 + t * 104729);
        if (!rec) continue;
        const lv = finalizeLevel(rec, l.id, p.target);
        if (taken.has(rawOf(lv))) continue;
        fs.writeFileSync(levelFile(l.id), JSON.stringify(lv, null, 1));
        fs.writeFileSync(docFile(l.id), docFor(lv));
        console.log('raw=' + e[0] + ' 重复，' + padId(l.id) + ' → 新 raw=' + rawOf(lv));
        done = true;
      }
      if (!done) { delete process.env.ZMM_FAST; console.error(padId(l.id) + ' 去重重生成失败'); process.exit(2); }
      levels = loadLevels();
    }
    delete process.env.ZMM_FAST;
  }
  const raws = levels.map(rawOf).sort((a, b) => a - b);
  console.log('raw 范围: ' + raws[0] + ' ~ ' + raws[raws.length - 1] + '（' + raws.length + ' 关，全序唯一）');
  /* 单调分段校准：按 raw 全序排名映射到 1..100（100 关恰好占满 1~100 分）。
   * 表烘焙进 difficulty.js（引擎自包含、双端复算一致、新关卡走线性插值）。 */
  const knots = raws.map((r, i) => [r, i + 1]);
  /* 整文件模板重写 difficulty.js（不做字符串拼接手术，避免拼接错位） */
  const dp = path.join(ROOT, 'engine', 'src', 'difficulty.js');
  const calSrc = '/* 难度打分（1~100）：尺寸分 + 逻辑分 + 强制格分 → 单调校准表。\n' +
    ' * score(level, trace) 的 trace 来自 hint.analyze（同一份推理链，保证打分与提示一致）。\n' +
    ' * 本文件由 `node engine/cli.js recalibrate` 整体生成——校准表为 100 关 raw 全序排名 → 1..100；\n' +
    ' * 手工修改会被下次 recalibrate 覆盖。UMD 三端通用。 */\n' +
    '(function (root, factory) {\n' +
    "  if (typeof module !== 'undefined' && module.exports) module.exports = factory();\n" +
    '  else { root.CatChess = root.CatChess || {}; Object.assign(root.CatChess, factory()); }\n' +
    '})(typeof self !== \'undefined\' ? self : this, function () {\n' +
    "  'use strict';\n" +
    '\n' +
    '  const r2 = v => Math.round(v * 100) / 100;\n' +
    '  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));\n' +
    '\n' +
    '  /* 校准表（recalibrate 烘焙）：raw 全序 → 1..100，单调分段线性插值 */\n' +
    '  const CAL_RAW = [' + raws.map(r => Math.round(r * 100) / 100).join(',') + '];\n' +
    '  const CAL_SCORE = [' + raws.map((r, i) => i + 1).join(',') + '];\n' +
    '  function calibrate(raw) {\n' +
    '    if (raw <= CAL_RAW[0]) return CAL_SCORE[0];\n' +
    '    const last = CAL_RAW.length - 1;\n' +
    '    if (raw >= CAL_RAW[last]) return CAL_SCORE[last];\n' +
    '    let lo = 0, hi = last;\n' +
    '    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (CAL_RAW[mid] <= raw) lo = mid; else hi = mid; }\n' +
    '    if (CAL_RAW[lo] === raw) return CAL_SCORE[lo];\n' +
    '    const t = (raw - CAL_RAW[lo]) / (CAL_RAW[hi] - CAL_RAW[lo]);\n' +
    '    return Math.round(CAL_SCORE[lo] + t * (CAL_SCORE[hi] - CAL_SCORE[lo]));\n' +
    '  }\n' +
    '\n' +
    '  function score(level, trace) {\n' +
    '    const n = level.size, regions = level.regions;\n' +
    '    const steps = (trace && trace.steps) || [];\n' +
    '    const wsum = steps.reduce((s, st) => s + (st.weight || 0), 0);\n' +
    '    const trials = steps.filter(st => st.type === \'trial\').length;\n' +
    '\n' +
    '    let K = 0; for (let i = 0; i < regions.length; i++) if (regions[i] + 1 > K) K = regions[i] + 1;\n' +
    '    let forced = 0; {\n' +
    '      const sizes = new Array(K).fill(0);\n' +
    '      for (let i = 0; i < regions.length; i++) sizes[regions[i]]++;\n' +
    '      forced = sizes.filter(s => s === 1).length;\n' +
    '    }\n' +
    '\n' +
    '    const sizePts = ((n - 6) / 14) * 38;                                    // 0 ~ 38（6x6 → 20x20）\n' +
    '    const wavg = wsum / n;                                                   // 平均每只猫的推理权重\n' +
    '    const logicPts = Math.max(0, Math.min(1, (wavg - 1.5) / 4.5)) * 38 + 4;  // 4 ~ 42（推理链加权）\n' +
    '    const forcedPts = (1 - Math.min(1, (forced * 2) / n)) * 8;               // 0 ~ 8（强制格越多越容易）\n' +
    '\n' +
    '    const raw = sizePts + logicPts + forcedPts;\n' +
    '    const total = clamp(calibrate(raw), 1, 100);\n' +
    '    return {\n' +
    '      total: total,\n' +
    '      raw: r2(raw),\n' +
    '      detail: { sizePts: r2(sizePts), logicPts: r2(logicPts), forcedPts: r2(forcedPts), wsum: wsum, trials: trials, regions: K, forced: forced }\n' +
    '    };\n' +
    '  }\n' +
    '\n' +
    '  return { score: score };\n' +
    '});\n';
  fs.writeFileSync(dp, calSrc);
  console.log('已烘焙校准表（' + knots.length + ' 个锚点，整文件重写）');
  delete require.cache[require.resolve('./src/difficulty')];
  Object.assign(CatChess, require('./src/difficulty'));
  /* 重算全部关卡 */
  for (const l of loadLevels()) {
    const trace = CatChess.analyze(l);
    const sc = CatChess.score(l, trace);
    l.difficulty = sc.total;
    l.difficultyDetail = sc.detail;
    fs.writeFileSync(levelFile(l.id), JSON.stringify(l, null, 1));
    fs.writeFileSync(docFile(l.id), docFor(l));
  }
  console.log('已按新标尺重算 ' + levels.length + ' 关并重建文档');
}

else if (cmd === 'fix-dup') {
  /* 难度撞分清理：每组保留最贴目标者，其余删除并重生成（genLevel 已带全局难度去重） */
  const levels = loadLevels();
  const byDiff = new Map();
  for (const l of levels) {
    if (!byDiff.has(l.difficulty)) byDiff.set(l.difficulty, []);
    byDiff.get(l.difficulty).push(l);
  }
  const toRegen = [];
  for (const [d, group] of byDiff) {
    if (group.length < 2) continue;
    group.sort((a, b) => Math.abs(a.difficulty - a.difficultyTarget) - Math.abs(b.difficulty - b.difficultyTarget) || a.id - b.id);
    for (const l of group.slice(1)) toRegen.push(l);
  }
  if (!toRegen.length) { console.log('无难度撞分'); process.exit(0); }
  for (const l of toRegen) {
    fs.unlinkSync(levelFile(l.id));
    console.log('删除撞分关卡 ' + padId(l.id) + '（难度 ' + l.difficulty + '）→ 重生成');
  }
  toRegen.sort((a, b) => a.id - b.id);
  const plan = JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, 'plan.json'), 'utf8'));
  const fails = [];
  for (const l of toRegen) {
    const p = plan.levels.find(x => x.id === l.id);
    const rec = genLevel(l.id, p.size, p.target, null);
    if (!rec) { fails.push(l.id); console.error(padId(l.id) + ' ✗ 重生成失败'); continue; }
    const level = finalizeLevel(rec, l.id, p.target);
    fs.writeFileSync(levelFile(l.id), JSON.stringify(level, null, 1));
    fs.writeFileSync(docFile(l.id), docFor(level));
    console.log(padId(l.id) + ' ✓ 新难度 ' + level.difficulty + '/目标 ' + p.target + (rec.off > 5 ? '（带外 ' + rec.off + '）' : ''));
  }
  if (fails.length) { console.log('失败: ' + fails.join(',')); process.exit(2); }
}

else if (cmd === 'validate') {
  const levels = loadLevels();
  const scope = arg('ids'); /* "5-20" 或 --all */
  let bad = 0;
  for (const l of levels) {
    if (scope && scope !== '--all' && scope !== 'all') {
      const [a, b] = scope.split('-').map(Number);
      if (l.id < a || l.id > b) continue;
    }
    const errs = validateLevel(l);
    if (errs.length) { bad++; console.log(padId(l.id) + ' ✗ ' + errs.join('；')); }
    else console.log(padId(l.id) + ' ✓ 难度 ' + l.difficulty + ' · ' + l.size + '×' + l.size + ' · 色块 ' + l.regionsCount);
  }
  /* 全局：难度唯一、哈希查重 */
  const byDiff = new Map(), byHash = new Map();
  for (const l of levels) {
    if (!byDiff.has(l.difficulty)) byDiff.set(l.difficulty, []);
    byDiff.get(l.difficulty).push(l.id);
    if (!byHash.has(l.hash)) byHash.set(l.hash, []);
    byHash.get(l.hash).push(l.id);
  }
  const dupD = [...byDiff.entries()].filter(([, v]) => v.length > 1);
  const dupH = [...byHash.entries()].filter(([, v]) => v.length > 1);
  if (dupD.length) { bad++; console.log('难度重复: ' + dupD.map(([d, v]) => d + '分→' + v.join(',')).join('；')); }
  if (dupH.length) { bad++; console.log('关卡重复(哈希): ' + dupH.map(([, v]) => v.join(',')).join('；')); }
  console.log('\n共 ' + levels.length + ' 关 · 单关问题 ' + bad + (dupD.length ? ' · 难度重复 ' + dupD.length : '') + (dupH.length ? ' · 关卡重复 ' + dupH.length : ''));
  if (levels.length !== 100) console.log('警告: 当前 ' + levels.length + '/100 关');
  process.exit(bad ? 1 : 0);
}

else if (cmd === 'doc') {
  const id = Number(arg('id'));
  const level = JSON.parse(fs.readFileSync(levelFile(id), 'utf8'));
  fs.writeFileSync(docFile(id), docFor(level));
  console.log(docFile(id) + ' 已更新');
}

else if (cmd === 'docs') {
  for (const l of loadLevels()) fs.writeFileSync(docFile(l.id), docFor(l));
  console.log('全部关卡文档已重新生成');
}

else if (cmd === 'index') {
  const levels = loadLevels();
  const lines = ['# 关卡总览（' + levels.length + ' 关）', '',
    '| # | 名称 | 规格 | 色块 | 强制格 | 难度 | 权重 | 网页验收 |',
    '|---|------|------|------|--------|------|------|----------|'];
  for (const l of levels) {
    let acc = '待验收';
    if (fs.existsSync(docFile(l.id))) {
      const md = fs.readFileSync(docFile(l.id), 'utf8');
      const m = md.match(/- \[网页\] (.*)/);
      if (m) acc = m[1].startsWith('通过') ? '✅ ' + m[1] : m[1];
    }
    lines.push('| ' + l.id + ' | [' + l.name + '](levels/' + padId(l.id) + '.md) | ' + l.size + '×' + l.size + ' | ' + l.regionsCount + ' | ' + l.forced.length + ' | ' + l.difficulty + ' | ' + (l.weight != null ? l.weight : CatChess.weightOf(l.regions)) + ' | ' + acc + ' |');
  }
  fs.writeFileSync(path.join(DOCS_DIR, 'LEVEL_INDEX.md'), lines.join('\n') + '\n');
  console.log('docs/LEVEL_INDEX.md 已生成（' + levels.length + ' 关）');
}

else if (cmd === 'trace') {
  const id = Number(arg('id'));
  const level = JSON.parse(fs.readFileSync(levelFile(id), 'utf8'));
  const tr = CatChess.analyze(level, [], [], level.regionColors.map(ci => CatChess.PALETTE[ci][1]));
  if (tr.error) { console.log('错误: ' + tr.error); process.exit(1); }
  tr.steps.forEach((s, i) => console.log(String(i + 1).padStart(3) + '. 【' + CatChess.TYPE_LABEL[s.type] + '】' + s.text));
}

else if (cmd === 'build') {
  const levels = loadLevels();
  if (!levels.length) { console.error('无关卡可构建'); process.exit(1); }
  /* 网页数据 */
  fs.writeFileSync(path.join(ROOT, 'web', 'levels-data.js'),
    '/* 由 npm run build 生成，禁止手改 */\nwindow.LEVELS = ' + JSON.stringify(levels) + ';\n');
  /* 小程序数据 */
  fs.mkdirSync(path.join(ROOT, 'miniprogram', 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'miniprogram', 'data', 'levels.js'),
    '/* 由 npm run build 生成，禁止手改 */\nmodule.exports = ' + JSON.stringify(levels) + ';\n');
  /* 小程序引擎副本（核心三件：规则校验/求解/提示 + 生成器/生成配置，双端同源） */
  const engDir = path.join(ROOT, 'miniprogram', 'utils', 'engine');
  fs.mkdirSync(engDir, { recursive: true });
  for (const f of ['core.js', 'solver.js', 'hint.js', 'generator.js', 'genconfig.js']) {
    fs.copyFileSync(path.join(ROOT, 'engine', 'src', f), path.join(engDir, f));
  }
  fs.writeFileSync(path.join(engDir, 'index.js'),
    '/* 由 npm run build 生成，禁止手改 */\n' +
    'const CatChess = {};\n' +
    'Object.assign(CatChess, require(\'./core.js\'), require(\'./solver.js\'), require(\'./hint.js\'), require(\'./generator.js\'), require(\'./genconfig.js\'));\n' +
    'module.exports = CatChess;\n');
  console.log('构建完成: web/levels-data.js + miniprogram/data/levels.js + miniprogram/utils/engine/（' + levels.length + ' 关）');
}

else if (cmd === 'build-cocos') {
  /* Cocos 工程同步：引擎 UMD → TS 默认导出工厂 + 关卡数据 TS（单一来源，禁止手改生成物） */
  const levels = loadLevels();
  if (!levels.length) { console.error('无关卡'); process.exit(1); }
  const engDir = path.join(ROOT, 'cocos', 'assets', 'scripts', 'engine');
  fs.mkdirSync(engDir, { recursive: true });
  const umdToTs = src => {
    const m = src.match(/,\s*function\s*\(\)\s*\{/);
    if (!m) throw new Error('UMD 工厂未找到');
    const start = m.index + m[0].length - 1; /* '{' 位置 */
    let depth = 0, end = -1;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) throw new Error('UMD 工厂未闭合');
    const body = src.slice(start, end + 1);
    return '/* 由 npm run build 自动生成（源自 engine/src，禁止手改） */\nexport default function () ' + body + ';\n';
  };
  for (const f of ['core.js', 'solver.js', 'hint.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'engine', 'src', f), 'utf8');
    fs.writeFileSync(path.join(engDir, f.replace(/\.js$/, '.ts')), umdToTs(src));
  }
  fs.writeFileSync(path.join(engDir, 'index.ts'),
    '/* 由 npm run build 自动生成（禁止手改） */\n' +
    'import core from \x27./core\x27;\n' +
    'import solver from \x27./solver\x27;\n' +
    'import hint from \x27./hint\x27;\n' +
    'const CatChess: any = Object.assign({}, core(), solver(), hint());\n' +
    'export default CatChess;\n');
  fs.writeFileSync(path.join(ROOT, 'cocos', 'assets', 'scripts', 'levels-data.ts'),
    '/* 由 npm run build 自动生成（禁止手改） */\nexport const LEVELS: any[] = ' + JSON.stringify(levels) + ';\n');
  console.log('Cocos 工程同步完成: engine(3 模块) + levels(' + levels.length + ' 关)');
}

else if (cmd === 'accept') {
  const id = Number(arg('id'));
  const status = arg('status') || 'pass';
  const note = arg('note') || '';
  const file = docFile(id);
  let md = fs.readFileSync(file, 'utf8');
  const stamp = new Date().toISOString().slice(0, 10);
  md = md.replace('- [网页] 待验收', '- [网页] ' + stamp + ' ' + (status === 'pass' ? '通过' : '失败') + (note ? ' —— ' + note : ''));
  fs.writeFileSync(file, md);
  console.log(padId(id) + ' 验收回写: ' + status);
}

else if (cmd === 'accept-batch') {
  const file = arg('file');
  const results = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const r of results) {
    let md = fs.readFileSync(docFile(r.id), 'utf8');
    md = md.replace('- [网页] 待验收', '- [网页] ' + (r.status === 'pass' ? '通过' : '失败') + (r.note ? ' —— ' + r.note : ''));
    fs.writeFileSync(docFile(r.id), md);
  }
  console.log('验收回写 ' + results.length + ' 条');
}

else {
  console.log('猫棋 CLI\n用法:\n' +
    '  plan                          生成 levels/plan.json（100 关规划）\n' +
    '  probe [--sizes 6,8,20]        难度校准探针\n' +
    '  gen --id N --size S [--target D] [--seed B]   生成单关（含文档）\n' +
    '  gen-batch --from A --to B     按 plan 批量生成\n' +
    '  validate --all | --ids A-B    全量/范围校验（唯一解/难度/文档/查重）\n' +
    '  fix-dup                       清理难度撞分并重生成\n' +
    '  doc --id N | docs             重新生成文档\n' +
    '  index                         生成 docs/LEVEL_INDEX.md\n' +
    '  trace --id N                  打印提示链\n' +
    '  build                         构建双端数据（web + miniprogram）\n' +
    '  accept --id N --status pass|fail [--note s]   网页验收回写\n' +
    '  accept-batch --file f.json    批量验收回写');
}
