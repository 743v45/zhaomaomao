/* 猫棋 · Cocos Creator 动画版 —— 全动态 UI（无纹理资源依赖：Graphics + Label + tween）
 * 交互与原生版同构：单击标 ✕（人工笔记）/ 拖动连标 / 双击判定猫（判错计失败，2 次失败）。
 * 引擎与关卡数据由 npm run build 同步（单一来源），本文件只负责渲染、交互与动画。
 * 场景里挂这一个组件即可（assets/scenes/main.scene）。 */
import { _decorator, Component, Node, Label, Graphics, UITransform, Color, Vec3, tween, UIOpacity, Input, sys } from 'cc';
const { ccclass } = _decorator;

import CatChessMod from './engine/index';
import { LEVELS } from './levels-data';

const CatChess: any = CatChessMod;
type Level = any;

interface Cell { node: Node; glyph: Label; hl: Node; r: number; c: number; }

@ccclass('Boot')
export class Boot extends Component {
  private root: Node = null!;
  private level: Level = null!;
  private cells: Cell[] = [];
  private manualX = new Set<number>();
  private sysState = new Map<number, 'x' | 'cat'>();   /* 系统判定（判错✕ / 判对🐱） */
  private fails = 0;
  private won = false;
  private failed = false;
  private hints = 0;
  private startTime = 0;
  private lastTap = { i: -1, t: 0 };
  private gesture: { i: number; moved: boolean } | null = null;
  private boardPx = 0;
  private cellPx = 0;
  private infoLabel: Label = null!;
  private page = 0;

  /* ============ 生命周期 ============ */
  onLoad() {
    this.root = this.node;
    this.showList();
  }

