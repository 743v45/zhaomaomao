/* 猫棋 · Cocos Creator 动画版 —— 贴图 UI + 真猫 sprite + 音效/BGM + 存档/解锁/星级
 * 交互与原生版同构：单击标 ✕（人工笔记）/ 拖动连标 / 双击判定猫（判错计失败，2 次失败）。
 * 引擎与关卡数据由 npm run build 同步（单一来源），本文件只负责渲染、交互、动画与音频。
 * 资源：resources/img（Kenney UI Pack CC0 + AI 猫 + 站酷快乐体子集）、resources/audio（Kenney CC0，mp3）。
 * 性能约束：棋盘全部色块/边界画在 board 的单个 Graphics 上（1 dc）；✕/高亮/猫等渲染件按需惰性创建。
 * 猫四态：cat_idle 必备；cat_happy/cat_hurt/cat_dead 缺失时自动降级为 idle+变形动画（出图后直接热替换）。
 * 场景里挂这一个组件即可（assets/scenes/main.scene）。 */
import { _decorator, Component, Node, Label, Graphics, UITransform, Color, Vec3, tween, Tween, UIOpacity, Input, sys, Sprite, SpriteFrame, resources, AudioClip, AudioSource, view, Layers, ResolutionPolicy, Canvas, Camera, director, Font } from 'cc';
const { ccclass } = _decorator;

import CatChessMod from './engine/index';
import { LEVELS } from './levels-data';

const CatChess: any = CatChessMod;
type Level = any;

interface Cell { node: Node; xIcon: Node | null; hl: Node | null; r: number; c: number; }
interface SaveData { won: Record<string, number>; sound: boolean; music: boolean; rules: boolean; page: number; }

const SAVE_KEY = 'zmm_cocos_v1';
const IMG = ['btn_primary', 'btn_primary_pressed', 'btn_accent', 'btn_accent_pressed', 'btn_round',
  'icon_star', 'icon_star_empty', 'icon_cross', 'icon_back', 'icon_reset', 'icon_gear',
  'icon_sound_on', 'icon_sound_off', 'cat_idle', 'bg_paw'];
const CAT_STATES = ['cat_idle', 'cat_happy', 'cat_hurt', 'cat_dead'];
const SFX = ['click', 'tick', 'place', 'error', 'hint', 'star', 'win', 'lose', 'meow', 'toggle', 'bgm'];

