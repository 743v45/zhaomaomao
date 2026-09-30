/* 猫棋 web 地图生成器：点击生成（与 CLI 共用引擎 + genconfig 同一份配置）。
 * 不含难度全局唯一/哈希查重（那是 CLI 对全部关卡库的约束）；单图生成逻辑与 genLevel 一致。 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  /* 尺寸选择 6~20 */
  for (var s = 6; s <= 20; s++) {
    var opt = document.createElement('option');
    opt.value = s; opt.textContent = s + '×' + s;
    $('sizeSel').appendChild(opt);
  }
  $('sizeSel').value = 12;
  var sizeHint = function () { $('sizeHint').textContent = $('sizeSel').value + ' 色块'; };
  $('sizeSel').addEventListener('change', sizeHint);
  sizeHint();

  var state = { rec: null, base: null, tries: 0, ms: 0 };

  /* 生成主循环：与 engine/cli.js genLevel 同语义（带内 → 权重择优/提前接受；带外留最近难度兜底） */
  async function generateMap(size, target, seedBase, onProgress) {
    var t0 = performance.now();
    var useWeight = size >= CatChess.WEIGHT_MIN_SIZE;
    var band = CatChess.DIFF_BAND;
    var best = null, tries = 0;
    var base = seedBase != null && !isNaN(seedBase) ? seedBase : (Math.random() * 0x7fffffff) | 0;
    var done = false;
    for (var round = 0; round < CatChess.ROUNDS && !done; round++) {
      for (var a = 0; a < CatChess.ATTEMPTS; a++) {
        var seed = base + round * 100003 + a * 7 + 1;
        var jr = CatChess.mulberry32(seed ^ 0x9E3779B9);
        var ps = CatChess.paramSpace(size, target, jr);
        var level = null;
        try { level = CatChess.generate({ size: size, seed: seed, forcedWish: ps.forcedWish, horizBias: ps.horizBias, tighten: ps.tighten, tightenMin: ps.tightenMin, tightenMax: ps.tightenMax }); } catch (e) { level = null; }
        tries++;
        if (level) {
          var trace = CatChess.analyze(level);
          if (!trace.error) {
            var sc = CatChess.score(level, trace);
            var rec = { level: level, sc: sc, seed: seed, off: Math.abs(sc.total - target), W: CatChess.weightOf(level.regions), tries: tries };
            if (rec.off <= band) {
              if (!useWeight) { best = rec; done = true; }
              else {
                if (!best || best.off > band || rec.W > best.W) best = rec;
                if (rec.W >= CatChess.W_ACCEPT) done = true;
              }
            } else if (!best || (best.off > band && rec.off < best.off)) best = rec;
          }
        }
        if (onProgress) onProgress(tries, best, performance.now() - t0);
        await new Promise(function (r) { setTimeout(r, 0); }); /* 让出主线程，进度可见 */
        /* 宽限收手：带内已有候选且超过 WEB_GRACE_MS → 不再苦等 W_ACCEPT（大棋盘体验优先） */
        if (!done && best && best.off <= band && performance.now() - t0 > CatChess.WEB_GRACE_MS) done = true;
        if (done || performance.now() - t0 > 60000) { done = true; break; }
      }
      if (best && best.off <= band && (!useWeight || best.W >= CatChess.W_ACCEPT)) done = true;
    }
    return { best: best, base: base, tries: tries, ms: Math.round(performance.now() - t0) };
  }

  function render(rec) {
    var lv = rec.level, n = lv.size;
    var board = $('board');
    board.innerHTML = '';
    board.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
    board.style.width = 'min(560px, calc(100vw - 60px))';
    var cell = Math.max(14, Math.floor(Math.min(560, window.innerWidth - 60) / n) - 2);
    var solSet = {}, i;
    for (i = 0; i < lv.solution.length; i++) solSet[lv.solution[i][0] * n + lv.solution[i][1]] = true;
    var forcedSet = {};
    for (i = 0; i < lv.forced.length; i++) forcedSet[lv.forced[i][0] * n + lv.forced[i][1]] = true;
    var showSol = $('showSol').checked, showForced = $('showForced').checked;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var idx = r * n + c, g = lv.regions[idx];
      var d = document.createElement('div');
      d.className = 'cell';
      d.style.background = CatChess.PALETTE[lv.regionColors[g]][0];
      d.style.width = cell + 'px'; d.style.height = cell + 'px';
      if (showSol && solSet[idx]) { d.classList.add('cat'); d.textContent = '🐱'; }
      else if (showForced && forcedSet[idx]) d.classList.add('forced');
      board.appendChild(d);
    }
    var unique = CatChess.solve(lv, 2).count === 1;
    var bandTxt = rec.off <= CatChess.DIFF_BAND ? '<span class="ok">带内 ✓</span>' : '带外 ' + rec.off;
    $('stats').innerHTML =
      '<b>' + n + '×' + n + '</b> · 难度 <b>' + rec.sc.total + '</b>/目标 ' + $('targetIn').value + '（' + bandTxt + '）<br>' +
      '小区块权重 <b>' + rec.W + '</b>/100 · 强制格 ' + lv.forced.length + ' · 色块 ' + n + '<br>' +
      '唯一解 <span class="ok">' + (unique ? '✓' : '✗') + '</span> · 尝试 ' + state.tries + ' 次 · 耗时 ' + state.ms + 'ms<br>' +
      '<span class="hint">种子 ' + state.base + '（命中尝试 ' + rec.seed + '）</span>';
  }

  async function run() {
    if ($('genBtn').disabled) return;
    var size = Number($('sizeSel').value), target = Number($('targetIn').value);
    if (!(size >= 6 && size <= 20) || !(target >= 1 && target <= 100)) { $('progress').textContent = '参数超出范围'; return; }
    $('genBtn').disabled = true; $('exportBtn').disabled = true;
    $('progress').textContent = '生成中…';
    var sv = String($('seedIn').value || '').trim();
    var res = await generateMap(size, target, sv === '' ? null : Number(sv), function (tries, best, ms) {
      $('progress').textContent = '第 ' + tries + ' 次尝试 · ' + Math.round(ms) + 'ms' +
        (best ? ' · 当前最佳：难度 ' + best.sc.total + ' 权重 ' + best.W : '');
    });
    state.rec = res.best; state.base = res.base; state.tries = res.tries; state.ms = res.ms;
    $('genBtn').disabled = false; $('exportBtn').disabled = !res.best;
    $('progress').textContent = res.best ? '完成：' + res.tries + ' 次尝试 · ' + res.ms + 'ms' : '生成失败（换种子/参数重试）';
    if (res.best) render(res.best);
  }

  function exportJson() {
    if (!state.rec) return;
    var lv = state.rec.level;
    var data = {
      size: lv.size, regions: lv.regions, regionColors: lv.regionColors,
      solution: lv.solution, forced: lv.forced, regionsCount: CatChess.regionCount(lv.regions),
      difficulty: state.rec.sc.total, difficultyTarget: Number($('targetIn').value),
      difficultyDetail: state.rec.sc.detail, weight: state.rec.W, weightDetail: CatChess.regionPenalty(lv.regions),
      seed: state.rec.seed
    };
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = 'zmm-' + lv.size + 'x' + lv.size + '-d' + data.difficulty + '-s' + state.rec.seed + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  $('genBtn').addEventListener('click', run);
  $('exportBtn').addEventListener('click', exportJson);
  $('showSol').addEventListener('change', function () { if (state.rec) render(state.rec); });
  $('showForced').addEventListener('change', function () { if (state.rec) render(state.rec); });

  /* 验收驱动接口（同游戏页 __zmm 模式） */
  window.__zmmGen = { state: state, generateMap: generateMap, run: run, render: render };

  /* 进页面先生成一张（点击可随时再生成） */
  run();
})();