  /* ============ 关卡列表（分页，每页 20 关） ============ */
  private showList() {
    this.clearRoot();
    const W = this.viewSize().width;
    const label = this.makeLabel('🐱 猫棋', 46, '#6b5b4e');
    label.node.setPosition(0, this.viewSize().height / 2 - 70, 0);
    this.root.addChild(label.node);
    const sub = this.makeLabel('每种颜色住一只猫 · 双击猜猫，猜错 2 次就输', 20, '#a08c76');
    sub.node.setPosition(0, this.viewSize().height / 2 - 110, 0);
    this.root.addChild(sub.node);

    const perPage = 20;
    const pages = Math.ceil(LEVELS.length / perPage);
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const from = this.page * perPage;
    const items = LEVELS.slice(from, from + perPage);
    const cardW = (W - 60 - 4 * 12) / 5, cardH = 96;
    items.forEach((lv: Level, idx: number) => {
      const row = Math.floor(idx / 5), col = idx % 5;
      const x = -W / 2 + 30 + cardW / 2 + col * (cardW + 12);
      const y = this.viewSize().height / 2 - 160 - cardH / 2 - row * (cardH + 12);
      const card = this.makeCard(lv, cardW, cardH);
      card.setPosition(x, y, 0);
      this.root.addChild(card);
      tween(card).set({ scale: new Vec3(0.6, 0.6, 1) }).to(0.24, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
      card.on(Input.EventType.TOUCH_END, () => { this.enterLevel(lv.id); });
    });
    /* 翻页 */
    if (this.page > 0) this.root.addChild(this.makeButton('← 上一页', new Vec3(-W / 2 + 90, -this.viewSize().height / 2 + 50, 0), () => { this.page--; this.showList(); }));
    if (this.page < pages - 1) this.root.addChild(this.makeButton('下一页 →', new Vec3(W / 2 - 90, -this.viewSize().height / 2 + 50, 0), () => { this.page++; this.showList(); }));
  }

  private makeCard(lv: Level, w: number, h: number): Node {
    const n = new Node('card');
    n.addComponent(UITransform).setContentSize(w, h);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(255, 255, 255, 255);
    g.roundRect(-w / 2, -h / 2, w, h, 10); g.fill();
    g.lineWidth = 2; g.strokeColor = new Color(240, 223, 200, 255);
    g.roundRect(-w / 2, -h / 2, w, h, 10); g.stroke();
    const no = this.makeLabel(String(lv.id), 30, '#4a3f35'); no.node.setPosition(0, 22, 0); n.addChild(no.node);
    const nm = this.makeLabel(lv.name, 14, '#a08c76'); nm.node.setPosition(0, 0, 0); n.addChild(nm.node);
    const df = this.makeLabel('难度 ' + lv.difficulty, 14, '#ff8b5e'); df.node.setPosition(0, -22, 0); n.addChild(df.node);
    /* 难度条 */
    const bar = new Node('bar'); bar.addComponent(UITransform).setContentSize(w - 24, 5); bar.setPosition(0, -h / 2 + 12, 0); n.addChild(bar);
    const bg = bar.addComponent(Graphics); bg.fillColor = new Color(240, 228, 210, 255); bg.roundRect(-(w - 24) / 2, -2.5, w - 24, 5, 2.5); bg.fill();
    const fgN = new Node('fg'); fgN.addComponent(UITransform).setContentSize((w - 24) * lv.difficulty / 100, 5); fgN.setPosition(-(w - 24) / 2 + (w - 24) * lv.difficulty / 200, 0, 0); bar.addChild(fgN);
    const fg = fgN.addComponent(Graphics); fg.fillColor = new Color(255, 139, 94, 255); fg.roundRect(-(w - 24) * lv.difficulty / 200, -2.5, (w - 24) * lv.difficulty / 100, 5, 2.5); fg.fill();
    return n;
  }

  /* ============ 游戏页 ============ */
  private enterLevel(id: number) {
    const lv = LEVELS.find((l: Level) => l.id === id);
    if (!lv) return;
    this.level = lv;
    this.manualX.clear();
    this.sysState.clear();
    this.cells = [];
    this.fails = 0; this.won = false; this.failed = false; this.hints = 0;
    this.startTime = Date.now();
    this.lastTap = { i: -1, t: 0 };
    this.showGame();
  }

  private showGame() {
    this.clearRoot();
    const n = this.level.size;
    const { width: W, height: H } = this.viewSize();
    this.boardPx = Math.min(W - 24, H - 210);
    this.cellPx = Math.floor(this.boardPx / n);
    this.boardPx = this.cellPx * n;

    this.infoLabel = this.makeLabel('', 20, '#8a7560');
    this.infoLabel.node.setPosition(0, H / 2 - 40, 0);
    this.root.addChild(this.infoLabel.node);

    /* 工具栏 */
    this.root.addChild(this.makeButton('← 列表', new Vec3(-W / 2 + 70, H / 2 - 85, 0), () => this.showList()));
    this.root.addChild(this.makeButton('重置', new Vec3(0, H / 2 - 85, 0), () => this.enterLevel(this.level.id)));
    this.root.addChild(this.makeButton('💡 提示', new Vec3(W / 2 - 70, H / 2 - 85, 0), () => this.showHint(), true));

    /* 棋盘 */
    const board = new Node('board');
    board.addComponent(UITransform).setContentSize(this.boardPx, this.boardPx);
    board.setPosition(0, -30, 0);
    this.root.addChild(board);
    const g = board.addComponent(Graphics);
    g.fillColor = new Color(107, 91, 78, 255);
    g.roundRect(-this.boardPx / 2 - 3, -this.boardPx / 2 - 3, this.boardPx + 6, this.boardPx + 6, 6); g.fill();

    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const cell = new Node('cell');
      cell.addComponent(UITransform).setContentSize(this.cellPx, this.cellPx);
      cell.setPosition(-this.boardPx / 2 + this.cellPx * (c + 0.5), this.boardPx / 2 - this.cellPx * (r + 0.5), 0);
      const cg = cell.addComponent(Graphics);
      const [hexR, hexG, hexB] = this.hexColor(CatChess.PALETTE[this.level.regionColors[this.level.regions[i]]][0]);
      cg.fillColor = new Color(hexR, hexG, hexB, 255);
      cg.fillRect(-this.cellPx / 2, -this.cellPx / 2, this.cellPx, this.cellPx); cg.fill();
      cg.lineWidth = 0.5; cg.strokeColor = new Color(107, 91, 78, 70);
      cg.rect(-this.cellPx / 2, -this.cellPx / 2, this.cellPx, this.cellPx); cg.stroke();
      /* 区块粗边界 */
      cg.lineWidth = 2.5; cg.strokeColor = new Color(107, 91, 78, 255);
      const isBr = c + 1 < n && this.level.regions[i] !== this.level.regions[i + 1];
      const isBb = r + 1 < n && this.level.regions[i] !== this.level.regions[i + n];
      if (isBr) { cg.moveTo(this.cellPx / 2, -this.cellPx / 2); cg.lineTo(this.cellPx / 2, this.cellPx / 2); cg.stroke(); }
      if (isBb) { cg.moveTo(-this.cellPx / 2, -this.cellPx / 2); cg.lineTo(this.cellPx / 2, -this.cellPx / 2); cg.stroke(); }
      const glyph = this.makeLabel('', Math.floor(this.cellPx * 0.5), '#b3a695');
      cell.addChild(glyph.node);
      /* 高亮层 */
      const hl = new Node('hl');
      hl.addComponent(UITransform).setContentSize(this.cellPx, this.cellPx);
      const hlg = hl.addComponent(Graphics);
      hlg.fillColor = new Color(63, 140, 255, 90);
      hlg.fillRect(-this.cellPx / 2, -this.cellPx / 2, this.cellPx, this.cellPx); hlg.fill();
      hl.active = false;
      cell.addChild(hl);
      board.addChild(cell);
      this.cells.push({ node: cell, glyph, hl, r, c });
    }
    /* 棋盘入场动画 */
    board.setScale(0.7, 0.7, 1);
    tween(board).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

    /* 触摸：board 统一接管（坐标换算格子），单击✕/拖动连标/双击判定 同构原生版 */
    board.on(Input.EventType.TOUCH_START, (e: any) => this.onTouch(e, 'start'), this);
    board.on(Input.EventType.TOUCH_MOVE, (e: any) => this.onTouch(e, 'move'), this);
    board.on(Input.EventType.TOUCH_END, (e: any) => this.onTouch(e, 'end'), this);
    board.on(Input.EventType.TOUCH_CANCEL, (e: any) => this.onTouch(e, 'end'), this);
    this.refreshInfo();
  }