const INK = '#4a3f35', SUB = '#a08c76', FAINT = '#c9bba8', GOLD = '#ffcf5c', RED = '#d95f43';

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
  private activeHls: { node: Node; op: UIOpacity; timer?: number }[] = [];
  private activeMask: Node | null = null;
  private loaded = false;
  private uiCam: Camera | null = null;
  private lastOrtho = 0;
  private toast: Node | null = null;

  private frames: Record<string, SpriteFrame | null> = {};
  private clips: Record<string, AudioClip | null> = {};
  private audioSrc: AudioSource = null!;
  private bgmSrc: AudioSource | null = null;
  private bgmOn = false;
  private save: SaveData = { won: {}, sound: true, music: true, rules: false, page: 0 };
  private uiFont: Font | null = null;

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
        this.save = { won: d.won || {}, sound: d.sound !== false, music: d.music !== false, rules: !!d.rules, page: d.page || 0 };
      }
    } catch (e) { /* 损坏存档按新档处理 */ }
  }
  private persist() {
    try { sys.localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* 忽略 */ }
  }
  private isUnlocked(id: number): boolean { return id <= 1 || !!this.save.won[String(id - 1)]; }
  private starsFor(fails: number, hints: number): number { return Math.max(1, Math.min(3, 3 - fails - (hints > 0 ? 1 : 0))); }
  private totalStars(): number { return Object.values(this.save.won).reduce((a, b) => a + b, 0); }
  private wonCount(): number { return Object.keys(this.save.won).length; }
  private firstUnfinished(): Level | null { return LEVELS.find((l: Level) => !this.save.won[String(l.id)]) || null; }

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
    return this.loadImg(name);
  }
  private loadSfx(name: string): Promise<void> {
    return new Promise(res => {
      resources.load('audio/' + name, AudioClip, (err, clip) => {
        this.clips[name] = err ? null : clip as AudioClip;
        res();
      });
    });
  }
  private loadFont(): Promise<void> {
    return new Promise(res => {
      resources.load('font/zcool', Font, (err, f) => {
        this.uiFont = err ? null : f as Font;
        res();
      });
    });
  }
  private async loadAll() {
    await Promise.all([...IMG.map(n => this.loadImg(n)),
      ...CAT_STATES.map(n => this.loadCat(n)),
      ...SFX.map(n => this.loadSfx(n)),
      this.loadFont()]);
    this.loaded = true;
  }
  private play(name: string) {
    if (!this.save.sound) return;
    this.ensureBgm();                                /* 首次交互时启动 BGM（autoplay 合规） */
    const c = this.clips[name];
    if (c) this.audioSrc.playOneShot(c, name === 'win' || name === 'lose' ? 0.9 : 0.7);
  }
  private ensureBgm() {
    if (this.bgmOn || !this.save.music) return;
    const c = this.clips['bgm'];
    if (!c) return;                                  /* 曲目未就绪时静默（bgm agent 回填后自动生效） */
    if (!this.bgmSrc) {
      const n = this.uiNode('bgm');
      director.getScene().addChild(n);   /* 挂场景而非 root：翻页 clearRoot 不能断 BGM */
      this.bgmSrc = n.addComponent(AudioSource);
    }
    this.bgmSrc.stop();
    this.bgmSrc.clip = c;
    this.bgmSrc.loop = true;
    this.bgmSrc.volume = 0.32;
    this.bgmSrc.play();
    this.bgmOn = true;
  }
  private stopBgm() {
    if (this.bgmSrc) this.bgmSrc.stop();
    this.bgmOn = false;
  }
  private sf(name: string): SpriteFrame | null { return this.frames[name] || null; }

  /* ============ 加载页 ============ */
  private showLoading() {
    this.clearRoot();
    this.addBackground();
    const lb = this.makeLabel('加载中', 30, SUB);
    lb.node.setPosition(0, 0, 0);
    this.root.addChild(lb.node);
    const dots = this.makeLabel('', 30, SUB);
    dots.node.setPosition(0, -44, 0);
    this.root.addChild(dots.node);
    let k = 0;
    tween(dots.node).repeatForever(tween(dots.node).delay(0.3).call(() => { k = (k + 1) % 4; dots.string = '·'.repeat(k); })).start();
  }

  /* 全页淡入转场（clearRoot 重建内容后调用） */
  private pageFadeIn() {
    const op = this.root.getComponent(UIOpacity) || this.root.addComponent(UIOpacity);
    op.opacity = 0;
    tween(op).to(0.2, { opacity: 255 }).start();
  }

  /* 全屏平铺背景（Kenney 猫爪印奶油纹，CC0） */
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

    /* 标题 + 吉祥物 */
    const titleRow = this.uiNode('title'); titleRow.setPosition(0, H / 2 - 74, 0); this.root.addChild(titleRow);
    const catIcon = this.makeSprite('cat_idle', 40, 44);
    if (catIcon) {
      catIcon.setPosition(-86, 2, 0);
      titleRow.addChild(catIcon);
      tween(catIcon).repeatForever(tween(catIcon)
        .to(1.2, { angle: 6 }, { easing: 'sineInOut' })
        .to(1.2, { angle: -6 }, { easing: 'sineInOut' })).start();
    }
    const label = this.makeLabel('猫棋', 46, INK); label.node.setPosition(-16, 0, 0); titleRow.addChild(label.node);
    const sub = this.makeLabel('每种颜色住一只猫 · 双击猜猫，猜错 2 次就输', 20, SUB);
    sub.node.setPosition(0, H / 2 - 114, 0);
    this.root.addChild(sub.node);

    /* 右上角：玩法 / 设置（贴图圆钮，无 emoji） */
    const bRules = this.makeIconButton('玩法', new Vec3(W / 2 - 104, H / 2 - 46, 0), () => this.showRules(() => { }));
    this.root.addChild(bRules);
    const gear = this.makeIconButton('', new Vec3(W / 2 - 48, H / 2 - 46, 0), () => this.showSettings());
    const gIc = this.makeSprite('icon_gear', 24, 24);
    if (gIc) { gIc.setPosition(0, 0, 0); gear.addChild(gIc); } else { gear.addChild(this.makeLabel('设置', 13, '#6b5b4e').node); }
    this.root.addChild(gear);

    /* 总进度（通关 X/100 · ★ Y/300）+ 继续按钮 */
    const total = LEVELS.length, won = this.wonCount(), stars = this.totalStars();
    const prog = this.makeLabel(`已通关 ${won}/${total} · ★ ${stars}/${total * 3}`, 18, SUB);
    prog.node.setPosition(0, H / 2 - 150, 0);
    this.root.addChild(prog.node);
    const next = this.firstUnfinished();
    if (next) {
      const cont = this.makeButton(`继续 · 第 ${next.id} 关`, new Vec3(0, H / 2 - 196, 0), () => this.enterLevel(next.id), { accent: true, w: 220 });
      this.root.addChild(cont);
    }

    const perPage = 20;
    const pages = Math.ceil(LEVELS.length / perPage);
    this.page = Math.max(0, Math.min(this.save.page || 0, pages - 1));
    const from = this.page * perPage;
    const items = LEVELS.slice(from, from + perPage);
    const gridTop = H / 2 - 250;
    const cardW = (W - 60 - 4 * 12) / 5, cardH = 108;
    items.forEach((lv: Level, idx: number) => {
      const row = Math.floor(idx / 5), col = idx % 5;
      const x = -W / 2 + 30 + cardW / 2 + col * (cardW + 12);
      const y = gridTop - cardH / 2 - row * (cardH + 14);
      const card = this.makeCard(lv, cardW, cardH);
      card.setPosition(x, y, 0);
      this.root.addChild(card);
      const op = card.addComponent(UIOpacity);
      op.opacity = 0;
      tween(card).set({ scale: new Vec3(0.6, 0.6, 1) }).delay(idx * 0.02).to(0.24, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
      tween(op).delay(idx * 0.02).to(0.2, { opacity: 255 }).start();
      card.on(Input.EventType.TOUCH_END, () => {
        if (this.isUnlocked(lv.id)) this.enterLevel(lv.id);
        else {
          this.play('error');
          tween(card).to(0.05, { angle: 4 }).to(0.05, { angle: -4 }).to(0.06, { angle: 0 }).start();
          this.showToast('先通过上一关来解锁');
        }
      });
    });
    /* 翻页 + 页码 */
    const pageLabel = this.makeLabel(`第 ${this.page + 1}/${pages} 页`, 18, SUB);
    pageLabel.node.setPosition(0, -H / 2 + 50, 0);
    this.root.addChild(pageLabel.node);
    if (this.page > 0) {
      const prev = this.makeButton('上一页', new Vec3(-W / 2 + 100, -H / 2 + 50, 0), () => { this.save.page = this.page - 1; this.persist(); this.showList(); }, { icon: 'icon_back', w: 132 });
      this.root.addChild(prev);
    }
    if (this.page < pages - 1) {
      const nx = this.makeButton('下一页', new Vec3(W / 2 - 100, -H / 2 + 50, 0), () => { this.save.page = this.page + 1; this.persist(); this.showList(); }, { w: 132 });
      nx.angle = 180;
      nx.getChildByName('label')!.angle = -180;   /* 箭头随钮翻转，文字回正 */
      this.root.addChild(nx);
    }

    /* 首次启动：规则页 */
    if (!this.save.rules) this.showRules(() => { this.save.rules = true; this.persist(); });
    this.pageFadeIn();
  }

  private makeCard(lv: Level, w: number, h: number): Node {
    const unlocked = this.isUnlocked(lv.id);
    const n = this.uiNode('card');
    n.addComponent(UITransform).setContentSize(w, h);
    const g = n.addComponent(Graphics);
    g.fillColor = unlocked ? new Color(255, 255, 255, 255) : new Color(244, 238, 229, 150);
    g.roundRect(-w / 2, -h / 2, w, h, 10); g.fill();
    g.lineWidth = 2; g.strokeColor = unlocked ? new Color(240, 223, 200, 255) : new Color(226, 214, 196, 120);
    g.roundRect(-w / 2, -h / 2, w, h, 10); g.stroke();
    const no = this.makeLabel(String(lv.id), 30, unlocked ? INK : FAINT); no.node.setPosition(0, 26, 0); n.addChild(no.node);
    const nm = this.makeLabel(lv.name, 14, unlocked ? SUB : FAINT); nm.node.setPosition(0, 0, 0); n.addChild(nm.node);
    const df = this.makeLabel('难度 ' + lv.difficulty, 14, unlocked ? SUB : FAINT); df.node.setPosition(0, -24, 0); n.addChild(df.node);
    /* 难度条（对数感：/50 封顶） */
    const barW = w - 24;
    const bar = this.uiNode('bar'); bar.addComponent(UITransform).setContentSize(barW, 8); bar.setPosition(0, -h / 2 + 14, 0); n.addChild(bar);
    const bg = bar.addComponent(Graphics); bg.fillColor = new Color(240, 228, 210, 255); bg.roundRect(-barW / 2, -4, barW, 8, 4); bg.fill();
    const ratio = Math.min(1, lv.difficulty / 50);
    const fgN = this.uiNode('fg'); fgN.addComponent(UITransform).setContentSize(barW * ratio, 8); fgN.setPosition(-barW / 2 + barW * ratio / 2, 0, 0); bar.addChild(fgN);
    const fg = fgN.addComponent(Graphics); fg.fillColor = new Color(255, 139, 94, 255); fg.roundRect(-barW * ratio / 2, -4, barW * ratio, 8, 4); fg.fill();
    /* 锁 / 星级 */
    if (!unlocked) {
      const lock = this.makeLabel('🔒', 20, SUB); lock.node.setPosition(w / 2 - 18, h / 2 - 18, 0); n.addChild(lock.node);
    } else {
      const stars = this.save.won[String(lv.id)] || 0;
      for (let k = 0; k < 3; k++) {
        const st = this.makeSprite(k < stars ? 'icon_star' : 'icon_star_empty', 18, 18, undefined, k < stars ? GOLD : undefined);
        if (st) { st.setPosition(w / 2 - 40 + k * 21, h / 2 - 17, 0); n.addChild(st); }
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
    this.activeHls.forEach(h => clearTimeout(h.timer));
    this.activeHls = [];
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

    this.infoLabel = this.makeLabel('', 19, '#8a7560');
    this.infoLabel.node.setPosition(0, H / 2 - 40, 0);
    this.root.addChild(this.infoLabel.node);
    /* 猜错计数（两枚叉图标：淡=剩余机会，红=已用） */
    this.failIcons = [];
    for (let k = 0; k < 2; k++) {
      const ic = this.makeSprite('icon_cross', 20, 20);
      if (ic) {
        ic.setPosition(-W / 2 + 52 + k * 26, H / 2 - 40, 0);
        const sp = ic.getComponent(Sprite) as Sprite;
        sp.color = new Color(216, 205, 190, 255);
        const op = ic.addComponent(UIOpacity); op.opacity = 70;
        this.root.addChild(ic);
        this.failIcons.push(sp);
      }
    }

    /* 工具栏（贴图按钮，滑入 stagger） */
    const btnBack = this.makeButton('列表', new Vec3(-W / 2 + 82, H / 2 - 85, 0), () => this.showList(), { icon: 'icon_back', w: 132 });
    const btnReset = this.makeButton('重置', new Vec3(0, H / 2 - 85, 0), () => { this.enterLevel(this.level.id); }, { icon: 'icon_reset', w: 116 });
    const btnHint = this.makeButton('提示', new Vec3(W / 2 - 82, H / 2 - 85, 0), () => this.showHint(), { accent: true, w: 116 });
    [btnBack, btnReset, btnHint].forEach((b, k) => {
      const y0 = b.position.y;
      b.setPosition(b.position.x, y0 + 46, 0);
      this.root.addChild(b);
      tween(b).delay(0.06 * k).to(0.24, { position: new Vec3(b.position.x, y0, 0) }, { easing: 'backOut' }).start();
    });

    /* 棋盘：单 Graphics 画全部色块+边界（1 dc，20×20 也不怕） */
    const board = this.uiNode('board');
    board.addComponent(UITransform).setContentSize(this.boardPx, this.boardPx);
    board.setPosition(0, -30, 0);
    this.root.addChild(board);
    const g = board.addComponent(Graphics);
    g.fillColor = new Color(107, 91, 78, 255);
    g.roundRect(-this.boardPx / 2 - 3, -this.boardPx / 2 - 3, this.boardPx + 6, this.boardPx + 6, 6); g.fill();
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const [hexR, hexG, hexB] = this.hexColor(CatChess.PALETTE[this.level.regionColors[this.level.regions[i]]][0]);
      const cx = -this.boardPx / 2 + this.cellPx * (c + 0.5), cy = this.boardPx / 2 - this.cellPx * (r + 0.5);
      g.fillColor = new Color(hexR, hexG, hexB, 255);
      g.fillRect(cx - this.cellPx / 2, cy - this.cellPx / 2, this.cellPx, this.cellPx);
      g.lineWidth = 0.5; g.strokeColor = new Color(107, 91, 78, 70);
      g.rect(cx - this.cellPx / 2, cy - this.cellPx / 2, this.cellPx, this.cellPx); g.stroke();
      const isBr = c + 1 < n && this.level.regions[i] !== this.level.regions[i + 1];
      const isBb = r + 1 < n && this.level.regions[i] !== this.level.regions[i + n];
      g.lineWidth = 2.5; g.strokeColor = new Color(107, 91, 78, 255);
      if (isBr) { g.moveTo(cx + this.cellPx / 2, cy - this.cellPx / 2); g.lineTo(cx + this.cellPx / 2, cy + this.cellPx / 2); g.stroke(); }
      if (isBb) { g.moveTo(cx - this.cellPx / 2, cy - this.cellPx / 2); g.lineTo(cx + this.cellPx / 2, cy - this.cellPx / 2); g.stroke(); }
      /* 逻辑格：只挂 UITransform，无渲染组件（惰性件按需创建） */
      const cell = this.uiNode('cell');
      cell.addComponent(UITransform).setContentSize(this.cellPx, this.cellPx);
      cell.setPosition(cx, cy, 0);
      board.addChild(cell);
      this.cells.push({ node: cell, xIcon: null, hl: null, r, c });
    }
    board.setScale(0.7, 0.7, 1);
    tween(board).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

    board.on(Input.EventType.TOUCH_START, (e: any) => this.onTouch(e, 'start'), this);
    board.on(Input.EventType.TOUCH_MOVE, (e: any) => this.onTouch(e, 'move'), this);
    board.on(Input.EventType.TOUCH_END, (e: any) => this.onTouch(e, 'end'), this);
    board.on(Input.EventType.TOUCH_CANCEL, (e: any) => this.onTouch(e, 'end'), this);
    this.refreshInfo();
    this.pageFadeIn();
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
        this.markX(i, true);
        this.play('click');
        this.gesture = { i, moved: false };
      } else {
        this.gesture = { i, moved: false, tapOff: true };   /* 原本已有 ✕：松手即取消 */
      }
    } else if (phase === 'move') {
      if (!this.gesture) return;
      if (i >= 0 && i !== this.gesture.i) this.gesture.moved = true;
      if (this.gesture.moved && i >= 0 && !this.sysState.has(i) && !this.manualX.has(i)) {
        this.manualX.add(i); this.markX(i, true); this.play('tick');
      }
    } else {
      if (!this.gesture) return;
      const g = this.gesture; this.gesture = null;
      if (i !== g.i) return;
      if (i < 0 || this.sysState.has(i)) return;
      /* 纯单击收尾：原本已有 ✕ 的格恢复空白（再点取消） */
      if (!g.moved && g.tapOff && this.manualX.has(i)) { this.manualX.delete(i); this.clearX(i, true); }
      const now = Date.now();
      if (this.lastTap.i === i && now - this.lastTap.t < 400) {
        this.lastTap = { i: -1, t: 0 };
        this.manualX.delete(i);
        this.clearX(i, true);
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

  /* ============ 惰性渲染件 ============ */
  private markX(i: number, manual: boolean) {    /* ✕ 标记：笔记=暖灰 / 系统判错=红，缩放入场（icon 惰性创建） */
    const cell = this.cells[i];
    if (!cell.xIcon) {
      cell.xIcon = this.makeSprite('icon_cross', Math.floor(this.cellPx * 0.42), Math.floor(this.cellPx * 0.42), 'x-icon');
      if (cell.xIcon) cell.node.addChild(cell.xIcon);
    }
    if (cell.xIcon) {
      const sp = cell.xIcon.getComponent(Sprite) as Sprite;
      sp.color = manual ? new Color(122, 108, 92, 255) : new Color(217, 95, 67, 255);
      cell.xIcon.active = true;
      cell.xIcon.setScale(0.2, 0.2, 1);
      cell.xIcon.angle = manual ? -8 : 8;
      tween(cell.xIcon).to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    }
  }
  private clearX(i: number, animate = false) {   /* 取消笔记 ✕（缩退后再隐藏） */
    const cell = this.cells[i];
    const x = cell.xIcon;
    if (!x || !x.active) return;
    if (animate) {
      tween(x).to(0.12, { scale: new Vec3(0.1, 0.1, 1) }).call(() => { x.active = false; x.setScale(1, 1, 1); }).start();
    } else {
      x.active = false;
      x.setScale(1, 1, 1);
    }
  }
  private hlAt(i: number): { node: Node; op: UIOpacity } {   /* 提示高亮惰性创建 */
    const cell = this.cells[i];
    if (!cell.hl) {
      const hl = this.uiNode('hl');
      hl.addComponent(UITransform).setContentSize(this.cellPx, this.cellPx);
      const g = hl.addComponent(Graphics);
      g.fillColor = new Color(255, 207, 92, 110);
      g.fillRect(-this.cellPx / 2, -this.cellPx / 2, this.cellPx, this.cellPx); g.fill();
      const op = hl.addComponent(UIOpacity);
      cell.node.addChild(hl);
      cell.hl = hl;
    }
    return { node: cell.hl, op: cell.hl.getComponent(UIOpacity)! };
  }
  private clearHints() {
    this.activeHls.forEach(h => { if (h.timer) clearTimeout(h.timer); h.node.active = false; });
    this.activeHls = [];
  }
  private armHints(rcList: number[][]) {
    this.clearHints();
    rcList.slice(0, 12).forEach(rc => {
      const { node, op } = this.hlAt(rc[0] * this.level.size + rc[1]);
      node.active = true;
      op.opacity = 255;
      const timer = window.setTimeout(() => {
        Tween.stopAllByTarget(op);                     /* 停掉脉冲再淡出，两个 tween 不打架 */
        tween(op).to(0.3, { opacity: 0 }).call(() => { node.active = false; }).start();
        this.activeHls = this.activeHls.filter(h => h.node !== node);
      }, 4200);
      this.activeHls.push({ node, op, timer });
      tween(op).repeatForever(tween(op).to(0.5, { opacity: 140 }, { easing: 'sineInOut' }).to(0.5, { opacity: 255 }, { easing: 'sineInOut' })).start();
    });
  }

  /* ============ 动画 ============ */
  private catNode(i: number): Node {     /* 猫 sprite 节点（含脚下阴影；缺图兜底回 emoji 🐱） */
    const cell = this.cells[i];
    const old = cell.node.getChildByName('cat');
    if (old) old.destroy();
    /* 阴影：暖棕椭圆，把猫从同系色块上托出来 */
    const shadow = this.uiNode('cat-shadow');
    shadow.addComponent(UITransform).setContentSize(this.cellPx * 0.72, this.cellPx * 0.18);
    const sg = shadow.addComponent(Graphics);
    sg.fillColor = new Color(107, 91, 78, 40);
    sg.ellipse(0, 0, this.cellPx * 0.36, this.cellPx * 0.09); sg.fill();
    shadow.setPosition(0, -this.cellPx * 0.3, 0);
    cell.node.addChild(shadow);
    const cat = this.makeSprite('cat_idle', this.cellPx * 0.8, this.cellPx * 0.8, 'cat');
    if (cat) {
      cat.setPosition(0, this.cellPx * 0.04, 0);
      cell.node.addChild(cat);
      return cat;
    }
    const lb = this.makeLabel('🐱', Math.floor(this.cellPx * 0.5), '#ffffff');
    cell.node.addChild(lb.node);
    return lb.node;
  }
  private animCat(i: number) {           /* 猫空中落下 + 弹跳 + 呼吸循环 + 光圈 */
    const cell = this.cells[i];
    const cat = this.catNode(i);
    cat.setPosition(0, this.cellPx * 1.1, 0);
    cat.setScale(1.25, 1.25, 1);
    tween(cat)
      .to(0.22, { position: new Vec3(0, this.cellPx * 0.04, 0), scale: new Vec3(0.72, 0.62, 1) }, { easing: 'quadIn' })
      .to(0.16, { scale: new Vec3(0.8, 0.8, 1) }, { easing: 'backOut' })
      .delay(0.25)
      .repeatForever(tween(cat)
        .to(0.85, { scale: new Vec3(0.86, 0.9, 1) }, { easing: 'sineInOut' })
        .to(0.85, { scale: new Vec3(0.8, 0.8, 1) }, { easing: 'sineInOut' }))
      .start();
    const ring = this.uiNode('ring');
    ring.addComponent(UITransform).setContentSize(this.cellPx, this.cellPx);
    const rg = ring.addComponent(Graphics);
    rg.lineWidth = 3; rg.strokeColor = new Color(255, 209, 102, 255);
    rg.circle(0, 0, this.cellPx * 0.36); rg.stroke();
    const rop = ring.addComponent(UIOpacity);
    cell.node.addChild(ring);
    tween(ring).to(0.4, { scale: new Vec3(1.9, 1.9, 1) }).start();
    tween(rop).delay(0.25).to(0.2, { opacity: 0 }).call(() => ring.destroy()).start();
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
    this.markX(i, false);
  }
  private setCatsState(state: 'happy' | 'hurt' | 'dead') {   /* 胜/负时全猫换状态（缺图降级变形+星星标记） */
    this.sysState.forEach((v, i) => {
      if (v !== 'cat') return;
      const cell = this.cells[i];
      const cat = cell.node.getChildByName('cat');
      if (!cat) return;
      const sp = cat.getComponent(Sprite) as Sprite;
      const next = this.sf('cat_' + state);
      if (next && sp) { sp.spriteFrame = next; return; }
      if (state === 'happy') {
        tween(cat).repeat(2, tween(cat).to(0.12, { position: new Vec3(0, this.cellPx * 0.19, 0) }).to(0.12, { position: new Vec3(0, this.cellPx * 0.04, 0) })).start();
        this.markCat(i, GOLD);
      } else {
        cat.angle = state === 'dead' ? 90 : 20;
        if (sp) sp.color = new Color(190, 185, 180, 255);
        this.markCat(i, '#b3a695');
      }
    });
  }
  private markCat(i: number, tint: string) {   /* 缺状态图时的表情标记（头顶小星贴图，替代 emoji） */
    const cell = this.cells[i];
    if (cell.node.getChildByName('mark')) return;
    const mk = this.makeSprite('icon_star', Math.max(14, Math.floor(this.cellPx * 0.3)), Math.max(14, Math.floor(this.cellPx * 0.3)), 'mark', tint);
    if (!mk) return;
    mk.setPosition(0, this.cellPx * 0.48, 0);
    cell.node.addChild(mk);
  }

  private onWin() {
    this.won = true;
    const stars = this.starsFor(this.fails, this.hints);
    if ((this.save.won[String(this.level.id)] || 0) < stars) { this.save.won[String(this.level.id)] = stars; this.persist(); }
    this.setCatsState('happy');
    this.play('win');
    /* 让最后一跳落地演完再压遮罩（0.45s），别把高潮闷在幕布后 */
    this.scheduleOnce(() => { this.showWinOverlay(stars); }, 0.45);
    this.scheduleOnce(() => this.confetti(), 0.5);
  }
  private showWinOverlay(stars: number) {
    const { width: W } = this.viewSize();
    const mask = this.makeMask(false);
    const card = this.cardShell(mask, Math.min(460, W - 40), 300);
    const isFinale = this.level.id === LEVELS[LEVELS.length - 1].id;
    for (let k = 0; k < 3; k++) {
      const st = this.makeSprite(k < stars ? 'icon_star' : 'icon_star_empty', 44, 44, undefined, k < stars ? GOLD : undefined);
      if (st) {
        st.setPosition((k - 1) * 58, 88, 0);
        st.setScale(0, 0, 1);
        card.addChild(st);
        tween(st).delay(0.15 + k * 0.18).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .call(() => { if (k < stars) { this.play('star'); if (k === 2 && stars === 3) this.play('meow'); } }).start();
      }
    }
    const t = this.makeLabel(isFinale ? '猫都全部通关！' : '找到全部猫咪！', 30, INK); t.node.setPosition(0, 30, 0); card.addChild(t.node);
    const b = this.makeLabel(isFinale
      ? `总星数 ${this.totalStars()}/${LEVELS.length * 3} · 感谢陪猫到最后`
      : '难度 ' + this.level.difficulty + ' · 猜错 ' + this.fails + '/2 · 提示 ' + this.hints + ' 次', 18, SUB);
    b.node.setPosition(0, -12, 0); card.addChild(b.node);
    const next = LEVELS.find((l: Level) => l.id === this.level.id + 1);
    card.addChild(this.makeButton(next ? '下一关 →' : '回到列表', new Vec3(0, -92, 0), () => { this.dismissMask(mask); if (next) this.enterLevel(next.id); else this.showList(); }, { accent: true }));
    card.setScale(0.6, 0.6, 1);
    tween(card).to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    if (isFinale) this.scheduleOnce(() => this.confetti(), 0.2);
  }

  private onFail() {
    this.failed = true;
    this.setCatsState('dead');
    this.play('lose');
    /* 失败层：再试一次 / 回到列表（设计文档 §2 双按钮） */
    const { width: W } = this.viewSize();
    const mask = this.makeMask(false);
    const card = this.cardShell(mask, Math.min(460, W - 40), 320);
    const av = this.makeSprite('cat_hurt', 84, 92) || this.makeSprite('cat_idle', 84, 92);
    if (av) { av.setPosition(0, 96, 0); av.angle = 8; card.addChild(av); }
    const t = this.makeLabel('猜错 2 次，这局输了', 28, INK); t.node.setPosition(0, 22, 0); card.addChild(t.node);
    const b = this.makeLabel('先用 ✕ 标出没有猫的格子，善用提示再来', 18, SUB);
    b.node.setPosition(0, -14, 0); card.addChild(b.node);
    card.addChild(this.makeButton('再试一次', new Vec3(0, -84, 0), () => { this.dismissMask(mask); this.enterLevel(this.level.id); }, { accent: true }));
    card.addChild(this.makeButton('回到列表', new Vec3(0, -140, 0), () => { this.dismissMask(mask); this.showList(); }, { w: 160 }));
    card.setScale(0.6, 0.6, 1);
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
    if (res.error) text = '注意：' + res.error;
    else if (res.solved) text = '本关已完成喵～';
    else {
      const h = res.hint;
      text = '【' + h.label + '】' + h.text;
      /* 高亮在关掉弹窗后才点亮（点亮 4.2s 脉冲），不再在遮罩底下空跑 */
    }
    this.showOverlay('💡', '单步提示', text, () => {
      if (!res.error && !res.solved && res.hint) this.armHints(res.hint.cells || []);
    }, '知道了', true);
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
    this.infoLabel.string = `${this.level.name} · ${this.level.size}×${this.level.size} · 找到 ${cats} · 猜错 ${this.fails}/2`;
    this.failIcons.forEach((sp, k) => {
      if (!sp) return;
      sp.color = k < this.fails ? new Color(217, 95, 67, 255) : new Color(216, 205, 190, 255);
      const ic = sp.node.getComponent(UIOpacity);
      if (ic) ic.opacity = k < this.fails ? 255 : 70;
    });
  }

  /* ============ 规则页 / 设置页 ============ */
  private showRules(after: () => void) {
    this.showOverlay('🐱', '怎么玩', '· 每种颜色住一只猫，每行每列也各一只\n' +
      '· 两只猫不能挨在一起（斜角也算挨着）\n' +
      '· 点一下格子：标 ✕（这里没有猫）\n' +
      '· 再点一下取消；按住拖动连着标\n' +
      '· 双击：猜猫在这！猜错 2 次就输\n' +
      '· 卡住了就点「提示」', () => { after(); }, '知道了', true);
  }

  private showSettings() {
    const { width: W } = this.viewSize();
    const mask = this.makeMask(false);
    const card = this.cardShell(mask, Math.min(420, W - 40), 380);
    const t = this.makeLabel('设置', 30, INK); t.node.setPosition(0, 132, 0); card.addChild(t.node);
    const rowBtns: Node[] = [];
    const mkRow = (y: number): Node => {
      const row = this.uiNode('row'); row.addComponent(UITransform).setContentSize(360, 52); row.setPosition(0, y, 0); card.addChild(row);
      const rg = row.addComponent(Graphics);
      rg.fillColor = new Color(247, 242, 234, 255); rg.roundRect(-180, -26, 360, 52, 12); rg.fill();
      rowBtns.push(row);
      return row;
    };
    /* 音效 */
    const sndRow = mkRow(56);
    const redrawSnd = () => {
      sndRow.removeAllChildren();
      const icon = this.makeSprite(this.save.sound ? 'icon_sound_on' : 'icon_sound_off', 28, 28);
      if (icon) { icon.setPosition(-140, 0, 0); sndRow.addChild(icon); }
      const lb = this.makeLabel('音效：' + (this.save.sound ? '开' : '关'), 21, '#6b5b4e');
      lb.node.setPosition(16, 0, 0); sndRow.addChild(lb.node);
    };
    redrawSnd();
    sndRow.on(Input.EventType.TOUCH_END, () => { this.save.sound = !this.save.sound; this.persist(); redrawSnd(); this.play('toggle'); });
    /* 音乐 */
    const musRow = mkRow(-8);
    const redrawMus = () => {
      musRow.removeAllChildren();
      const icon = this.makeSprite(this.save.music ? 'icon_sound_on' : 'icon_sound_off', 28, 28);
      if (icon) { icon.setPosition(-140, 0, 0); musRow.addChild(icon); }
      const lb = this.makeLabel('音乐：' + (this.save.music ? '开' : '关'), 21, '#6b5b4e');
      lb.node.setPosition(16, 0, 0); musRow.addChild(lb.node);
    };
    redrawMus();
    musRow.on(Input.EventType.TOUCH_END, () => {
      this.save.music = !this.save.music; this.persist(); redrawMus();
      if (this.save.music) { this.bgmOn = false; this.ensureBgm(); } else this.stopBgm();
      this.play('toggle');
    });
    /* 玩法 */
    const ruleRow = mkRow(-72);
    const rlb = this.makeLabel('怎么玩（随时回看）', 21, '#6b5b4e'); rlb.node.setPosition(0, 0, 0); ruleRow.addChild(rlb.node);
    ruleRow.on(Input.EventType.TOUCH_END, () => { this.play('click'); this.dismissMask(mask); this.showRules(() => { }); });
    /* 重置进度（两步确认，5s 超时回退） */
    let armed = false;
    let disarmTimer: number | null = null;
    const rstRow = mkRow(-136);
    const redrawRst = () => {
      rstRow.removeAllChildren();
      const rg2 = rstRow.getComponent(Graphics) as Graphics;
      rg2.fillColor = armed ? new Color(229, 83, 60, 255) : new Color(247, 242, 234, 255);
      rg2.roundRect(-180, -26, 360, 52, 12); rg2.fill();
      const lb = this.makeLabel(armed ? '再按一次确认清空' : '重置全部进度', 21, armed ? '#ffffff' : '#6b5b4e');
      lb.node.setPosition(0, 0, 0); rstRow.addChild(lb.node);
    };
    redrawRst();
    rstRow.on(Input.EventType.TOUCH_END, () => {
      this.play('click');
      if (!armed) {
        armed = true; redrawRst();
        disarmTimer = window.setTimeout(() => { armed = false; redrawRst(); }, 5000);
        return;
      }
      if (disarmTimer) clearTimeout(disarmTimer);
      this.save.won = {}; this.persist(); armed = false; redrawRst();
      this.showToast('进度已清空');
      this.scheduleOnce(() => { this.page = 0; this.save.page = 0; this.persist(); this.showList(); }, 0.6);
    });
    /* 关于 */
    const about = this.makeLabel('猫棋 1.0 · Kenney(CC0) · OpenGameArt(CC0) · AI', 15, FAINT);
    about.node.setPosition(0, -156, 0); card.addChild(about.node);
    card.addChild(this.makeButton('关闭', new Vec3(0, -95 - 55, 0), () => this.dismissMask(mask), { accent: true }));
    card.setScale(0.6, 0.6, 1);
    tween(card).to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  /* ============ 基础 UI 工具 ============ */
  private clearRoot() {
    this.root.removeAllChildren();
    this.activeMask = null;
  }
  private viewSize() { return view.getVisibleSize(); }   /* Boot 节点不保证是 Canvas，直接取可视区尺寸 */
  private hexColor(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  /* 运行时创建的节点必须显式挂 UI_2D 层，否则相机（visibility=UI_2D）一个都不会画 */
  private uiNode(name: string): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    return n;
  }
  private makeLabel(text: string, size: number, color: string): Label {
    const n = this.uiNode('label');
    n.addComponent(UITransform);
    const lb = n.addComponent(Label);
    if (this.uiFont) lb.font = this.uiFont;   /* 卡通字体（站酷快乐体子集），未加载完回退系统字 */
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
  /* 贴图按钮：暖色统一、按下态即时反馈、可选图标 */
  private makeButton(text: string, pos: Vec3, cb: () => void, opts: { accent?: boolean; icon?: string; w?: number } = {}): Node {
    const w = opts.w || 128, h = 44;
    const n = this.uiNode('btn');
    n.addComponent(UITransform).setContentSize(w, h);
    const normal = this.sf(opts.accent ? 'btn_accent' : 'btn_primary');
    const pressed = this.sf(opts.accent ? 'btn_accent_pressed' : 'btn_primary_pressed');
    const sp = n.addComponent(Sprite);
    if (normal) {
      sp.type = Sprite.Type.SIMPLE; sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.spriteFrame = normal;
      if (!opts.accent) sp.color = new Color(255, 236, 210, 255);   /* 冷灰底 → 暖奶油，与卡片同一色系 */
    } else {
      const g = n.addComponent(Graphics);
      g.fillColor = opts.accent ? new Color(255, 157, 104, 255) : new Color(255, 255, 255, 255);
      g.roundRect(-w / 2, -h / 2, w, h, 10); g.fill();
    }
    let lx = 0;
    if (opts.icon) {
      const ic = this.makeSprite(opts.icon, 20, 20);
      if (ic) { ic.setPosition(-w / 2 + 28, 0, 0); n.addChild(ic); lx = 10; }
    }
    const lb = this.makeLabel(text, 20, opts.accent ? '#6b4a00' : '#6b5b4e');
    lb.node.setPosition(lx, 0, 0);
    n.addChild(lb.node);
    n.setPosition(pos.x, pos.y, pos.z);
    n.on(Input.EventType.TOUCH_START, () => {
      n.setScale(0.94, 0.94, 1);
      if (pressed && sp) sp.spriteFrame = pressed;
    });
    n.on(Input.EventType.TOUCH_END, () => {
      n.setScale(1, 1, 1);
      if (normal && sp) sp.spriteFrame = normal;
      this.play('click');
      cb();
    });
    n.on(Input.EventType.TOUCH_CANCEL, () => {
      n.setScale(1, 1, 1);
      if (normal && sp) sp.spriteFrame = normal;
    });
    return n;
  }
  /* 圆形小图标钮（列表页右上角）：按下即时缩放 */
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
    if (glyph) {
      const lb = this.makeLabel(glyph, 15, '#6b5b4e');
      n.addChild(lb.node);
    }
    n.setPosition(pos.x, pos.y, pos.z);
    n.on(Input.EventType.TOUCH_START, () => n.setScale(0.9, 0.9, 1));
    n.on(Input.EventType.TOUCH_END, () => { n.setScale(1, 1, 1); this.play('click'); cb(); });
    n.on(Input.EventType.TOUCH_CANCEL, () => n.setScale(1, 1, 1));
    return n;
  }
  private makeMask(closable: boolean): Node {
    const { width: W, height: H } = this.viewSize();
    const mask = this.uiNode('mask');
    mask.addComponent(UITransform).setContentSize(W * 2, H * 2);
    const mg = mask.addComponent(Graphics);
    mg.fillColor = new Color(26, 20, 16, 150);          /* 近黑压暗，不给马卡龙棋盘蒙土色 */
    mg.fillRect(-W, -H, W * 2, H * 2); mg.fill();
    const mop = mask.addComponent(UIOpacity);
    mop.opacity = 0;
    this.root.addChild(mask);
    this.activeMask = mask;
    tween(mop).to(0.2, { opacity: 255 }).start();
    if (closable) mask.on(Input.EventType.TOUCH_END, () => this.dismissMask(mask));
    return mask;
  }
  /* 统一退场：遮罩/卡片淡出缩回后再销毁（不再凭空蒸发） */
  private dismissMask(mask: Node) {
    if (this.activeMask === mask) this.activeMask = null;
    const mop = mask.getComponent(UIOpacity);
    const card = mask.getChildByName('card-shell');
    if (card) tween(card).to(0.14, { scale: new Vec3(0.85, 0.85, 1) }).start();
    if (mop) tween(mop).to(0.15, { opacity: 0 }).call(() => mask.destroy()).start();
    else mask.destroy();
  }
  /* 弹窗卡片工厂：阴影垫底 + 白卡，三弹窗共用 */
  private cardShell(mask: Node, cw: number, ch: number): Node {
    const card = this.uiNode('card-shell');
    card.addComponent(UITransform).setContentSize(cw, ch);
    const cg = card.addComponent(Graphics);
    cg.fillColor = new Color(60, 46, 32, 60);
    cg.roundRect(-cw / 2 - 6, -ch / 2 - 8, cw + 12, ch, 18); cg.fill();   /* 落影 */
    cg.fillColor = new Color(255, 255, 255, 255);
    cg.roundRect(-cw / 2, -ch / 2, cw, ch, 16); cg.fill();
    mask.addChild(card);
    return card;
  }
  private showOverlay(big: string, title: string, body: string, cb: () => void, btnText: string, infoOnly = false) {
    const { width: W } = this.viewSize();
    const mask = this.makeMask(infoOnly);   /* 信息类弹窗可点遮罩关闭 */
    const card = this.cardShell(mask, Math.min(460, W - 40), 380);
    /* 头像：能用自家猫就用，emoji 只做兜底 */
    const av = this.makeSprite('cat_idle', 76, 84);
    if (av) { av.setPosition(0, 122, 0); card.addChild(av); }
    else {
      const bigLb = this.makeLabel(big, 48, INK); bigLb.node.setPosition(0, 122, 0); card.addChild(bigLb.node);
    }
    const t = this.makeLabel(title, 26, INK); t.node.setPosition(0, 64, 0); card.addChild(t.node);
    const b = this.makeLabel(body, 17, SUB);
    b.lineHeight = 24;
    b.overflow = Label.Overflow.SHRINK;
    b.horizontalAlign = Label.HorizontalAlign.LEFT;
    b.node.getComponent(UITransform)!.setContentSize(392 - 56, 220);
    b.node.setPosition(-10, -28, 0);
    card.addChild(b.node);
    card.addChild(this.makeButton(btnText, new Vec3(0, -152, 0), () => { this.dismissMask(mask); cb(); }, { accent: true }));
    card.setScale(0.6, 0.6, 1);
    tween(card).to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }
  /* 底部轻提示（替代"只有音效没有解释"的哑反馈） */
  private showToast(text: string) {
    if (this.toast) this.toast.destroy();
    const { height: H } = this.viewSize();
    const t = this.uiNode('toast');
    t.addComponent(UITransform).setContentSize(360, 48);
    const g = t.addComponent(Graphics);
    g.fillColor = new Color(60, 46, 32, 210);
    g.roundRect(-180, -24, 360, 48, 24); g.fill();
    const lb = this.makeLabel(text, 18, '#fff8ee');
    lb.node.setPosition(0, 0, 0);
    t.addChild(lb.node);
    t.setPosition(0, -H / 2 + 130, 0);
    this.root.addChild(t);
    this.toast = t;
    const op = t.addComponent(UIOpacity);
    op.opacity = 0;
    tween(op).to(0.2, { opacity: 255 }).delay(1.2).to(0.25, { opacity: 0 }).call(() => { t.destroy(); if (this.toast === t) this.toast = null; }).start();
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
      closeOverlay: () => { if (self.activeMask) { self.dismissMask(self.activeMask); self.activeMask = null; return true; } return false; },
      background: () => !!self.sf('bg_paw'),
      backToList: () => { self.showList(); return true; },
      state: () => ({ manualX: Array.from(self.manualX), sys: Array.from(self.sysState.entries()), fails: self.fails, won: self.won, failed: self.failed }),
      tap: (r: number, c: number) => { const i = r * self.level.size + c; if (!self.sysState.has(i)) { if (!self.manualX.has(i)) { self.manualX.add(i); self.markX(i, true); } } },
      dbltap: (r: number, c: number) => { const i = r * self.level.size + c; self.manualX.delete(i); self.clearX(i); self.judge(i); },
    };
  }
  start() { this.ensureDriver(); }
  protected update(): void {
    if (Math.abs(view.getVisibleSize().height - this.lastOrtho) > 0.5) this.syncCamera();   /* 旋转/窗口变化时保持相机对齐 */
  }
}
