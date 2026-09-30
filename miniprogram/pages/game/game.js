var CatChess = require('../../utils/engine/index.js');
var LEVELS = require('../../data/levels.js');

Page({
  data: {
    level: null, n: 0, cells: [], boardPx: 0,
    catCount: 0, conflictCount: 0,
    rulesTip: ''
  },

  onLoad: function (q) {
    var id = Number(q.id);
    var level = null;
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) level = LEVELS[i];
    if (!level) { wx.navigateBack(); return; }
    this.level = level;
    this.marks = {}; /* 人工 X: idx -> 1 */
    this.sys = {};   /* 系统判定: idx -> 'x' | 'cat' */
    this.won = false;
    this.failed = false;
    this.fails = 0;
    this.lastTap = { i: -1, t: 0 };
    this.hints = 0;
    this.startTime = Date.now();
    var sys = wx.getSystemInfoSync();
    var boardPx = Math.min(sys.windowWidth - 24, 620);
    this.cellPx = Math.floor(boardPx / level.size);
    boardPx = this.cellPx * level.size;
    this.boardPx = boardPx;
    this.rect = null;
    wx.setNavigationBarTitle({ title: 'L' + (level.id < 10 ? '00' : (level.id < 100 ? '0' : '')) + level.id + ' · ' + level.name });
    this.buildCells();
  },

  onReady: function () {
    /* 棋盘位置必须在首帧渲染完成后测量（onLoad 时 #board 尚未渲染，rect 会是 null，
     * 导致触摸坐标换算全部失败、棋盘无法操作） */
    this.measureBoard();
  },

  measureBoard: function () {
    var that = this;
    wx.createSelectorQuery().select('#board').boundingClientRect(function (r) { that.rect = r; }).exec();
  },

  buildCells: function () {
    var lv = this.level, n = lv.size, g = lv.regions;
    var cells = [];
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var i = r * n + c;
      cells.push({
        i: i,
        color: CatChess.PALETTE[lv.regionColors[g[i]]][0],
        br: c + 1 < n && g[i] !== g[i + 1],
        bb: r + 1 < n && g[i] !== g[i + n],
        cls: '', glyph: ''
      });
    }
    this.setData({ level: { id: lv.id, size: n, difficulty: lv.difficulty }, n: n, cells: cells, boardPx: this.boardPx, catCount: 0, failCount: 0 });
  },

  cellFromTouch: function (touch) {
    if (!this.rect) return -1;
    var x = touch.clientX - this.rect.left;
    var y = touch.clientY - this.rect.top;
    if (x < 0 || y < 0 || x >= this.boardPx || y >= this.boardPx) return -1;
    var n = this.level.size;
    var c = Math.floor(x / this.cellPx), r = Math.floor(y / this.cellPx);
    return r * n + c;
  },

  /* 单击=人工X(可撤销) / 拖动=连标人工X / 双击=判定猫（与网页版同构） */
  onTouchStart: function (e) {
    if ((this.won || this.failed) || !e.touches.length) return;
    var i = this.cellFromTouch(e.touches[0]);
    if (i < 0) return;
    if (this.sys[i]) { this.gesture = null; return; } /* 系统已判定：人工操作不影响 */
    if (!this.marks[i]) {
      this.marks[i] = 1; /* 按下即标 X：拖动的起点也属于"经过的地方" */
      this.apply();
      this.gesture = { type: 'drag-x', i: i, markedHere: true, moved: false };
    } else {
      this.gesture = { type: 'tap-off', i: i, markedHere: false, moved: false };
    }
  },
  onTouchMove: function (e) {
    if (!this.gesture || !e.touches.length) return;
    var i = this.cellFromTouch(e.touches[0]);
    if (i >= 0 && i !== this.gesture.i) this.gesture.moved = true;
    if (this.gesture.moved && i >= 0 && !this.sys[i] && !this.marks[i]) {
      this.marks[i] = 1;
      this.apply();
    }
  },
  onTouchEnd: function (e) {
    if (!this.gesture) return;
    var g = this.gesture; this.gesture = null;
    if (g.moved) return; /* 拖动结束：路径已连标 */
    var i = -1;
    if (e.changedTouches && e.changedTouches.length) i = this.cellFromTouch(e.changedTouches[0]);
    if (i !== g.i || this.sys[i]) return;
    /* 纯单击收尾：按下时标了 X 的保持（单击=标X）；原本已有 X 的取消（再点恢复空白） */
    if (g.type === 'tap-off' && this.marks[i]) delete this.marks[i];
    this.apply();
    /* 双击检测 → 判定猫 */
    var now = Date.now();
    if (this.lastTap.i === i && now - this.lastTap.t < 350) {
      this.lastTap = { i: -1, t: 0 };
      delete this.marks[i]; /* 撤销两次单击的切换，恢复原状 */
      this.judge(i);
    } else {
      this.lastTap = { i: i, t: now };
    }
  },

  /* 双击判定：对 → 锁定为猫；错 → 系统X + 失败+1（2 次本关失败） */
  judge: function (i) {
    var lv = this.level;
    var isCat = lv.solution.some(function (rc) { return rc[0] * lv.size + rc[1] === i; });
    if (isCat) {
      this.sys[i] = 'cat';
      this.apply();
      if (this.catsList().length === lv.size && !this.won) this.onWin();
    } else {
      this.sys[i] = 'x';
      this.fails++;
      this.apply();
      if (this.fails >= 2 && !this.failed) this.onFail();
    }
  },

  onFail: function () {
    this.failed = true;
    var that = this;
    wx.showModal({
      title: '😿 判定失败 2 次',
      content: '本关失败。再试一次：先用 X 标记无猫猫区，善用单步提示。',
      confirmText: '再试一次',
      cancelText: '返回',
      success: function (res) {
        if (res.confirm) that.onTapReset();
        else wx.navigateBack();
      }
    });
  },

  catsList: function () {
    var n = this.level.size, out = [];
    for (var k in this.sys) if (this.sys[k] === 'cat') out.push([Math.floor(k / n), Number(k) % n]);
    return out;
  },
  xsList: function () {
    var n = this.level.size, out = [];
    for (var k in this.marks) out.push([Math.floor(k / n), Number(k) % n]);
    for (var k in this.sys) if (this.sys[k] === 'x') out.push([Math.floor(k / n), Number(k) % n]);
    return out;
  },

  apply: function () {
    var cells = this.data.cells;
    for (var idx = 0; idx < cells.length; idx++) {
      var sys = this.sys[idx];
      var glyph, cls = '';
      if (sys === 'cat') { glyph = '🐱'; cls = 'cat'; }
      else if (sys === 'x') { glyph = '✕'; cls = 'sysx'; }
      else if (this.marks[idx]) { glyph = '✕'; cls = 'x'; }
      else glyph = '';
      if (cells[idx].glyph !== glyph || cells[idx].cls !== cls) {
        this.setData(('cells[' + idx + '].glyph'), glyph);
        this.setData(('cells[' + idx + '].cls'), cls);
      }
    }
    this.setData({ catCount: this.catsList().length, failCount: this.fails });
  },

  onWin: function () {
    this.won = true;
    var won = wx.getStorageSync('zmm_won') || {};
    won[this.level.id] = 1;
    wx.setStorageSync('zmm_won', won);
    var secs = Math.round((Date.now() - this.startTime) / 1000);
    var next = null;
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === this.level.id + 1) next = LEVELS[i];
    var that = this;
    wx.showModal({
      title: '🎉 找到全部猫咪！',
      content: '难度 ' + this.level.difficulty + ' · 用时 ' + Math.floor(secs / 60) + '分' + (secs % 60) + '秒 · 提示 ' + this.hints + ' 次',
      confirmText: next ? '下一关' : '返回',
      cancelText: '留在此页',
      success: function (res) {
        if (res.confirm) {
          if (next) wx.redirectTo({ url: '/pages/game/game?id=' + next.id });
          else wx.navigateBack();
        }
      }
    });
  },

  onTapHint: function () {
    this.hints++;
    var names = this.level.regionColors.map(function (ci) { return CatChess.PALETTE[ci][1]; });
    var res = CatChess.nextHint(this.level, this.catsList(), this.xsList(), names);
    var text;
    if (res.error) text = '⚠️ ' + res.error;
    else if (res.solved) text = '🎉 本关已完成喵～';
    else text = '【' + res.hint.label + '】' + res.hint.text;
    wx.showModal({ title: '💡 单步提示', content: text, showCancel: false });
  },

  onTapReset: function () {
    this.marks = {};
    this.sys = {};
    this.won = false;
    this.failed = false;
    this.fails = 0;
    this.startTime = Date.now();
    this.buildCells();
  },

  /* ---- 自动化测试钩子（miniprogram-automator 经 page.callMethod 调用） ---- */
  cellMeta: function () {
    return { left: this.rect ? this.rect.left : 0, top: this.rect ? this.rect.top : 0, cellPx: this.cellPx };
  },
  debugState: function () {
    var lv = this.level, n = lv.size;
    var marks = {};
    for (var k in this.marks) marks[k] = 1;
    return {
      level: lv, n: n, solution: lv.solution, regionColors: lv.regionColors,
      marks: marks, cats: this.catsList().length, catsList: this.catsList(), xsList: this.xsList(),
      fails: this.fails, won: this.won, failed: this.failed
    };
  }
});
