/* 猫棋 · Cocos Creator 动画版 —— 贴图 UI + 真猫 sprite + 音效 + 存档/解锁/星级
 * 交互与原生版同构：单击标 ✕（人工笔记）/ 拖动连标 / 双击判定猫（判错计失败，2 次失败）。
 * 引擎与关卡数据由 npm run build 同步（单一来源），本文件只负责渲染、交互、动画与音频。
 * 资源：resources/img（Kenney UI Pack CC0 + AI 猫）、resources/audio（Kenney CC0，转码 mp3）。
 * 猫四态：cat_idle 必备；cat_happy/cat_hurt/cat_dead 缺失时自动降级为 idle+变形动画（出图后直接热替换）。
 * 场景里挂这一个组件即可（assets/scenes/main.scene）。 */
import { _decorator, Component, Node, Label, Graphics, UITransform, Color, Vec3, tween, UIOpacity, Input, sys, Sprite, SpriteFrame, resources, AudioClip, AudioSource, view, Layers, ResolutionPolicy, Canvas, Camera, director } from 'cc';
const { ccclass } = _decorator;

import CatChessMod from './engine/index';
import { LEVELS } from './levels-data';

const CatChess: any = CatChessMod;
type Level = any;

interface Cell { node: Node; glyph: Label; hl: Node; r: number; c: number; }
interface SaveData { won: Record<string, number>; sound: boolean; rules: boolean; }

const SAVE_KEY = 'zmm_cocos_v1';
const IMG = ['btn_primary', 'btn_primary_pressed', 'btn_accent', 'btn_accent_pressed', 'btn_round',
  'icon_star', 'icon_star_empty', 'icon_cross', 'icon_back', 'icon_reset', 'icon_gear',
  'icon_sound_on', 'icon_sound_off', 'cat_idle', 'bg_paw'];
