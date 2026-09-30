/* 猫棋网页版逻辑（引擎逻辑全部来自 engine/src 的 UMD，与小程序同源）
 * 交互模型（taevas 确认）：
 *   单击 = 人工标 X（无猫猫区笔记，可撤销：再点恢复空白）
 *   按住拖动 = 连续人工标 X（只作用于空白格）
 *   双击 = 判定该格是否为猫：对 → 固定为猫 🐱；错 → 系统标 X + 失败+1，失败 2 次本关失败
 *   人工 X 与系统判定分层：人工操作不影响已判定的系统 X / 猫 */
(function () {
  'use strict';
  var CatChess = window.CatChess;
  var LEVELS = window.LEVELS || [];
  var $ = function (s) { return document.querySelector(s); };
  var view = $('#view');
  var subTitle = $('#subTitle');

  var cur = null; /* { level, m: Map<idx,manualX>, sys: Map<idx,'x'|'cat'>, won, failed, fails, hints, startTime } */

  /* ---------- 进度 ---------- */
  function progress() { try { return JSON.parse(localStorage.getItem('zmm_won') || '{}'); } catch (e) { return {}; } }
  function setWon(id) { var p = progress(); p[id] = 1; localStorage.setItem('zmm_won', JSON.stringify(p)); }
  function unlocked(id) { return id === 1 || !!progress()[id - 1]; }

  /* ---------- 路由 ---------- */
  function parseHash() {
    var m = location.hash.match(/^#\/level\/(\d+)/);
    return m ? Number(m[1]) : null;
  }
  var lastRendered = null; /* 防重复渲染同一关（navigate 主动路由 + hashchange 双触发） */
  function route() {
    var id = parseHash();
    var key = id && findLevel(id) ? 'L' + id : 'list';
    if (key === lastRendered) return;
    lastRendered = key;
    if (id && findLevel(id)) renderGame(findLevel(id));
    else renderList();
  }
  /* 主动路由：location.hash 赋值在某些浏览器场景（如赋空串）不触发 hashchange，
   * 所有跳转都直接调 navigate()，hashchange 仅作浏览器前进/后退兜底 */
  function navigate(id) {
    var h = id ? '#/level/' + id : '';
    try { history.replaceState(null, '', location.pathname + location.search + h); } catch (e) { location.hash = h; }
    route();
  }
  window.addEventListener('hashchange', route);

  function findLevel(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i];
    return null;
  }

  /* ---------- 关卡列表 ---------- */
  function renderList() {
    subTitle.textContent = '每种颜色住一只猫 · 共 ' + LEVELS.length + ' 关';
    var groups = {};
    LEVELS.forEach(function (l) { (groups[l.size] = groups[l.size] || []).push(l); });
    var html = '';
    Object.keys(groups).map(Number).sort(function (a, b) { return a - b; }).forEach(function (size) {
      html += '<div class="section-title">' + size + '×' + size + ' 棋盘 · 要找出 ' + size + ' 只猫</div><div class="level-grid">';
      groups[size].forEach(function (l) {
        var cls = 'lv-card' + (progress()[l.id] ? ' done' : '') + (unlocked(l.id) ? '' : ' locked');
        html += '<div class="' + cls + '" data-id="' + l.id + '">' +
          '<div class="no">' + (unlocked(l.id) ? l.id : '🔒') + '</div>' +
          '<div class="meta">' + l.name + '</div>' +
          '<div class="meta">难度 ' + l.difficulty + '</div>' +
          '<div class="bar"><i style="width:' + l.difficulty + '%"></i></div></div>';
      });
      html += '</div>';
    });
    view.innerHTML = html;
    view.querySelectorAll('.lv-card:not(.locked)').forEach(function (el) {
      el.addEventListener('click', function () { navigate(Number(el.dataset.id)); });
    });
  }

  /* ---------- 游戏页 ---------- */
  function renderGame(level) {
    subTitle.textContent = 'L' + String(level.id).padStart(3, '0') + ' · ' + level.name;
    /* 清理上一局的胜利/失败遮罩（挂在 body 上，不随 #view 重渲染消失） */
    var oldMask = document.querySelector('#winMask'); if (oldMask) oldMask.remove();
    var oldFail = document.querySelector('#failMask'); if (oldFail) oldFail.remove();
    var oldSheet = document.querySelector('#hintSheet.show');
    cur = { level: level, m: new Map(), sys: new Map(), won: false, failed: false, fails: 0, hints: 0, startTime: Date.now() };
    var n = level.size;
    var html =
      '<div class="info"><span><b>' + n + '×' + n + '</b> · 要找出 <b>' + n + '</b> 只猫 · 难度 <b>' + level.difficulty + '</b></span>' +
      '<span>已找到 <b id="catCount">0</b>/' + n + ' 只猫 · 猜错 <b id="failCount">0</b>/2 次</span></div>' +
      '<div class="toolbar">' +
      '<button class="btn" id="btnBack">← 列表</button>' +
      '<button class="btn" id="btnReset">重置</button>' +
      '<button class="btn primary" id="btnHint">💡 提示</button>' +
      (findLevel(level.id + 1) ? '<button class="btn" id="btnNext">下一关 →</button>' : '') +
      '</div>' +
      '<div id="boardWrap"><div class="board" id="board" style="--n:' + n + '; grid-template-columns: repeat(' + n + ', 1fr);"></div></div>' +
      '<div class="rules-tip"><b>怎么玩</b>：每一横排、每一竖列、每一片<b>连在一起的同色格子</b>，都正好住一只猫；两只猫不能紧挨着（横竖斜贴着都不行）。一格的小色块，猫必须住那。<br>' +
      '<b>操作</b>：点一下空格，标个 ✕ 帮自己排除（再点一下取消）；按住拖一排，一路标 ✕；<b>连点两下就是猜猫</b>：猜对了猫就住下 🐱，猜错了这格自动打 ✕ 并记一次失败——<b>猜错 2 次这关就输了</b>。</div>' +
      '<div class="sheet" id="hintSheet"><h3>💡 单步提示</h3><div class="txt" id="hintText"></div>' +
      '<div class="row"><button class="btn" id="hintClose">知道了</button></div></div>';
    view.innerHTML = html;

    var board = $('#board');
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var i = r * n + c;
      var cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.i = i;
      cell.style.background = CatChess.PALETTE[level.regionColors[level.regions[i]]][0];
      if (c + 1 < n && level.regions[i] !== level.regions[i + 1]) cell.classList.add('br');
      if (r + 1 < n && level.regions[i] !== level.regions[i + n]) cell.classList.add('bb');
      var g = document.createElement('span');
      g.className = 'glyph';
      cell.appendChild(g);
      board.appendChild(cell);
    }
    bindPointer(board);
    $('#btnBack').addEventListener('click', function () { navigate(null); });
    $('#btnReset').addEventListener('click', function () {
      cur.m.clear(); cur.sys.clear(); cur.won = false; cur.failed = false; cur.fails = 0; cur.startTime = Date.now();
      var mask = document.querySelector('#winMask'); if (mask) mask.remove();
      var fm = document.querySelector('#failMask'); if (fm) fm.remove();
      refresh();
    });
    $('#btnHint').addEventListener('click', showHint);
    var next = $('#btnNext');
    if (next) next.addEventListener('click', function () { navigate(level.id + 1); });
    $('#hintClose').addEventListener('click', function () { $('#hintSheet').classList.remove('show'); });
    refresh();
  }

  /* ---------- 状态读取 ---------- */
  function sysAt(i) { return cur.sys.get(i) || ''; }
  function catsList() {
    var out = [];
    cur.sys.forEach(function (v, i) { if (v === 'cat') out.push([Math.floor(i / cur.level.size), i % cur.level.size]); });
    return out;
  }
  function xsList() { /* 人工 X + 系统 X（都是已确定的无猫猫区） */
    var out = [], n = cur.level.size;
    cur.m.forEach(function (v, i) { out.push([Math.floor(i / n), i % n]); });
    cur.sys.forEach(function (v, i) { if (v === 'x') out.push([Math.floor(i / n), i % n]); });
    return out;
  }

  /* ---------- 交互 ---------- */
  function bindPointer(board) {
    var gesture = null; /* {type:'tap-x'|'drag-x', i, moved} */
    var lastTap = { i: -1, t: 0 };
    function cellAt(x, y) {
      var el = document.elementFromPoint(x, y);
      if (el && el.classList && el.classList.contains('cell')) return el;
      if (el && el.parentElement && el.parentElement.classList.contains('cell')) return el.parentElement;
      return null;
    }
    board.addEventListener('pointerdown', function (e) {
      if (cur.won || cur.failed) return;
      var cell = cellAt(e.clientX, e.clientY);
      if (!cell) return;
      e.preventDefault();
      var i = Number(cell.dataset.i);
      if (sysAt(i)) { gesture = null; return; } /* 系统已判定（猫/系统X）：人工操作不影响 */
      if (!cur.m.has(i)) {
        cur.m.set(i, 1); /* 按下即标 X：拖动的起点也属于"经过的地方" */
        refresh();
        gesture = { type: 'drag-x', i: i, moved: false };
      } else {
        gesture = { type: 'tap-off', i: i, moved: false };
      }
    });
    window.addEventListener('pointermove', function (e) {
      if (!gesture) return;
      var cell = cellAt(e.clientX, e.clientY);
      if (cell && Number(cell.dataset.i) !== gesture.i) gesture.moved = true;
      if (gesture.moved && cell && !sysAt(Number(cell.dataset.i)) && !cur.m.has(Number(cell.dataset.i))) {
        cur.m.set(Number(cell.dataset.i), 1);
        refresh();
      }
    }, { passive: true });
    window.addEventListener('pointerup', function (e) {
      if (!gesture) return;
      var g = gesture; gesture = null;
      if (g.moved) return; /* 拖动结束：路径已连标 */
      var cell = cellAt(e.clientX, e.clientY);
      if (!cell || Number(cell.dataset.i) !== g.i) return;
      var i = g.i;
      if (sysAt(i)) return;
      /* 纯单击收尾：按下时标了 X 的保持（单击=标X）；原本已有 X 的取消（再点恢复空白） */
      if (g.type === 'tap-off' && cur.m.has(i)) { cur.m.delete(i); refresh(); }
      /* 双击检测：350ms 内同一格两次单击 → 判定猫 */
      var now = Date.now();
      if (lastTap.i === i && now - lastTap.t < 350) {
        lastTap = { i: -1, t: 0 };
        cur.m.delete(i); /* 双击判定：清除该格人工 X */
        judge(i);
      } else {
        lastTap = { i: i, t: now };
      }
    });
  }

  /* 双击判定：对 → 猫；错 → 系统X + 失败+1 */
  function judge(i) {
    var lv = cur.level;
    var isCat = lv.solution.some(function (rc) { return rc[0] * lv.size + rc[1] === i; });
    if (isCat) {
      cur.sys.set(i, 'cat');
      refresh();
      if (catsList().length === lv.size && !cur.won) onWin();
    } else {
      cur.sys.set(i, 'x');
      cur.fails++;
      refresh();
      if (cur.fails >= 2 && !cur.failed) onFail();
    }
  }

  /* ---------- 状态刷新 ---------- */
  function refresh() {
    if (!cur) return;
    view.querySelectorAll('.cell').forEach(function (cell) {
      var i = Number(cell.dataset.i);
      var sys = sysAt(i);
      var g = cell.firstChild;
      if (sys === 'cat') { g.textContent = '🐱'; cell.classList.add('cat'); cell.classList.remove('x', 'sysx'); }
      else if (sys === 'x') { g.textContent = '✕'; cell.classList.add('sysx'); cell.classList.remove('x', 'cat'); }
      else { g.textContent = cur.m.has(i) ? '✕' : ''; cell.classList.toggle('x', cur.m.has(i)); cell.classList.remove('sysx', 'cat'); }
    });
    $('#catCount').textContent = catsList().length;
    $('#failCount').textContent = cur.fails;
  }

  function overlay(id, inner) {
    var mask = document.createElement('div');
    mask.id = id;
    mask.classList.add('mask', 'show');
    mask.innerHTML = inner;
    document.body.appendChild(mask);
    return mask;
  }
  function onWin() {
    cur.won = true;
    setWon(cur.level.id);
    var secs = Math.round((Date.now() - cur.startTime) / 1000);
    var mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
    var mask = overlay('winMask', '<div class="win-card"><div class="big">🎉🐱</div><h2>找到全部猫咪！</h2>' +
      '<div class="meta">难度 ' + cur.level.difficulty + ' · 用时 ' + mm + ':' + ss + ' · 失败 ' + cur.fails + '/2 · 提示 ' + cur.hints + ' 次</div>' +
      '<button class="btn primary" id="winNext">' + (findLevel(cur.level.id + 1) ? '下一关 →' : '回到列表') + '</button></div>');
    mask.querySelector('#winNext').addEventListener('click', function () {
      mask.remove();
      navigate(findLevel(cur.level.id + 1) ? cur.level.id + 1 : null);
    });
  }
  function onFail() {
    cur.failed = true;
    var mask = overlay('failMask', '<div class="win-card"><div class="big">😿</div><h2>判定失败 2 次，本关失败</h2>' +
      '<div class="meta">再试一次：先用 X 标记无猫猫区，善用单步提示</div>' +
      '<button class="btn primary" id="failRetry">再试一次</button> ' +
      '<button class="btn" id="failBack">返回列表</button></div>');
    mask.querySelector('#failRetry').addEventListener('click', function () { mask.remove(); $('#btnReset').click(); });
    mask.querySelector('#failBack').addEventListener('click', function () { mask.remove(); navigate(null); });
  }

  /* ---------- 单步提示 ---------- */
  function regionNames() {
    return cur.level.regionColors.map(function (ci) { return CatChess.PALETTE[ci][1]; });
  }
  function showHint() {
    cur.hints++;
    var res = CatChess.nextHint(cur.level, catsList(), xsList(), regionNames());
    var text;
    if (res.error) text = '⚠️ ' + res.error;
    else if (res.solved) text = '🎉 本关已完成喵～';
    else {
      var h = res.hint;
      text = '【' + h.label + '】' + h.text;
      if (h.cells && h.cells.length) {
        view.querySelectorAll('.cell.hl').forEach(function (c) { c.classList.remove('hl'); });
        h.cells.forEach(function (rc) {
          var el = view.querySelector('.cell[data-i="' + (rc[0] * cur.level.size + rc[1]) + '"]');
          if (el) el.classList.add('hl');
        });
        setTimeout(function () { view.querySelectorAll('.cell.hl').forEach(function (c) { c.classList.remove('hl'); }); }, 2200);
      }
    }
    $('#hintText').textContent = text;
    $('#hintSheet').classList.add('show');
  }

  /* ---------- 验收驱动接口（__zmm）：通过真实 UI 事件操作 ---------- */
  function ev(el, type, x, y) { el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y })); }
  function center(el) { el.scrollIntoView({ block: 'center' }); var r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
  window.__zmm = {
    load: function (id) { var l = findLevel(id); if (l) renderGame(l); return !!l; },
    level: function () { return cur && cur.level; },
    cellEl: function (r, c) { return view.querySelector('.cell[data-i="' + (r * cur.level.size + c) + '"]'); },
    catCount: function () { return catsList().length; },
    fails: function () { return cur.fails; },
    isWon: function () { return !!(cur && cur.won); },
    isFailed: function () { return !!(cur && cur.failed); },
    marks: function () { return cur.m; },
    sysMarks: function () { return cur.sys; },
    tap: function (r, c) { /* 单击：人工 X 切换 */
      var el = window.__zmm.cellEl(r, c);
      var p = center(el);
      ev(el, 'pointerdown', p[0], p[1]);
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: p[0], clientY: p[1] }));
    },
    dbltap: function (r, c) { /* 双击：判定猫（两次快速单击） */
      window.__zmm.tap(r, c);
      window.__zmm.tap(r, c);
    },
    dragX: function (cells) { /* 按住拖动连续人工标 X */
      var first = window.__zmm.cellEl(cells[0][0], cells[0][1]);
      var p0 = center(first);
      ev(first, 'pointerdown', p0[0], p0[1]);
      var el, p;
      for (var k = 1; k < cells.length; k++) {
        el = window.__zmm.cellEl(cells[k][0], cells[k][1]);
        p = center(el);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p[0], clientY: p[1] }));
      }
      el = window.__zmm.cellEl(cells[cells.length - 1][0], cells[cells.length - 1][1]);
      p = center(el);
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: p[0], clientY: p[1] }));
    }
  };

  /* ---------- 启动 ---------- */
  route();
})();
