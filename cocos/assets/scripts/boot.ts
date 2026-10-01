/* 猫棋 · Cocos Creator 动画版 —— 贴图 UI + 真猫 sprite + 音效/BGM + 存档/解锁/星级
 * 交互与原生版同构：单击标 ✕（人工笔记）/ 拖动连标 / 双击判定猫（判错计失败，2 次失败）。
 * 引擎与关卡数据由 npm run build 同步（单一来源），本文件只负责渲染、交互、动画与音频。
 * 资源：resources/img（Kenney UI Pack CC0 + AI 猫 + 站酷快乐体子集）、resources/audio（Kenney CC0，mp3）。
 * 性能约束：棋盘全部色块/边界画在 board 的单个 Graphics 上（1 dc）；✕/高亮/猫等渲染件按需惰性创建。
 * 猫四态：cat_idle 必备；cat_happy/cat_hurt/cat_dead 缺失时自动降级为 idle+变形动画（出图后直接热替换）。
 * 场景里挂这一个组件即可（assets/scenes/main.scene）。 */
import { _decorator, Component, Node, Label, Graphics, UITransform, Color, Vec3, tween, Tween, UIOpacity, Input, sys, Sprite, SpriteFrame, resources, AudioClip, AudioSource, view, Layers, ResolutionPolicy, Canvas, Camera, director, Font, Texture2D, Rect, LabelOutline } from 'cc';
const { ccclass } = _decorator;

import CatChessMod from './engine/index';
import { LEVELS } from './levels-data';

const CatChess: any = CatChessMod;
type Level = any;

interface Cell { node: Node; xIcon: Node | null; hl: Node | null; r: number; c: number; }
interface SaveData { won: Record<string, number>; sound: boolean; music: boolean; rules: boolean; page: number; }

const SAVE_KEY = 'zmm_cocos_v1';
const IMG = ['btn_normal', 'btn_pressed', 'btn_accent', 'btn_accent_pressed', 'btn_round',
  'icon_star', 'icon_star_empty', 'icon_cross', 'icon_back', 'icon_reset', 'icon_gear',
  'icon_sound_on', 'icon_sound_off', 'cat_idle', 'bg_paw',
  'logo', 'title_win', 'title_rules', 'title_settings', 'title_fail',
  'lock', 'capsule', 'infobar', 'cat_v2', 'cat_v3', 'cat_v4', 'board_frame', 'board_bg_soft',
  'cloud_1', 'cloud_2', 'cloud_3', 'prop_yarn', 'prop_fish', 'prop_milk', 'confetti_sheet',
  'banner_xiaoyuan', 'banner_jiequ', 'banner_gongyuan', 'banner_jieshi', 'banner_maodu',
  'tile_white', 'tile_depth', 'hl_gold', 'ring_gold', 'flash_red',
  'card_level', 'toast_dark', 'shadow_cat', 'row_setting', 'mark_x',
  'card_green', 'card_blue', 'card_pink', 'card_yellow', 'card_gold'];

/* 柔和化 24 色板（CIELab 降饱和提亮，区分度硬约束 ≥90%），与引擎 PALETTE 同序 */
const SOFT_PALETTE = ['#F7CAD5', '#FDE592', '#BDE7B5', '#B4D8F5', '#DBC7EF', '#F9C895', '#A6DAD6', '#F5AFA6', '#C7E997', '#A3C8E8', '#F8E8B8', '#D8E9CB', '#EAC7B9', '#C9CBEF', '#F3B782', '#AEE1C9', '#F2B4CC', '#E9DFB9', '#BDCFE0', '#E4CADE', '#FCD6B4', '#D2E9DC', '#E9D3F1', '#F9E4CB'];