const CAT_STATES = ['cat_idle', 'cat_happy', 'cat_hurt', 'cat_dead'];
const SFX = ['click', 'place', 'error', 'hint', 'win', 'lose', 'meow', 'toggle'];

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
  private lastTap = { i: -1, t: 0 };
  private gesture: { i: number; moved: boolean; tapOff?: boolean } | null = null;
  private boardPx = 0;
  private cellPx = 0;
  private infoLabel: Label = null!;
  private failIcons: Sprite[] = [];
  private page = 0;
  private activeMask: Node | null = null;
  private loaded = false;
  private uiCam: Camera | null = null;
  private lastOrtho = 0;

  private frames: Record<string, SpriteFrame | null> = {};
  private clips: Record<string, AudioClip | null> = {};
  private audioSrc: AudioSource = null!;
  private save: SaveData = { won: {}, sound: true, rules: false };

  /* ============ 生命周期 ============ */
  onLoad() {
    this.root = this.node;
    view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_HEIGHT);   /* 竖屏基线，覆盖场景里手写的横屏分辨率 */
    /* 手写场景的 Canvas 没绑相机：这里接管 ortho 对齐，否则可视范围与设计分辨率脱节（画面被放大裁切） */
    this.uiCam = director.getScene()?.getComponentInChildren(Camera) || null;
    const cvs = director.getScene()?.getComponentInChildren(Canvas);
    if (cvs && this.uiCam && !cvs.cameraComponent) cvs.cameraComponent = this.uiCam;
    this.syncCamera();
    this.audioSrc = this.root.addComponent(AudioSource);
    this.loadSave();
    this.showLoading();
    this.loadAll().then(() => this.showList());
  }
  private syncCamera() {
    const halfH = view.getVisibleSize().height / 2;
    if (this.uiCam && halfH > 0 && Math.abs(this.uiCam.orthoHeight - halfH) > 0.5) this.uiCam.orthoHeight = halfH;
    this.lastOrtho = halfH;
  }

  /* ============ 存档 ============ */
  private loadSave() {
    try {
      const raw = sys.localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.save = { won: d.won || {}, sound: d.sound !== false, rules: !!d.rules };
      }
    } catch (e) { /* 损坏存档按新档处理 */ }
  }
  private persist() {
    try { sys.localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* 忽略 */ }
  }
  private isUnlocked(id: number): boolean { return id <= 1 || !!this.save.won[String(id - 1)]; }
  private starsFor(fails: number, hints: number): number { return Math.max(1, Math.min(3, 3 - fails - (hints > 0 ? 1 : 0))); }

  /* ============ 资源加载 ============ */
  private loadImg(name: string): Promise<void> {
    return new Promise(res => {
      resources.load('img/' + name + '/spriteFrame', SpriteFrame, (err, sf) => {
        this.frames[name] = err ? null : sf as SpriteFrame;
        res();
      });
    });
  }
  private loadCat(name: string): Promise<void> {   /* 状态图可缺，缺则 null（运行时降级） */
    return new Promise(res => {
      resources.load('img/' + name + '/spriteFrame', SpriteFrame, (err, sf) => {
        this.frames[name] = err ? null : sf as SpriteFrame;
        res();
      });
    });
  }
  private loadSfx(name: string): Promise<void> {
    return new Promise(res => {
      resources.load('audio/' + name, AudioClip, (err, clip) => {
        this.clips[name] = err ? null : clip as AudioClip;
        res();
      });
    });
  }
  private async loadAll() {
    await Promise.all([...IMG.map(n => this.loadImg(n)),
      ...CAT_STATES.map(n => this.loadCat(n)),
      ...SFX.map(n => this.loadSfx(n))]);
    this.loaded = true;
  }
  private play(name: string) {
    if (!this.save.sound) return;
    const c = this.clips[name];
    if (c) this.audioSrc.playOneShot(c, name === 'win' || name === 'lose' ? 0.9 : 0.7);
  }
  private sf(name: string): SpriteFrame | null { return this.frames[name] || null; }

  /* ============ 加载页 ============ */
  private showLoading() {
    this.clearRoot();
    this.addBackground();
    const lb = this.makeLabel('🐱 加载中…', 30, '#a08c76');
    lb.node.setPosition(0, 0, 0);
    this.root.addChild(lb.node);
  }

  /* 全屏平铺背景（Kenney 猫爪印奶油纹，CC0；TILED 失败则纯色兜底由 Graphics 页面元素承担） */
  private addBackground() {
    const f = this.sf('bg_paw');
    if (!f) return;
    const { width: W, height: H } = this.viewSize();
    const bg = this.uiNode('bg');
    bg.addComponent(UITransform).setContentSize(W, H);
    const sp = bg.addComponent(Sprite);
    sp.spriteFrame = f;
    sp.type = Sprite.Type.TILED;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.root.insertChild(bg, 0);
  }

  /* ============ 关卡列表（分页，每页 20 关） ============ */
  private showList() {
    this.clearRoot();
    this.addBackground();
    const W = this.viewSize().width;
    const H = this.viewSize().height;

    /* 标题 + 真猫立绘 */
    const titleRow = this.uiNode('title'); titleRow.setPosition(0, H / 2 - 74, 0); this.root.addChild(titleRow);
    const catIcon = this.makeSprite('cat_idle', 40, 44);
    if (catIcon) { catIcon.setPosition(-86, 2, 0); titleRow.addChild(catIcon); }
    const label = this.makeLabel('猫棋', 46, '#6b5b4e'); label.node.setPosition(-16, 0, 0); titleRow.addChild(label.node);
    const sub = this.makeLabel('每种颜色住一只猫 · 双击猜猫，猜错 2 次就输', 20, '#a08c76');
    sub.node.setPosition(0, H / 2 - 114, 0);
    this.root.addChild(sub.node);

    /* 右上角：玩法 / 设置 */
    const bRules = this.makeIconButton('❓', new Vec3(W / 2 - 100, H / 2 - 46, 0), () => this.showRules(() => { }));
    bRules.name = 'btn-rules';
    this.root.addChild(bRules);
    const bSet = this.makeIconButton('⚙', new Vec3(W / 2 - 48, H / 2 - 46, 0), () => this.showSettings());
    bSet.name = 'btn-settings';
    this.root.addChild(bSet);

    const perPage = 20;
    const pages = Math.ceil(LEVELS.length / perPage);
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const from = this.page * perPage;
    const items = LEVELS.slice(from, from + perPage);
    const cardW = (W - 60 - 4 * 12) / 5, cardH = 96;
    items.forEach((lv: Level, idx: number) => {
      const row = Math.floor(idx / 5), col = idx % 5;
      const x = -W / 2 + 30 + cardW / 2 + col * (cardW + 12);
      const y = H / 2 - 160 - cardH / 2 - row * (cardH + 12);
      const card = this.makeCard(lv, cardW, cardH);
      card.setPosition(x, y, 0);
      this.root.addChild(card);
      tween(card).set({ scale: new Vec3(0.6, 0.6, 1) }).to(0.24, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).delay(idx * 0.015).start();
      card.on(Input.EventType.TOUCH_END, () => {
        if (this.isUnlocked(lv.id)) this.enterLevel(lv.id);
        else { this.play('error'); tween(card).to(0.05, { angle: 4 }).to(0.05, { angle: -4 }).to(0.06, { angle: 0 }).start(); }
      });
    });
    /* 翻页 */
    if (this.page > 0) this.root.addChild(this.makeButton('← 上一页', new Vec3(-W / 2 + 90, -H / 2 + 50, 0), () => { this.page--; this.showList(); }));
    if (this.page < pages - 1) this.root.addChild(this.makeButton('下一页 →', new Vec3(W / 2 - 90, -H / 2 + 50, 0), () => { this.page++; this.showList(); }));

    /* 首次启动：规则页 */
    if (!this.save.rules) this.showRules(() => { this.save.rules = true; this.persist(); });
  }

  private makeCard(lv: Level, w: number, h: number): Node {
    const unlocked = this.isUnlocked(lv.id);
    const n = this.uiNode('card');
    n.addComponent(UITransform).setContentSize(w, h);
    const g = n.addComponent(Graphics);
    g.fillColor = unlocked ? new Color(255, 255, 255, 255) : new Color(244, 238, 229, 255);
    g.roundRect(-w / 2, -h / 2, w, h, 10); g.fill();
    g.lineWidth = 2; g.strokeColor = unlocked ? new Color(240, 223, 200, 255) : new Color(226, 214, 196, 255);
    g.roundRect(-w / 2, -h / 2, w, h, 10); g.stroke();
    const no = this.makeLabel(String(lv.id), 30, unlocked ? '#4a3f35' : '#c9bba8'); no.node.setPosition(0, 24, 0); n.addChild(no.node);
    const nm = this.makeLabel(lv.name, 14, unlocked ? '#a08c76' : '#c9bba8'); nm.node.setPosition(0, 0, 0); n.addChild(nm.node);
    const df = this.makeLabel('难度 ' + lv.difficulty, 14, unlocked ? '#ff8b5e' : '#c9bba8'); df.node.setPosition(0, -22, 0); n.addChild(df.node);
    /* 难度条 */
    const bar = this.uiNode('bar'); bar.addComponent(UITransform).setContentSize(w - 24, 5); bar.setPosition(0, -h / 2 + 12, 0); n.addChild(bar);
    const bg = bar.addComponent(Graphics); bg.fillColor = new Color(240, 228, 210, 255); bg.roundRect(-(w - 24) / 2, -2.5, w - 24, 5, 2.5); bg.fill();
    const fgN = this.uiNode('fg'); fgN.addComponent(UITransform).setContentSize((w - 24) * lv.difficulty / 100, 5); fgN.setPosition(-(w - 24) / 2 + (w - 24) * lv.difficulty / 200, 0, 0); bar.addChild(fgN);
    const fg = fgN.addComponent(Graphics); fg.fillColor = new Color(255, 139, 94, 255); fg.roundRect(-(w - 24) * lv.difficulty / 200, -2.5, (w - 24) * lv.difficulty / 100, 5, 2.5); fg.fill();
    /* 锁 / 星级 */
    if (!unlocked) {
      const lock = this.makeLabel('🔒', 20, '#a08c76'); lock.node.setPosition(w / 2 - 18, h / 2 - 18, 0); n.addChild(lock.node);
    } else {
      const stars = this.save.won[String(lv.id)] || 0;
      for (let k = 0; k < 3; k++) {
        const st = this.makeSprite(k < stars ? 'icon_star' : 'icon_star_empty', 15, 15, undefined, k < stars ? '#ffcf5c' : undefined);
        if (st) { st.setPosition(w / 2 - 34 + k * 19, h / 2 - 16, 0); n.addChild(st); }
      }
    }
    return n;
  }

  /* ============ 游戏页 ============ */
  private enterLevel(id: number) {
    const lv = LEVELS.find((l: Level) => l.id === id);
    if (!lv || !this.isUnlocked(id)) return;
    this.level = lv;
    this.manualX.clear();
    this.sysState.clear();
    this.cells = [];
    this.fails = 0; this.won = false; this.failed = false; this.hints = 0;
    this.lastTap = { i: -1, t: 0 };
    this.showGame();
  }

  private showGame() {
    this.clearRoot();
    this.addBackground();
    const n = this.level.size;
    const { width: W, height: H } = this.viewSize();
    this.boardPx = Math.min(W - 24, H - 210);
    this.cellPx = Math.floor(this.boardPx / n);
    this.boardPx = this.cellPx * n;

    this.infoLabel = this.makeLabel('', 20, '#8a7560');
    this.infoLabel.node.setPosition(0, H / 2 - 40, 0);
    this.root.addChild(this.infoLabel.node);
    /* 猜错计数（两枚叉图标：灰=剩余机会，红=已用） */
    this.failIcons = [];
    for (let k = 0; k < 2; k++) {
      const ic = this.makeSprite('icon_cross', 20, 20);
      if (ic) {
        ic.setPosition(-W / 2 + 52 + k * 26, H / 2 - 40, 0);
        this.root.addChild(ic);
        this.failIcons.push(ic.getComponent(Sprite) as Sprite);
      }
    }

    /* 工具栏（贴图按钮） */
    this.root.addChild(this.makeButton('列表', new Vec3(-W / 2 + 82, H / 2 - 85, 0), () => this.showList(), { icon: 'icon_back', w: 132 }));
    this.root.addChild(this.makeButton('重置', new Vec3(0, H / 2 - 85, 0), () => { this.enterLevel(this.level.id); }, { icon: 'icon_reset', w: 116 }));
    this.root.addChild(this.makeButton('提示', new Vec3(W / 2 - 82, H / 2 - 85, 0), () => this.showHint(), { accent: true, w: 116 }));

    /* 棋盘 */
    const board = this.uiNode('board');
    board.addComponent(UITransform).setContentSize(this.boardPx, this.boardPx);
    board.setPosition(0, -30, 0);
    this.root.addChild(board);
    const g = board.addComponent(Graphics);
    g.fillColor = new Color(107, 91, 78, 255);
    g.roundRect(-this.boardPx / 2 - 3, -this.boardPx / 2 - 3, this.boardPx + 6, this.boardPx + 6, 6); g.fill();

    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const cell = this.uiNode('cell');
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
      const hl = this.uiNode('hl');
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
        this.play('click');
        this.gesture = { i, moved: false };
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
      if (!g.moved && g.tapOff && this.manualX.has(i)) this.manualX.delete(i);
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
      this.play('place');
      if (Math.random() < 0.25) this.play('meow');   /* 随机喵叫彩蛋 */
      if (Array.from(this.sysState.values()).filter(v => v === 'cat').length === lv.size && !this.won) this.onWin();
    } else {
      this.sysState.set(i, 'x');
      this.fails++;
      this.animWrong(i);
      this.play('error');
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
  private catNode(i: number): Node {     /* 猫 sprite 节点（缺图兜底回 emoji 🐱） */
    const cell = this.cells[i];
    const old = cell.node.getChildByName('cat');
    if (old) old.destroy();
    const cat = this.makeSprite('cat_idle', this.cellPx * 0.8, this.cellPx * 0.8, 'cat');
    if (cat) {
      cell.node.addChild(cat);
      cell.glyph.string = '';
      return cat;
    }
    cell.glyph.string = '🐱';
    return cell.glyph.node;
  }
  private animCat(i: number) {           /* 猫空中落下 + 弹跳 + 光圈 */
    const cell = this.cells[i];
    const cat = this.catNode(i);
    cat.setPosition(0, this.cellPx * 1.1, 0);
    cat.setScale(1.25, 1.25, 1);
    tween(cat)
      .to(0.22, { position: new Vec3(0, 0, 0), scale: new Vec3(0.72, 0.62, 1) }, { easing: 'quadIn' })
      .to(0.16, { scale: new Vec3(0.82, 0.82, 1) }, { easing: 'backOut' })
      .start();
    const ring = this.uiNode('ring');
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
    const flash = this.uiNode('flash');
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
  private setCatsState(state: 'happy' | 'hurt' | 'dead') {   /* 胜/负时全猫换状态（缺图降级变形+表情标记） */
    this.sysState.forEach((v, i) => {
      if (v !== 'cat') return;
      const cell = this.cells[i];
      const cat = cell.node.getChildByName('cat');
      if (!cat) return;
      const sp = cat.getComponent(Sprite) as Sprite;
      const next = this.sf('cat_' + state);
      if (next && sp) { sp.spriteFrame = next; return; }
      if (state === 'happy') {
        tween(cat).repeat(2, tween(cat).to(0.12, { position: new Vec3(0, this.cellPx * 0.15, 0) }).to(0.12, { position: Vec3.ZERO })).start();
        this.markCat(i, '✨', '#ffb703');
      } else {
        cat.angle = state === 'dead' ? 90 : 20;
        if (sp) sp.color = new Color(190, 185, 180, 255);
        this.markCat(i, '💫', '#8a7560');
      }
    });
  }
  private markCat(i: number, glyph: string, color: string) {   /* 缺状态图时的表情标记（头顶 emoji） */
    const cell = this.cells[i];
    if (cell.node.getChildByName('mark')) return;
    const mk = this.makeLabel(glyph, Math.max(14, Math.floor(this.cellPx * 0.38)), color);
    mk.node.name = 'mark';
    mk.node.setPosition(0, this.cellPx * 0.45, 0);
    cell.node.addChild(mk.node);
  }

  private onWin() {
    this.won = true;
    const stars = this.starsFor(this.fails, this.hints);
    if ((this.save.won[String(this.level.id)] || 0) < stars) { this.save.won[String(this.level.id)] = stars; this.persist(); }
    this.setCatsState('happy');
    this.play('win');
    this.showWinOverlay(stars);
    this.confetti();
  }
  private onFail() {
    this.failed = true;
    this.setCatsState('dead');
    this.play('lose');
    this.showOverlay('😿', '猜错 2 次，这局输了', '先用 ✕ 标出没有猫的格子，善用提示再来', () => this.enterLevel(this.level.id), '再试一次');
  }

  private showWinOverlay(stars: number) {
    const { width: W } = this.viewSize();
    const mask = this.makeMask();
    const card = this.uiNode('win-card');
    const cw = Math.min(460, W - 40);
    card.addComponent(UITransform).setContentSize(cw, 280);
    const cg = card.addComponent(Graphics);
    cg.fillColor = new Color(255, 255, 255, 255);
    cg.roundRect(-cw / 2, -140, cw, 280, 16); cg.fill();
    /* 星级（金色弹跳入场） */
    for (let k = 0; k < 3; k++) {
      const st = this.makeSprite(k < stars ? 'icon_star' : 'icon_star_empty', 44, 44, undefined, k < stars ? '#ffcf5c' : undefined);
      if (st) {
        st.setPosition((k - 1) * 58, 82, 0);
        st.setScale(0, 0, 1);
        card.addChild(st);
        tween(st).delay(0.15 + k * 0.18).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
      }
    }
    const t = this.makeLabel('找到全部猫咪！', 30, '#4a3f35'); t.node.setPosition(0, 28, 0); card.addChild(t.node);
    const b = this.makeLabel('难度 ' + this.level.difficulty + ' · 猜错 ' + this.fails + '/2 · 提示 ' + this.hints + ' 次', 18, '#a08c76');
    b.node.setPosition(0, -8, 0); card.addChild(b.node);
    const next = LEVELS.find((l: Level) => l.id === this.level.id + 1);
    card.addChild(this.makeButton(next ? '下一关 →' : '回到列表', new Vec3(0, -88, 0), () => { mask.destroy(); if (next) this.enterLevel(next.id); else this.showList(); }, { accent: true }));
    card.setScale(0.6, 0.6, 1);
    mask.addChild(card);
    tween(card).to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  private confetti() {                   /* 全屏彩纸（程序化小方块，零纹理） */
    const { width: W, height: H } = this.viewSize();
    const colors = ['#F7C6D2', '#FCE38A', '#B8E6B0', '#AED6F5', '#F5A9A0', '#D9C4EE'];
    for (let k = 0; k < 40; k++) {
      const p = this.uiNode('confetti');
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
    this.play('hint');
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
    this.showOverlay('💡', '单步提示', text, () => { }, '知道了', true);
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
    this.failIcons.forEach((sp, k) => {
      if (sp) sp.color = k < this.fails ? new Color(217, 95, 67, 255) : new Color(216, 205, 190, 255);
    });
  }

  /* ============ 规则页 / 设置页 ============ */
  private showRules(after: () => void) {
    this.showOverlay('🐱', '怎么玩', '· 每种颜色住一只猫，每行每列也各一只\n' +
      '· 两只猫不能挨在一起（斜角也算挨着）\n' +
      '· 点一下格子：标 ✕（这里没有猫）\n' +
      '· 再点一下取消；按住拖动连着标\n' +
      '· 双击：猜猫在这！猜错 2 次就输\n' +
      '· 卡住了就点「提示」', () => { after(); }, '知道了');
  }

  private showSettings() {
    const { width: W } = this.viewSize();
    const mask = this.makeMask();
    const card = this.uiNode('set-card');
    const cw = Math.min(420, W - 40);
    card.addComponent(UITransform).setContentSize(cw, 300);
    const cg = card.addComponent(Graphics);
    cg.fillColor = new Color(255, 255, 255, 255);
    cg.roundRect(-cw / 2, -150, cw, 300, 16); cg.fill();
    const t = this.makeLabel('设置', 30, '#4a3f35'); t.node.setPosition(0, 112, 0); card.addChild(t.node);
    /* 音效开关 */
    const sndBtn = this.uiNode('snd'); sndBtn.addComponent(UITransform).setContentSize(cw - 60, 56); sndBtn.setPosition(0, 40, 0); card.addChild(sndBtn);
    const redrawSnd = () => {
      sndBtn.removeAllChildren();
      const sg = sndBtn.getComponent(Graphics) || sndBtn.addComponent(Graphics);
      sg.fillColor = new Color(247, 242, 234, 255); sg.roundRect(-(cw - 60) / 2, -28, cw - 60, 56, 12); sg.fill();
      const icon = this.makeSprite(this.save.sound ? 'icon_sound_on' : 'icon_sound_off', 30, 30);
      if (icon) { icon.setPosition(-(cw - 60) / 2 + 40, 0, 0); sndBtn.addChild(icon); }
      const lb = this.makeLabel('音效：' + (this.save.sound ? '开' : '关'), 22, '#6b5b4e');
      lb.node.setPosition(14, 0, 0); sndBtn.addChild(lb.node);
    };
    redrawSnd();
    sndBtn.on(Input.EventType.TOUCH_END, () => {
      this.save.sound = !this.save.sound; this.persist(); redrawSnd(); this.play('toggle');
    });
    /* 重置进度（两步确认） */
    let armed = false;
    const rstBtn = this.uiNode('rst'); rstBtn.addComponent(UITransform).setContentSize(cw - 60, 56); rstBtn.setPosition(0, -30, 0); card.addChild(rstBtn);
    const redrawRst = () => {
      rstBtn.removeAllChildren();
      const rg = rstBtn.addComponent(Graphics);
      rg.fillColor = armed ? new Color(229, 83, 60, 255) : new Color(247, 242, 234, 255);
      rg.roundRect(-(cw - 60) / 2, -28, cw - 60, 56, 12); rg.fill();
      const lb = this.makeLabel(armed ? '再按一次确认清空' : '重置全部进度', 22, armed ? '#ffffff' : '#6b5b4e');
      lb.node.setPosition(0, 0, 0); rstBtn.addChild(lb.node);
    };
    redrawRst();
    rstBtn.on(Input.EventType.TOUCH_END, () => {
      this.play('click');
      if (!armed) { armed = true; redrawRst(); return; }
      this.save.won = {}; this.persist(); armed = false; redrawRst();
      this.page = 0; this.showList();
    });
    /* 关于 */
    const about = this.makeLabel('猫棋 1.0 · 素材：Kenney(CC0) · OpenGameArt(CC0) · AI 生成', 15, '#c9bba8');
    about.node.setPosition(0, -108, 0); card.addChild(about.node);
    card.addChild(this.makeButton('关闭', new Vec3(0, -95 - 55, 0), () => mask.destroy(), { accent: true }));
    card.setScale(0.6, 0.6, 1);
    mask.addChild(card);
    tween(card).to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  /* 运行时创建的节点必须显式挂 UI_2D 层，否则相机（visibility=UI_2D）一个都不会画 */
  private uiNode(name: string): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    return n;
  }

  /* ============ 基础 UI 工具 ============ */
  private clearRoot() { this.root.removeAllChildren(); this.audioSrc.stop(); }
  private viewSize() { return view.getVisibleSize(); }   /* Boot 节点不保证是 Canvas，直接取可视区尺寸 */
  private hexColor(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  private makeLabel(text: string, size: number, color: string): Label {
    const n = this.uiNode('label');
    n.addComponent(UITransform);
    const lb = n.addComponent(Label);
    lb.string = text; lb.fontSize = size; lb.lineHeight = size * 1.3;
    lb.color = new Color(this.hexColor(color)[0], this.hexColor(color)[1], this.hexColor(color)[2], 255);
    return lb;
  }
  private makeSprite(img: string, w: number, h: number, name?: string, tint?: string): Node | null {
    const f = this.sf(img);
    if (!f) return null;
    const n = this.uiNode(name || ('img-' + img));
    n.addComponent(UITransform).setContentSize(w, h);
    const sp = n.addComponent(Sprite);
    sp.type = Sprite.Type.SIMPLE;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = f;
    if (tint) sp.color = new Color(this.hexColor(tint)[0], this.hexColor(tint)[1], this.hexColor(tint)[2], 255);
    return n;
  }
  /* 贴图按钮：普通态/按下态换图 + 可选图标 */
  private makeButton(text: string, pos: Vec3, cb: () => void, opts: { accent?: boolean; icon?: string; w?: number } = {}): Node {
    const w = opts.w || 128, h = 44;
    const n = this.uiNode('btn');
    n.addComponent(UITransform).setContentSize(w, h);
    const normal = this.sf(opts.accent ? 'btn_accent' : 'btn_primary');
    const pressed = this.sf(opts.accent ? 'btn_accent_pressed' : 'btn_primary_pressed');
    const sp = n.addComponent(Sprite);
    if (normal) { sp.spriteFrame = normal; sp.type = Sprite.Type.SIMPLE; sp.sizeMode = Sprite.SizeMode.CUSTOM; }
    else {
      const g = n.addComponent(Graphics);
      g.fillColor = opts.accent ? new Color(255, 157, 104, 255) : new Color(255, 255, 255, 255);
      g.roundRect(-w / 2, -h / 2, w, h, 10); g.fill();
    }
    let lx = 0;
    if (opts.icon) {
      const ic = this.makeSprite(opts.icon, 22, 22);
      if (ic) { ic.setPosition(-w / 2 + 30, 0, 0); n.addChild(ic); lx = 10; }
    }
    const lb = this.makeLabel(text, 20, opts.accent ? '#ffffff' : '#6b5b4e');
    lb.node.setPosition(lx, 0, 0);
    n.addChild(lb.node);
    n.setPosition(pos.x, pos.y, pos.z);
    n.on(Input.EventType.TOUCH_START, () => { if (pressed && sp) sp.spriteFrame = pressed; });
    n.on(Input.EventType.TOUCH_END, () => {
      if (normal && sp) sp.spriteFrame = normal;
      this.play('click');
      tween(n).to(0.08, { scale: new Vec3(0.92, 0.92, 1) }).to(0.08, { scale: new Vec3(1, 1, 1) }).start();
      cb();
    });
    n.on(Input.EventType.TOUCH_CANCEL, () => { if (normal && sp) sp.spriteFrame = normal; });
    return n;
  }
  /* 圆形小图标按钮（列表页 右上角） */
  private makeIconButton(glyph: string, pos: Vec3, cb: () => void): Node {
    const n = this.uiNode('icon-btn');
    n.addComponent(UITransform).setContentSize(44, 44);
    const f = this.sf('btn_round');
    if (f) {
      const sp = n.addComponent(Sprite);
      sp.spriteFrame = f; sp.type = Sprite.Type.SIMPLE; sp.sizeMode = Sprite.SizeMode.CUSTOM;
    } else {
      const g = n.addComponent(Graphics);
      g.fillColor = new Color(255, 255, 255, 255); g.circle(0, 0, 22); g.fill();
    }
    const lb = this.makeLabel(glyph, 22, '#6b5b4e');
    n.addChild(lb.node);
    n.setPosition(pos.x, pos.y, pos.z);
    n.on(Input.EventType.TOUCH_END, () => { this.play('click'); tween(n).to(0.08, { scale: new Vec3(0.9, 0.9, 1) }).to(0.08, { scale: new Vec3(1, 1, 1) }).start(); cb(); });
    return n;
  }
  private makeMask(): Node {
    const { width: W, height: H } = this.viewSize();
    const mask = this.uiNode('mask');
    mask.addComponent(UITransform).setContentSize(W * 2, H * 2);
    const mg = mask.addComponent(Graphics);
    mg.fillColor = new Color(60, 46, 32, 120);
    mg.fillRect(-W, -H, W * 2, H * 2); mg.fill();
    const mop = mask.addComponent(UIOpacity);
    mop.opacity = 0;
    this.root.addChild(mask);
    this.activeMask = mask;
    tween(mop).to(0.2, { opacity: 255 }).start();
    return mask;
  }
  private showOverlay(big: string, title: string, body: string, cb: () => void, btnText: string, infoOnly = false) {
    const { width: W } = this.viewSize();
    const mask = this.makeMask();
    const card = this.uiNode('card');
    const cw = Math.min(460, W - 40);
    card.addComponent(UITransform).setContentSize(cw, 380);
    const cg = card.addComponent(Graphics);
    cg.fillColor = new Color(255, 255, 255, 255);
    cg.roundRect(-cw / 2, -190, cw, 380, 16); cg.fill();
    const bigLb = this.makeLabel(big, 48, '#4a3f35'); bigLb.node.setPosition(0, 122, 0); card.addChild(bigLb.node);
    const t = this.makeLabel(title, 26, '#4a3f35'); t.node.setPosition(0, 68, 0); card.addChild(t.node);
    const b = this.makeLabel(body, 17, '#a08c76');
    b.lineHeight = 24;
    b.overflow = Label.Overflow.SHRINK;
    b.node.getComponent(UITransform)!.setContentSize(cw - 56, 220);
    b.node.setPosition(0, -22, 0);
    card.addChild(b.node);
    card.addChild(this.makeButton(btnText, new Vec3(0, -152, 0), () => { mask.destroy(); if (!infoOnly) cb(); }, { accent: true }));
    card.setScale(0.6, 0.6, 1);
    mask.addChild(card);
    tween(card).to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
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
      stars: () => self.save.won,
      save: () => self.save,
      setSound: (on: boolean) => { self.save.sound = on; self.persist(); },
      unlocked: () => LEVELS.filter((l: Level) => self.isUnlocked(l.id)).map((l: Level) => l.id),
      ready: () => self.loaded,
      backToList: () => { self.showList(); return true; },
      closeOverlay: () => { if (self.activeMask) { self.activeMask.destroy(); self.activeMask = null; return true; } return false; },
      background: () => !!self.sf('bg_paw'),
      state: () => ({ manualX: Array.from(self.manualX), sys: Array.from(self.sysState.entries()), fails: self.fails, won: self.won, failed: self.failed }),
      tap: (r: number, c: number) => { const i = r * self.level.size + c; if (!self.sysState.has(i)) { if (!self.manualX.has(i)) { self.manualX.add(i); self.animMark(i); } } },
      dbltap: (r: number, c: number) => { const i = r * self.level.size + c; self.manualX.delete(i); self.judge(i); },
    };
  }
  start() { this.ensureDriver(); }
  protected update(): void {
    if (Math.abs(view.getVisibleSize().height - this.lastOrtho) > 0.5) this.syncCamera();   /* 旋转/窗口变化时保持相机对齐 */
  }
}