  private cellAtEvent(e: any): number {
    const n = this.level.size;
    const ui = e.getUILocation();
    const bp = this.cells[0].node.parent!.position;
    const x = ui.x - bp.x, y = ui.y - bp.y;
    if (x < -this.boardPx / 2 || y < -this.boardPx / 2 || x >= this.boardPx / 2 || y >= this.boardPx / 2) return -1;
    const c = Math.floor((x + this.boardPx / 2) / this.cellPx);
    const r = Math.floor((this.boardPx / 2 - y) / this.cellPx);
    if (r < 0 || r >= n || c < 0 || c >= n) return -1;
    return r * n + c;
  }

  private onTouch(e: any, phase: 'start' | 'move' | 'end') {
    if (this.won || this.failed) return;
    const i = this.cellAtEvent(e);
    if (phase === 'start') {
      if (i < 0 || this.sysState.has(i)) { this.gesture = null; return; }
      if (!this.manualX.has(i)) {
        this.manualX.add(i);            /* 按下即标 ✕（拖动起点也属"经过"） */
        this.animMark(i);
        this.gesture = { i, moved: false, tapOff: false };
      } else {
        this.gesture = { i, moved: false, tapOff: true };   /* 原本已有 ✕：松手即取消 */
      }
    } else if (phase === 'move') {
      if (!this.gesture) return;
      if (i >= 0 && i !== this.gesture.i) this.gesture.moved = true;
      if (this.gesture.moved && i >= 0 && !this.sysState.has(i) && !this.manualX.has(i)) {
        this.manualX.add(i); this.animMark(i);
      }
    } else {
      if (!this.gesture) return;
      const g = this.gesture; this.gesture = null;
      if (i !== g.i) return;
      if (i < 0 || this.sysState.has(i)) return;
      /* 纯单击收尾：原本已有 ✕ 的格恢复空白（再点取消） */
      if (!g.moved && (g as any).tapOff && this.manualX.has(i)) this.manualX.delete(i);
      const now = Date.now();
      if (this.lastTap.i === i && now - this.lastTap.t < 350) {
        this.lastTap = { i: -1, t: 0 };
        this.manualX.delete(i);
        this.judge(i);
      } else {
        this.lastTap = { i, t: now };
      }
    }
  }