/* 章节分组（关卡名前缀对应） */
const CHAPTERS = [
  { from: 1, to: 20, img: 'banner_xiaoyuan', card: 'card_green' },
  { from: 21, to: 45, img: 'banner_jiequ', card: 'card_blue' },
  { from: 46, to: 72, img: 'banner_gongyuan', card: 'card_pink' },
  { from: 73, to: 99, img: 'banner_jieshi', card: 'card_yellow' },
  { from: 100, to: 100, img: 'banner_maodu', card: 'card_gold' },
];
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
  private lastInput = { t: 0, phase: '' };
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
  private confettiTex: Texture2D | null = null;
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
  private loadConfettiTex(): Promise<void> {
    return new Promise(res => {
      resources.load('img/confetti_sheet/texture', Texture2D, (err, t) => {
        this.confettiTex = err ? null : t as Texture2D;
        res();
      });
    });
  }
  private async loadAll() {
    await Promise.all([...IMG.map(n => this.loadImg(n)),
      ...CAT_STATES.map(n => this.loadCat(n)),
      ...SFX.map(n => this.loadSfx(n)),
      this.loadFont(), this.loadConfettiTex()]);
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

  /* 插到背景之上、其余 UI 之下（云朵/装饰用） */
  private insertChildBelow(n: Node) {
    const bg = this.root.getChildByName('bg');
    this.root.insertChild(n, bg ? this.root.children.indexOf(bg) + 1 : 0);
  }

  /* 全屏平铺背景（Kenney 猫爪印奶油纹，CC0） */
  private addBackground() {
    const f = this.sf('bg_paw');
    if (!f) return;
    const { width: W, height: H } = this.viewSize();
    const bg = this.uiNode('bg');
    bg.addComponent(UITransform).setContentSize(W, H);
    const sp = bg.addComponent(Sprite);
    sp.type = Sprite.Type.TILED;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = f;
    bg.getComponent(UITransform)!.setContentSize(W, H);   /* frame 会触发 TRIMMED 尺寸重置，尺寸必须在其后定 */
    const bop = bg.addComponent(UIOpacity);
    bop.opacity = 153;                                    /* 爪印调淡至 60%：氛围铺垫不抢卡片 */
    this.root.insertChild(bg, 0);
  }

  /* ============ 关卡列表（分页，每页 20 关） ============ */
  private showList() {
    this.clearRoot();
    this.addBackground();
    const W = this.viewSize().width;
    const H = this.viewSize().height;

    /* 标题 Logo（艺术字贴图，缺图回退文字版） */
    const logo = this.makeSprite('logo', 264, 124);
    if (logo) {
      logo.setPosition(0, H / 2 - 82, 0);
      this.root.addChild(logo);
    } else {
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
    }
    const sub = this.makeLabel('每种颜色住一只猫 · 双击猜猫，猜错 2 次就输', 20, SUB);
    sub.node.setPosition(0, H / 2 - 150, 0);
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
    prog.node.setPosition(0, H / 2 - 188, 0);
    this.root.addChild(prog.node);
    const next = this.firstUnfinished();
    if (next) {
      const cont = this.makeButton(`继续 · 第 ${next.id} 关`, new Vec3(0, H / 2 - 236, 0), () => this.enterLevel(next.id), { accent: true, w: 220 });
      this.root.addChild(cont);
    }

    const perPage = 20;
    const pages = Math.ceil(LEVELS.length / perPage);
    this.page = Math.max(0, Math.min(this.save.page || 0, pages - 1));
    const from = this.page * perPage;
    const items = LEVELS.slice(from, from + perPage);
    /* 背景漂浮云朵（低透明，缓慢横漂） */
    [['cloud_1', -180, H / 2 - 420, 210], ['cloud_2', 200, H / 2 - 640, 180], ['cloud_3', -60, -H / 2 + 260, 160]].forEach(([img, cx, cy, w], k) => {
      const cl = this.makeSprite(img as string, w as number, (w as number) * 0.6);
      if (!cl) return;
      cl.setPosition(cx as number, cy as number, 0);
      const op = cl.addComponent(UIOpacity); op.opacity = 60;
      this.root.addChild(cl);
      this.insertChildBelow(cl);
      tween(cl).repeatForever(tween(cl)
        .to(3 + k, { position: new Vec3((cx as number) + 26, cy as number, 0) }, { easing: 'sineInOut' })
        .to(3 + k, { position: new Vec3(cx as number, cy as number, 0) }, { easing: 'sineInOut' })).start();
    });
    /* 章节横幅（当前页首关所属章节） */
    const chapter = CHAPTERS.find(c => items[0] && items[0].id >= c.from && items[0].id <= c.to);
    const gridTop0 = H / 2 - 300;
    const chB = chapter ? this.makeSprite(chapter.img, 300, 50) : null;
    if (chB) { chB.setPosition(0, gridTop0 + 8, 0); this.root.addChild(chB); }
    const gridTop = H / 2 - 300;
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
    const chapter = CHAPTERS.find(c => lv.id >= c.from && lv.id <= c.to);
    const cardBg = this.makeSprite(chapter ? chapter.card : 'card_level', w, h, 'card-bg');
    if (!cardBg) {
      const g = n.addComponent(Graphics);
      g.fillColor = unlocked ? new Color(255, 255, 255, 255) : new Color(244, 238, 229, 150);
      g.roundRect(-w / 2, -h / 2, w, h, 10); g.fill();
      g.lineWidth = 2; g.strokeColor = unlocked ? new Color(240, 223, 200, 255) : new Color(226, 214, 196, 120);
      g.roundRect(-w / 2, -h / 2, w, h, 10); g.stroke();
    } else if (!unlocked) {
      const sp = cardBg.getComponent(Sprite) as Sprite;
      sp.color = new Color(232, 226, 216, 200);   /* 锁定卡轻压降存在感 */
    }
    const no = this.makeLabel(String(lv.id), 36, unlocked ? '#ff8b5e' : FAINT, unlocked ? '#ffffff' : undefined, 3); no.node.setPosition(-14, 28, 0); n.addChild(no.node);
    const nm = this.makeLabel(lv.name, 15, unlocked ? '#7a6a58' : FAINT); nm.node.setPosition(0, -2, 0); n.addChild(nm.node);
    const df = this.makeLabel('难度 ' + lv.difficulty, 15, unlocked ? SUB : FAINT); df.node.setPosition(0, -26, 0); n.addChild(df.node);
    /* 难度条（胶囊底 + /50 封顶） */
    const barW = w - 24;
    const ratio = Math.min(1, lv.difficulty / 50);
    const cap = this.makeSprite('capsule', barW, 12, 'cap-' + lv.id);
    if (cap) {
      cap.setPosition(0, -h / 2 + 14, 0);
      n.addChild(cap);
      const fw = Math.max(6, (barW - 8) * ratio);
      const fgN = this.uiNode('fg'); fgN.addComponent(UITransform).setContentSize(fw, 6); fgN.setPosition(-(barW - 8) / 2 + fw / 2, 0, 0); cap.addChild(fgN);
      const fg = fgN.addComponent(Graphics); fg.fillColor = new Color(255, 139, 94, 255); fg.roundRect(-fw / 2, -3, fw, 6, 3); fg.fill();
    } else {
      const bar = this.uiNode('bar'); bar.addComponent(UITransform).setContentSize(barW, 8); bar.setPosition(0, -h / 2 + 14, 0); n.addChild(bar);
      const bg = bar.addComponent(Graphics); bg.fillColor = new Color(240, 228, 210, 255); bg.roundRect(-barW / 2, -4, barW, 8, 4); bg.fill();
      const fgN = this.uiNode('fg'); fgN.addComponent(UITransform).setContentSize(barW * ratio, 8); fgN.setPosition(-barW / 2 + barW * ratio / 2, 0, 0); bar.addChild(fgN);
      const fg = fgN.addComponent(Graphics); fg.fillColor = new Color(255, 139, 94, 255); fg.roundRect(-barW * ratio / 2, -4, barW * ratio, 8, 4); fg.fill();
    }
    /* 锁 / 星级 */
    if (!unlocked) {
      const lk = this.makeSprite('lock', 20, 22);
      if (lk) { lk.setPosition(w / 2 - 18, h / 2 - 18, 0); n.addChild(lk); }
      else { const lock = this.makeLabel('🔒', 20, SUB); lock.node.setPosition(w / 2 - 18, h / 2 - 18, 0); n.addChild(lock.node); }
    } else {
      const stars = this.save.won[String(lv.id)] || 0;
      for (let k = 0; k < 3; k++) {
        /* 星星放右上角竖向错开（数字左置不再冲突），金色=已得、浅灰=未得 */
        const st = this.makeSprite(k < stars ? 'icon_star' : 'icon_star_empty', 16, 16, undefined, k < stars ? GOLD : '#d8d0c4');
        if (st) { st.setPosition(w / 2 - 16, h / 2 - 16 - k * 19, 0); n.addChild(st); }
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
    this.boardPx = Math.min(W - 110, H - 215);   /* 给奶油外框（1.087 倍）留出完整入镜余量 */
    this.cellPx = Math.floor(this.boardPx / n);
    this.boardPx = this.cellPx * n;

    /* 信息栏（胶囊底板，右移给双叉让位）+ 猜错双叉内嵌左端——重排后不再挤 */
    this.infoLabel = this.makeLabel('', 20, '#8a7560');
    const ibW = Math.min(W - 220, 470);
    this.infoLabel.node.setPosition(W / 2 - 96 - ibW / 2 + 50, H / 2 - 34, 0);
    const ib = this.makeSprite('infobar', ibW, 54);
    if (ib) { ib.setPosition(W / 2 - 96 - ibW / 2 + 50, H / 2 - 34, 0); this.root.addChild(ib); }
    this.root.addChild(this.infoLabel.node);
    /* 猜错计数（两枚叉图标：淡=剩余机会，红=已用） */
    this.failIcons = [];
    for (let k = 0; k < 2; k++) {
      const ic = this.makeSprite('icon_cross', 20, 20);
      if (ic) {
        ic.setPosition(-W / 2 + 52 + k * 26, H / 2 - 34, 0);
        const sp = ic.getComponent(Sprite) as Sprite;
        sp.color = new Color(216, 205, 190, 255);
        const op = ic.addComponent(UIOpacity); op.opacity = 70;
        this.root.addChild(ic);
        this.failIcons.push(sp);
      }
    }

    /* 工具栏（贴图按钮，滑入 stagger） */
    const btnBack = this.makeButton('列表', new Vec3(-W / 2 + 82, H / 2 - 96, 0), () => this.showList(), { icon: 'icon_back', w: 132 });
    const btnReset = this.makeButton('重置', new Vec3(0, H / 2 - 96, 0), () => { this.enterLevel(this.level.id); }, { icon: 'icon_reset', w: 116 });
    const btnHint = this.makeButton('提示', new Vec3(W / 2 - 82, H / 2 - 96, 0), () => this.showHint(), { accent: true, w: 116 });
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
    g.roundRect(-this.boardPx / 2 - 3, -this.boardPx / 2 - 3, this.boardPx + 6, this.boardPx + 6, 24); g.fill();
    /* 柔和底纹：作为 board 的兄弟节点垫在下层（子节点会盖住父 Graphics），缝隙处透出波点 */
    const bgs = this.makeSprite('board_bg_soft', this.boardPx, this.boardPx);
    if (bgs) {
      bgs.setPosition(0, -30, 0);
      this.root.insertChild(bgs, this.root.children.indexOf(board));
    }
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const cx = -this.boardPx / 2 + this.cellPx * (c + 0.5), cy = this.boardPx / 2 - this.cellPx * (r + 0.5);
      /* 区块边界：深棕圆头线画在缝隙处（父层，格子贴图之下不遮挡） */
      const isBr = c + 1 < n && this.level.regions[i] !== this.level.regions[i + 1];
      const isBb = r + 1 < n && this.level.regions[i] !== this.level.regions[i + n];
      g.lineWidth = 2; g.strokeColor = new Color(74, 63, 53, 200); g.lineCap = Graphics.LineCap.ROUND;
      if (isBr) { g.moveTo(cx + this.cellPx / 2, cy - this.cellPx / 2 + 3); g.lineTo(cx + this.cellPx / 2, cy + this.cellPx / 2 - 3); g.stroke(); }
      if (isBb) { g.moveTo(cx - this.cellPx / 2 + 3, cy - this.cellPx / 2); g.lineTo(cx + this.cellPx / 2 - 3, cy - this.cellPx / 2); g.stroke(); }
      /* 逻辑格：tile 贴图染色挂其下，✕/猫/高亮惰性挂其上 */
      const cell = this.uiNode('cell');
      cell.addComponent(UITransform).setContentSize(this.cellPx, this.cellPx);
      cell.setPosition(cx, cy, 0);
      const pal = SOFT_PALETTE[this.level.regionColors[this.level.regions[i]]];
      const tile = this.makeSprite('tile_white', this.cellPx - 4, this.cellPx - 4, 'tile');
      if (tile && pal) {
        const tsp = tile.getComponent(Sprite) as Sprite;
        const [tr, tg, tb] = this.hexColor(pal);
        tsp.color = new Color(tr, tg, tb, 255);
        cell.addChild(tile);
      } else {
        const cg = cell.addComponent(Graphics);
        const [hexR, hexG, hexB] = this.hexColor(pal || CatChess.PALETTE[this.level.regionColors[this.level.regions[i]]][0]);
        cg.fillColor = new Color(hexR, hexG, hexB, 255);
        cg.fillRect(-this.cellPx / 2, -this.cellPx / 2, this.cellPx, this.cellPx); cg.fill();
      }
      board.addChild(cell);
      this.cells.push({ node: cell, xIcon: null, hl: null, r, c });
    }
    /* 奶油窄边外框（开窗 92%，贴图比例 1/0.92 ≈ 1.087 倍 board） */
    const frame = this.makeSprite('board_frame', this.boardPx * 1.087, this.boardPx * 1.087);
    if (frame) board.addChild(frame);
    /* 棋盘下方空区：小道具散落（毛线球/鱼干/奶瓶） */
    const props = [['prop_yarn', -W / 2 + 90, -H / 2 + 210, 64, -12], ['prop_fish', W / 2 - 120, -H / 2 + 260, 72, 14], ['prop_milk', W / 2 - 70, -H / 2 + 120, 52, 6]] as const;
    props.forEach(([img, px, py, w, ang]) => {
      const p = this.makeSprite(img as string, w as number, w as number, undefined);
      if (!p) return;
      p.setPosition(px as number, py as number, 0);
      p.angle = ang as number;
      const op = p.addComponent(UIOpacity); op.opacity = 160;
      this.root.addChild(p);
    });
    board.setScale(0.7, 0.7, 1);
    tween(board).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

    /* 触摸 + 鼠标双路径监听（桌面浏览器无触摸设备，只有 MOUSE_*；移动端走 TOUCH_*）。
     * dedup：同相位 100ms 内的双输入（触摸+鼠标对同一手势各报一次）只处理一次。 */
    const bind = (evt: Input.EventType, phase: 'start' | 'move' | 'end') =>
      board.on(evt, (e: any) => { if (!this.dedup(phase)) this.onTouch(e, phase); }, this);
    bind(Input.EventType.TOUCH_START, 'start');
    bind(Input.EventType.TOUCH_MOVE, 'move');
    bind(Input.EventType.TOUCH_END, 'end');
    bind(Input.EventType.TOUCH_CANCEL, 'end');
    bind(Input.EventType.MOUSE_DOWN, 'start');
    bind(Input.EventType.MOUSE_MOVE, 'move');
    bind(Input.EventType.MOUSE_UP, 'end');
    bind(Input.EventType.MOUSE_LEAVE, 'end');
    this.refreshInfo();
    this.pageFadeIn();
  }

  private cellAtEvent(e: any): number {
    const n = this.level.size;
    const board = this.cells[0]?.node?.parent;
    if (!board) return -1;
    /* 引擎官方换算：UI 世界坐标 → board 局部坐标（自动处理 canvas 缩放/层级，手算坐标系必错） */
    const ui = e.getUILocation();
    const local = board.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
    if (Math.abs(local.x) > this.boardPx / 2 || Math.abs(local.y) > this.boardPx / 2) return -1;
    const c = Math.floor((local.x + this.boardPx / 2) / this.cellPx);
    const r = Math.floor((this.boardPx / 2 - local.y) / this.cellPx);
    if (r < 0 || r >= n || c < 0 || c >= n) return -1;
    return r * n + c;
  }

  /* 双输入去重：同一物理手势 TOUCH/MOUSE 各报一次，start/end 相位 120ms 内只认第一个 */
  private dedup(phase: 'start' | 'move' | 'end'): boolean {
    if (phase === 'move') return false;
    const now = Date.now();
    if (this.lastInput.phase === phase && now - this.lastInput.t < 120) return true;
    this.lastInput = { t: now, phase };
    return false;
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
      if (i < 0 || this.sysState.has(i)) return;
      if (i !== this.gesture.i) this.gesture.moved = true;
      if (!this.gesture.moved) return;
      if (this.gesture.tapOff) {
        /* 反选拖动：从已有 ✕ 起拖，划过的 ✕ 逐一取消（系统标记已被上方拦截） */
        if (this.manualX.has(i)) { this.manualX.delete(i); this.clearX(i, true); this.play('tick'); }
      } else if (!this.manualX.has(i)) {
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
      if (this.lastTap.i === i && now - this.lastTap.t < 450) {
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
  private markX(i: number, manual: boolean) {    /* ✕ 标记：白色圆头贴图（笔记=白 / 系统判错=红），加大不歪，缩放入场 */
    const cell = this.cells[i];
    if (!cell.xIcon) {
      cell.xIcon = this.makeSprite('mark_x', Math.floor(this.cellPx * 0.52), Math.floor(this.cellPx * 0.52), 'x-icon');
      if (cell.xIcon) cell.node.addChild(cell.xIcon);
    }
    if (cell.xIcon) {
      const sp = cell.xIcon.getComponent(Sprite) as Sprite;
      sp.color = manual ? new Color(255, 255, 255, 255) : new Color(229, 83, 60, 255);
      cell.xIcon.active = true;
      cell.xIcon.setScale(0.2, 0.2, 1);
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
  private hlAt(i: number): { node: Node; op: UIOpacity } {   /* 提示高亮惰性创建（金色框贴图，缺图回退色块） */
    const cell = this.cells[i];
    if (!cell.hl) {
      let hl = this.makeSprite('hl_gold', this.cellPx - 8, this.cellPx - 8, 'hl');
      if (!hl) {
        hl = this.uiNode('hl');
        hl.addComponent(UITransform).setContentSize(this.cellPx, this.cellPx);
        const g = hl.addComponent(Graphics);
        g.fillColor = new Color(255, 207, 92, 110);
        g.fillRect(-this.cellPx / 2, -this.cellPx / 2, this.cellPx, this.cellPx); g.fill();
      }
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
    /* 阴影：径向渐变贴图（缺图回退 Graphics 椭圆），把猫从同系色块上托出来 */
    const shadow = this.makeSprite('shadow_cat', this.cellPx * 0.78, this.cellPx * 0.26, 'cat-shadow');
    if (shadow) {
      shadow.setPosition(0, -this.cellPx * 0.3, 0);
      cell.node.addChild(shadow);
    } else {
      const sg0 = this.uiNode('cat-shadow-g');
      sg0.addComponent(UITransform).setContentSize(this.cellPx * 0.72, this.cellPx * 0.18);
      const sg = sg0.addComponent(Graphics);
      sg.fillColor = new Color(107, 91, 78, 40);
      sg.ellipse(0, 0, this.cellPx * 0.36, this.cellPx * 0.09); sg.fill();
      sg0.setPosition(0, -this.cellPx * 0.3, 0);
      cell.node.addChild(sg0);
    }
    const cat = this.makeSprite('cat_idle', this.cellPx * 0.8, this.cellPx * 0.8, 'cat');
    if (cat) {
      /* 按区块序号分配毛色变体，告别六胞胎 */
      const variants = ['cat_idle', 'cat_v2', 'cat_v3', 'cat_v4'];
      const vsp = cat.getComponent(Sprite) as Sprite;
      const vImg = this.sf(variants[this.level.regions[i] % variants.length]);
      if (vsp && vImg) vsp.spriteFrame = vImg;
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
    const ring = this.makeSprite('ring_gold', this.cellPx * 0.92, this.cellPx * 0.92, 'ring');
    if (ring) {
      const rop = ring.addComponent(UIOpacity);
      cell.node.addChild(ring);
      tween(ring).to(0.4, { scale: new Vec3(1.9, 1.9, 1) }).start();
      tween(rop).delay(0.25).to(0.2, { opacity: 0 }).call(() => ring.destroy()).start();
    } else {
      const ring2 = this.uiNode('ring');
      ring2.addComponent(UITransform).setContentSize(this.cellPx, this.cellPx);
      const rg = ring2.addComponent(Graphics);
      rg.lineWidth = 3; rg.strokeColor = new Color(255, 209, 102, 255);
      rg.circle(0, 0, this.cellPx * 0.36); rg.stroke();
      const rop2 = ring2.addComponent(UIOpacity);
      cell.node.addChild(ring2);
      tween(ring2).to(0.4, { scale: new Vec3(1.9, 1.9, 1) }).start();
      tween(rop2).delay(0.25).to(0.2, { opacity: 0 }).call(() => ring2.destroy()).start();
    }
  }
  private animWrong(i: number) {         /* 判错：格子抖动 + 红闪 + 系统✕ */
    const cell = this.cells[i];
    const x0 = cell.node.position.x;
    tween(cell.node)
      .repeat(4, tween(cell.node).to(0.05, { position: new Vec3(x0 + 4, cell.node.position.y, 0) }).to(0.05, { position: new Vec3(x0 - 4, cell.node.position.y, 0) }))
      .to(0.05, { position: new Vec3(x0, cell.node.position.y, 0) })
      .start();
    const flash = this.makeSprite('flash_red', this.cellPx - 6, this.cellPx - 6, 'flash');
    if (flash) {
      cell.node.addChild(flash);
      const fop = flash.addComponent(UIOpacity);
      tween(fop).delay(0.25).to(0.2, { opacity: 0 }).call(() => flash.destroy()).start();
    } else {
      const flash2 = this.uiNode('flash');
      flash2.addComponent(UITransform).setContentSize(this.cellPx, this.cellPx);
      const fgc = flash2.addComponent(Graphics);
      fgc.fillColor = new Color(229, 83, 60, 120);
      fgc.fillRect(-this.cellPx / 2, -this.cellPx / 2, this.cellPx, this.cellPx); fgc.fill();
      cell.node.addChild(flash2);
      const op = flash2.addComponent(UIOpacity);
      tween(op).delay(0.25).to(0.2, { opacity: 0 }).call(() => flash2.destroy()).start();
    }
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
      const st = this.makeSprite(k < stars ? 'icon_star' : 'icon_star_empty', 44, 44, undefined, k < stars ? GOLD : '#d8d0c4');
      if (st) {
        st.setPosition((k - 1) * 58, 88, 0);
        st.setScale(0, 0, 1);
        card.addChild(st);
        tween(st).delay(0.15 + k * 0.18).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .call(() => { if (k < stars) { this.play('star'); if (k === 2 && stars === 3) this.play('meow'); } }).start();
      }
    }
    const tw = this.makeSprite('title_win', 320, 53);
    if (tw) { tw.setPosition(0, 28, 0); card.addChild(tw); }
    else {
      const t = this.makeLabel(isFinale ? '猫都全部通关！' : '找到全部猫咪！', 30, INK); t.node.setPosition(0, 30, 0); card.addChild(t.node);
    }
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
    const tf = this.makeSprite('title_fail', 320, 53);
    if (tf) { tf.setPosition(0, 20, 0); card.addChild(tf); }
    else {
      const t = this.makeLabel('猜错 2 次，这局输了', 28, INK); t.node.setPosition(0, 22, 0); card.addChild(t.node);
    }
    const b = this.makeLabel('先用 ✕ 标出没有猫的格子，善用提示再来', 18, SUB);
    b.node.setPosition(0, -14, 0); card.addChild(b.node);
    card.addChild(this.makeButton('再试一次', new Vec3(0, -84, 0), () => { this.dismissMask(mask); this.enterLevel(this.level.id); }, { accent: true }));
    card.addChild(this.makeButton('回到列表', new Vec3(0, -140, 0), () => { this.dismissMask(mask); this.showList(); }, { w: 160 }));
    card.setScale(0.6, 0.6, 1);
    tween(card).to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  private confetti() {                   /* 全屏彩纸：图集贴图版（星/心/圆点/纸条），缺图退回色块 */
    const { width: W, height: H } = this.viewSize();
    for (let k = 0; k < 40; k++) {
      const p = this.uiNode('confetti');
      p.addComponent(UITransform).setContentSize(20, 20);
      let made = false;
      if (this.confettiTex) {
        const sf = new SpriteFrame();
        sf.texture = this.confettiTex;
        const cell = Math.floor(Math.random() * 16);
        const col = cell % 4, row = Math.floor(cell / 4);
        sf.rect = new Rect(col * 128, (3 - row) * 128, 128, 128);   /* 纹理坐标左下原点 */
        const sp = p.addComponent(Sprite);
        sp.spriteFrame = sf;
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        made = true;
      }
      if (!made) {
        const colors = ['#F7C6D2', '#FCE38A', '#B8E6B0', '#AED6F5', '#F5A9A0', '#D9C4EE'];
        const g = p.addComponent(Graphics);
        const [r, gg, b] = this.hexColor(colors[k % colors.length]);
        g.fillColor = new Color(r, gg, b, 255);
        g.fillRect(-5, -7, 10, 14); g.fill();
      }
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
    const { width: W } = this.viewSize();
    const mask = this.makeMask(true);
    const card = this.cardShell(mask, Math.min(460, W - 40), 460);
    const av = this.makeSprite('cat_idle', 70, 78);
    if (av) { av.setPosition(0, 168, 0); card.addChild(av); }
    const tw = this.makeSprite('title_rules', 210, 57);
    if (tw) { tw.setPosition(0, 104, 0); card.addChild(tw); }
    else { const t = this.makeLabel('怎么玩', 28, INK); t.node.setPosition(0, 104, 0); card.addChild(t.node); }
    /* 六条规则：马卡龙色数字徽章 + 短文案 */
    const lines: [string, string, string][] = [
      ['1', '每种颜色住一只猫，每行每列也各一只', '#ffcf5c'],
      ['2', '两只猫不能挨在一起（斜角也算）', '#f5a9a0'],
      ['3', '点格子标 ✕（这里没有猫）', '#b8e6b0'],
      ['4', '再点取消；按住拖动连着标', '#aed6f5'],
      ['5', '双击：猜猫在这！猜错 2 次就输', '#d9c4ee'],
      ['6', '卡住了就点「提示」', '#f9c895'],
    ];
    lines.forEach((ln, k) => {
      const y = 56 - k * 40;
      const [num, text, color] = ln;
      const bd = this.uiNode('badge'); bd.addComponent(UITransform).setContentSize(30, 30);
      const bg = bd.addComponent(Graphics);
      const [r, g, b] = this.hexColor(color);
      bg.fillColor = new Color(r, g, b, 255); bg.circle(0, 0, 15); bg.fill();
      bg.lineWidth = 3; bg.strokeColor = new Color(255, 255, 255, 255); bg.circle(0, 0, 15); bg.stroke();
      const nb = this.makeLabel(num, 16, '#ffffff'); nb.node.setPosition(0, 0, 0); bd.addChild(nb.node);
      bd.setPosition(-146, y, 0); card.addChild(bd);
      const lb = this.makeLabel(text, 17, '#6b5b4e');
      lb.horizontalAlign = Label.HorizontalAlign.LEFT;
      lb.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
      lb.node.setPosition(-128, y, 0); card.addChild(lb.node);
    });
    card.addChild(this.makeButton('知道了', new Vec3(0, -186, 0), () => { this.dismissMask(mask); after(); }, { accent: true }));
    card.setScale(0.6, 0.6, 1);
    tween(card).to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  private showSettings() {
    const { width: W } = this.viewSize();
    const mask = this.makeMask(false);
    const card = this.cardShell(mask, Math.min(420, W - 40), 470);
    const t = this.makeLabel('设置', 30, INK); t.node.setPosition(0, 178, 0); card.addChild(t.node);
    const rowBtns: Node[] = [];
    const mkRow = (y: number): Node => {
      const row = this.uiNode('row'); row.addComponent(UITransform).setContentSize(360, 52); row.setPosition(0, y, 0); card.addChild(row);
      const rowBg = this.makeSprite('row_setting', 360, 52, 'row-bg');
      if (rowBg) row.addChild(rowBg);
      else {
        const rg = row.addComponent(Graphics);
        rg.fillColor = new Color(247, 242, 234, 255); rg.roundRect(-180, -26, 360, 52, 12); rg.fill();
      }
      rowBtns.push(row);
      return row;
    };
    /* 音效 */
    const sndRow = mkRow(112);
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
    const musRow = mkRow(36);
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
    const ruleRow = mkRow(-40);
    const rlb = this.makeLabel('怎么玩（随时回看）', 21, '#6b5b4e'); rlb.node.setPosition(0, 0, 0); ruleRow.addChild(rlb.node);
    ruleRow.on(Input.EventType.TOUCH_END, () => { this.play('click'); this.dismissMask(mask); this.showRules(() => { }); });
    /* 重置进度（两步确认，5s 超时回退） */
    let armed = false;
    let disarmTimer: number | null = null;
    const rstRow = mkRow(-116);
    const redrawRst = () => {
      rstRow.removeAllChildren();
      if (armed) {
        const rgN = this.uiNode('rst-armed'); rgN.addComponent(UITransform).setContentSize(360, 52);
        const rg2 = rgN.addComponent(Graphics);
        rg2.fillColor = new Color(229, 83, 60, 255); rg2.roundRect(-180, -26, 360, 52, 12); rg2.fill();
        rstRow.addChild(rgN);
      } else {
        const rowBg = this.makeSprite('row_setting', 360, 52, 'row-bg');
        if (rowBg) rstRow.addChild(rowBg);
        else {
          const rg2 = this.uiNode('rst-bg'); rg2.addComponent(UITransform).setContentSize(360, 52);
          const g2 = rg2.addComponent(Graphics);
          g2.fillColor = new Color(247, 242, 234, 255); g2.roundRect(-180, -26, 360, 52, 12); g2.fill();
          rstRow.addChild(rg2);
        }
      }
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
    about.node.setPosition(0, -178, 0); card.addChild(about.node);
    card.addChild(this.makeButton('关闭', new Vec3(0, -196, 0), () => this.dismissMask(mask), { accent: true }));
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
  private makeLabel(text: string, size: number, color: string, outline?: string, outlineW = 2): Label {
    const n = this.uiNode('label');
    n.addComponent(UITransform);
    const lb = n.addComponent(Label);
    if (this.uiFont) lb.font = this.uiFont;   /* 卡通字体（站酷快乐体子集），未加载完回退系统字 */
    lb.string = text; lb.fontSize = size; lb.lineHeight = size * 1.3;
    lb.color = new Color(this.hexColor(color)[0], this.hexColor(color)[1], this.hexColor(color)[2], 255);
    if (outline) {
      const lo = lb.addComponent(LabelOutline);
      lo.color = new Color(this.hexColor(outline)[0], this.hexColor(outline)[1], this.hexColor(outline)[2], 255);
      lo.width = outlineW;
    }
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
    const normal = this.sf('btn_normal');
    const pressed = this.sf('btn_pressed');
    const sp = n.addComponent(Sprite);
    if (normal) {
      sp.type = Sprite.Type.SIMPLE; sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.spriteFrame = normal;
      n.getComponent(UITransform)!.setContentSize(w, h);
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
    const lb = this.makeLabel(text, 20, '#ffffff', '#6b5b4e', 2);
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
  /* 弹窗卡片工厂：panel 贴图自带落影（缺图回退 Graphics 白卡+影子） */
  private cardShell(mask: Node, cw: number, ch: number): Node {
    const card = this.uiNode('card-shell');
    card.addComponent(UITransform).setContentSize(cw, ch);
    const p = this.makeSprite('panel', cw + 22, ch + 30);
    if (p) {
      card.addChild(p);
    } else {
      const cg = card.addComponent(Graphics);
      cg.fillColor = new Color(60, 46, 32, 60);
      cg.roundRect(-cw / 2 - 6, -ch / 2 - 8, cw + 12, ch, 18); cg.fill();
      cg.fillColor = new Color(255, 255, 255, 255);
      cg.roundRect(-cw / 2, -ch / 2, cw, ch, 16); cg.fill();
    }
    mask.addChild(card);
    return card;
  }
  private showOverlay(big: string, title: string, body: string, cb: () => void, btnText: string, infoOnly = false, titleImg?: string) {
    const { width: W } = this.viewSize();
    const mask = this.makeMask(infoOnly);   /* 信息类弹窗可点遮罩关闭 */
    const card = this.cardShell(mask, Math.min(460, W - 40), 380);
    /* 头像：能用自家猫就用，emoji 只做兜底（上移避开标题） */
    const av = this.makeSprite('cat_idle', 72, 80);
    if (av) { av.setPosition(0, 134, 0); card.addChild(av); }
    else {
      const bigLb = this.makeLabel(big, 48, INK); bigLb.node.setPosition(0, 122, 0); card.addChild(bigLb.node);
    }
    /* 标题：艺术字贴图优先 */
    const tImg = titleImg ? this.makeSprite(titleImg, title.length > 4 ? 300 : 180, title.length > 4 ? 50 : 49) : null;
    if (tImg) { tImg.setPosition(0, 56, 0); card.addChild(tImg); }
    else {
      const t = this.makeLabel(title, 26, INK); t.node.setPosition(0, 58, 0); card.addChild(t.node);
    }
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
    const tb = this.makeSprite('toast_dark', 360, 48);
    if (tb) t.addChild(tb);
    else {
      const g = t.addComponent(Graphics);
      g.fillColor = new Color(60, 46, 32, 210);
      g.roundRect(-180, -24, 360, 48, 24); g.fill();
    }
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