  /* ============ 判定 ============ */
  private judge(i: number) {
    const lv = this.level;
    const isCat = lv.solution.some((rc: number[]) => rc[0] * lv.size + rc[1] === i);
    if (isCat) {
      this.sysState.set(i, 'cat');
      this.animCat(i);
      if ([...this.sysState.values()].filter(v => v === 'cat').length === lv.size && !this.won) this.onWin();
    } else {
      this.sysState.set(i, 'x');
      this.fails++;
      this.animWrong(i);
      if (this.fails >= 2 && !this.failed) this.onFail();
    }
    this.refreshInfo();
  }

  /* ============ 动画 ============ */
  private animMark(i: number) {          /* ✕ 淡入 + 轻旋 */
    const cell = this.cells[i];
    cell.glyph.string = '✕';
    cell.glyph.color = new Color(179, 166, 149, 255);
    cell.glyph.node.setScale(0.2, 0.2, 1);
    cell.glyph.node.setRotationFromEuler(0, 0, -0.5);
    tween(cell.glyph.node).to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }
  private animCat(i: number) {           /* 猫落地弹跳 + 光圈 */
    const cell = this.cells[i];
    cell.glyph.string = '🐱';
    cell.glyph.color = new Color(255, 255, 255, 255);
    cell.glyph.node.setPosition(0, this.cellPx * 0.9, 0);
    cell.glyph.node.setScale(1.3, 1.3, 1);
    tween(cell.glyph.node)
      .to(0.22, { position: new Vec3(0, 0, 0), scale: new Vec3(0.82, 0.82, 1) }, { easing: 'quadIn' })
      .to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    const ring = new Node('ring');
    ring.addComponent(UITransform).setContentSize(this.cellPx, this.cellPx);
    const rg = ring.addComponent(Graphics);
    rg.lineWidth = 3; rg.strokeColor = new Color(255, 209, 102, 255);
    rg.circle(0, 0, this.cellPx * 0.36); rg.stroke();
    cell.node.addChild(ring);
    tween(ring).to(0.45, { scale: new Vec3(1.9, 1.9, 1) }).call(() => ring.destroy()).start();
  }
  private animWrong(i: number) {         /* 判错：格子抖动 + 红闪 + 系统✕ */
    const cell = this.cells[i];
    const x0 = cell.node.position.x;
    tween(cell.node)
      .repeat(4, tween(cell.node).to(0.05, { position: new Vec3(x0 + 4, cell.node.position.y, 0) }).to(0.05, { position: new Vec3(x0 - 4, cell.node.position.y, 0) }))
      .to(0.05, { position: new Vec3(x0, cell.node.position.y, 0) })
      .start();
    const flash = new Node('flash');
    flash.addComponent(UITransform).setContentSize(this.cellPx, this.cellPx);
    const fgc = flash.addComponent(Graphics);
    fgc.fillColor = new Color(229, 83, 60, 120);
    fgc.fillRect(-this.cellPx / 2, -this.cellPx / 2, this.cellPx, this.cellPx); fgc.fill();
    cell.node.addChild(flash);
    const op = flash.addComponent(UIOpacity);
    tween(op).delay(0.25).to(0.2, { opacity: 0 }).call(() => flash.destroy()).start();
    cell.glyph.string = '✕';
    cell.glyph.color = new Color(217, 95, 67, 255);
  }

  private onWin() {
    this.won = true;
    this.showOverlay('🎉🐱', '找到全部猫咪！', '难度 ' + this.level.difficulty + ' · 猜错 ' + this.fails + '/2 · 提示 ' + this.hints + ' 次', () => {
      const next = LEVELS.find((l: Level) => l.id === this.level.id + 1);
      if (next) this.enterLevel(next.id); else this.showList();
    }, '下一关 →');
    this.confetti();
  }
  private onFail() {
    this.failed = true;
    this.showOverlay('😿', '猜错 2 次，这局输了', '先用 ✕ 标出无猫猫区，善用提示再来', () => this.enterLevel(this.level.id), '再试一次');
  }

  private confetti() {                   /* 全屏彩纸（无粒子资源，动态小方块） */
    const { width: W, height: H } = this.viewSize();
    const colors = ['#F7C6D2', '#FCE38A', '#B8E6B0', '#AED6F5', '#F5A9A0', '#D9C4EE'];
    for (let k = 0; k < 40; k++) {
      const p = new Node('confetti');
      p.addComponent(UITransform).setContentSize(10, 14);
      const g = p.addComponent(Graphics);
      const [r, gg, b] = this.hexColor(colors[k % colors.length]);
      g.fillColor = new Color(r, gg, b, 255);
      g.fillRect(-5, -7, 10, 14); g.fill();
      p.setPosition((Math.random() - 0.5) * W, H / 2 + 30, 0);
      this.root.addChild(p);
      const dx = (Math.random() - 0.5) * 300;
      const dur = 0.9 + Math.random() * 0.7;
      tween(p).by(dur, { position: new Vec3(dx, -H - 60, 0), angle: 720 * (Math.random() > 0.5 ? 1 : -1) }, { easing: 'quadIn' }).call(() => p.destroy()).start();
    }
  }

  /* ============ 提示 ============ */
  private showHint() {
    this.hints++;
    const names = this.level.regionColors.map((ci: number) => CatChess.PALETTE[ci][1]);
    const res = CatChess.nextHint(this.level, this.catsList(), this.xsList(), names);
    let text: string;
    if (res.error) text = '⚠️ ' + res.error;
    else if (res.solved) text = '🎉 本关已完成喵～';
    else {
      const h = res.hint;
      text = '【' + h.label + '】' + h.text;
      (h.cells || []).slice(0, 12).forEach((rc: number[]) => {
        const cell = this.cells[rc[0] * this.level.size + rc[1]];
        cell.hl.active = true;
        tween(cell.hl).delay(2.2).call(() => { cell.hl.active = false; }).start();
      });
    }
    this.showOverlay('💡 单步提示', text.split('】')[0].replace('【', '') + '', text, () => { }, '知道了', true);
  }

  private catsList(): number[][] {
    const n = this.level.size, out: number[][] = [];
    this.sysState.forEach((v, i) => { if (v === 'cat') out.push([Math.floor(i / n), i % n]); });
    return out;
  }
  private xsList(): number[][] {
    const n = this.level.size, out: number[][] = [];
    this.manualX.forEach(i => out.push([Math.floor(i / n), i % n]));
    this.sysState.forEach((v, i) => { if (v === 'x') out.push([Math.floor(i / n), i % n]); });
    return out;
  }

  private refreshInfo() {
    const cats = this.catsList().length;
    this.infoLabel.string = this.level.size + '×' + this.level.size + ' · 要找出 ' + this.level.size + ' 只猫 · 已找到 ' + cats + ' · 猜错 ' + this.fails + '/2';
  }

  /* ============ 基础 UI 工具 ============ */
  private clearRoot() {
    this.root.removeAllChildren();
  }
  private viewSize() { return this.root.getComponent(UITransform)!.viewSize; }
  private makeLabel(text: string, size: number, color: string): Label {
    const n = new Node('label');
    n.addComponent(UITransform);
    const lb = n.addComponent(Label);
    lb.string = text; lb.fontSize = size; lb.lineHeight = size * 1.3;
    lb.color = new Color(this.hexColor(color)[0], this.hexColor(color)[1], this.hexColor(color)[2], 255);
    return lb;
  }
  private makeButton(text: string, pos: Vec3, cb: () => void, primary = false): Node {
    const n = new Node('btn');
    n.addComponent(UITransform).setContentSize(128, 44);
    const g = n.addComponent(Graphics);
    g.fillColor = primary ? new Color(255, 157, 104, 255) : new Color(255, 255, 255, 255);
    g.roundRect(-64, -22, 128, 44, 10); g.fill();
    g.lineWidth = 2; g.strokeColor = primary ? new Color(255, 157, 104, 255) : new Color(232, 213, 184, 255);
    g.roundRect(-64, -22, 128, 44, 10); g.stroke();
    const lb = this.makeLabel(text, 20, primary ? '#ffffff' : '#6b5b4e');
    lb.node.setPosition(0, 0, 0);
    n.addChild(lb.node);
    n.setPosition(pos.x, pos.y, pos.z);
    n.on(Input.EventType.TOUCH_END, () => { tween(n).to(0.08, { scale: new Vec3(0.92, 0.92, 1) }).to(0.08, { scale: new Vec3(1, 1, 1) }).start(); cb(); });
    return n;
  }
  private showOverlay(big: string, title: string, body: string, cb: () => void, btnText: string, infoOnly = false) {
    const { width: W, height: H } = this.viewSize();
    const mask = new Node('mask');
    mask.addComponent(UITransform).setContentSize(W * 2, H * 2);
    const mg = mask.addComponent(Graphics);
    mg.fillColor = new Color(60, 46, 32, 120);
    mg.fillRect(-W, -H, W * 2, H * 2); mg.fill();
    const mop = mask.addComponent(UIOpacity);
    mop.opacity = 0;
    this.root.addChild(mask);
    tween(mop).to(0.2, { opacity: 255 }).start();

    const card = new Node('win-card');
    card.addComponent(UITransform).setContentSize(Math.min(460, W - 40), 240);
    card.setPosition(0, 0, 0);
    const cg = card.addComponent(Graphics);
    cg.fillColor = new Color(255, 255, 255, 255);
    cg.roundRect(-Math.min(460, W - 40) / 2, -120, Math.min(460, W - 40), 240, 16); cg.fill();
    const bigLb = this.makeLabel(big, 52, '#4a3f35'); bigLb.node.setPosition(0, 72, 0); card.addChild(bigLb.node);
    const t = this.makeLabel(title, 30, '#4a3f35'); t.node.setPosition(0, 30, 0); card.addChild(t.node);
    const b = this.makeLabel(body, 18, '#a08c76'); b.node.setPosition(0, -6, 0); b.overflow = Label.Overflow.SHRINK;
    b.node.getComponent(UITransform)!.setContentSize(Math.min(420, W - 60), 60);
    card.addChild(b.node);
    card.addChild(this.makeButton(btnText, new Vec3(0, -80, 0), () => { mask.destroy(); if (!infoOnly) cb(); }, true));
    card.setScale(0.6, 0.6, 1);
    mask.addChild(card);
    tween(card).to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }
  private hexColor(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  /* ============ 自动化驱动钩子（真机/模拟器 preview 调试与验收用） ============ */
  private ensureDriver() {
    const self = this;
    (globalThis as any).__zmmCocos = {
      load: (id: number) => { self.enterLevel(id); return true; },
      level: () => self.level,
      catCount: () => self.catsList().length,
      fails: () => self.fails,
      isWon: () => self.won,
      isFailed: () => self.failed,
      state: () => ({ manualX: [...self.manualX], sys: [...self.sysState.entries()], fails: self.fails, won: self.won, failed: self.failed }),
      tap: (r: number, c: number) => { const i = r * self.level.size + c; if (!self.sysState.has(i)) { if (!self.manualX.has(i)) { self.manualX.add(i); self.animMark(i); } } },
      dbltap: (r: number, c: number) => { const i = r * self.level.size + c; self.manualX.delete(i); self.judge(i); },
    };
  }
  start() { this.ensureDriver(); }
  protected update(): void { /* 预留：背景呼吸动画等 */ }
}
