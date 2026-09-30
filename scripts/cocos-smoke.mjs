#!/usr/bin/env node
/* Cocos 版冒烟验收（零依赖）：chrome-headless-shell + CDP 驱动 __zmmCocos。
 * 用法: node scripts/cocos-smoke.mjs [基址，默认 http://localhost:8137]
 * 前置: npm run build-cocos 后经 Cocos CLI 构建 web-mobile；本地服务指向仓库根（npm run serve）。
 * 检查项：
 *   1) 游戏可启动（__zmmCocos.ready 资源加载完成）
 *   2) L1 驱动通关（won=true, fails=0, 星级入库）
 *   3) 顺序解锁生效（通关后 L2 解锁）
 *   4) 存档持久化（localStorage 有 zmm_cocos_v1）
 *   5) 截图 docs/screenshots/cocos-smoke.png 供人工复核视觉 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://localhost:8137').replace(/\/$/, '');
const URL_GAME = BASE + '/cocos/build/web-mobile/index.html';
const SHOT = 'docs/screenshots/cocos-smoke.png';
const CANDIDATES = [
  '~/.cache/puppeteer/chrome-headless-shell/mac_arm-152.0.7977.54/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  '~/.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.204/chrome-headless-shell-mac-arm64/chrome-headless-shell'
].map(p => p.replace(/^~/, os.homedir()));
import { existsSync } from 'node:fs';
const BIN = CANDIDATES.find(existsSync);
if (!BIN) { console.error('未找到 chrome-headless-shell（' + CANDIDATES.join(' 或 ') + '）'); process.exit(2); }

const PORT = 9334;
const proc = spawn(BIN, [
  '--headless', '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=880,1600',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + mkdtempSync(path.join(os.tmpdir(), 'zmm-cocos-smoke-')),
  'about:blank'
], { stdio: 'ignore' });
const cleanup = () => { try { proc.kill('SIGKILL'); } catch (_) {} };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function getJson(pathname, method = 'GET') {
  const res = await fetch('http://127.0.0.1:' + PORT + pathname, { method });
  return res.json();
}
let ok = false;
for (let i = 0; i < 50 && !ok; i++) {
  try { await getJson('/json/version'); ok = true; } catch (_) { await delay(100); }
}
if (!ok) { console.error('chrome-headless-shell 调试端口未就绪'); process.exit(2); }

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error(method + ' 超时')); } }, 60000);
  });
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({
      send,
      close: () => ws.close(),
      evaluate: async expression => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.error) throw new Error(r.error.message);
        const v = r.result;
        if (v.exceptionDetails) throw new Error('页面异常: ' + (v.exceptionDetails.exception?.description || v.exceptionDetails.text));
        return v.result.value;
      },
      screenshot: async file => {
        await send('Page.enable');
        const r = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(file, Buffer.from(r.result.data, 'base64'));
      }
    });
    ws.onerror = () => reject(new Error('WebSocket 连接失败'));
  });
}

let bad = 0;
try {
  const tab = await getJson('/json/new?' + encodeURIComponent(URL_GAME), 'PUT');
  const client = await cdp(tab.webSocketDebuggerUrl);
  await client.send('Emulation.setDeviceMetricsOverride', { width: 880, height: 1600, deviceScaleFactor: 2, mobile: true });
  /* 等游戏启动 + 资源加载（__zmmCocos.ready） */
  const boot = await client.evaluate(`(async () => {
    for (let i = 0; i < 300; i++) {
      if (window.__zmmCocos && window.__zmmCocos.ready && window.__zmmCocos.ready()) break;
      await new Promise(r => setTimeout(r, 100));
    }
    if (!window.__zmmCocos) return { error: '__zmmCocos 未就绪（游戏未启动）' };
    if (!window.__zmmCocos.ready()) return { error: '资源加载未完成（ready=false）' };
    return { ok: true, bg: window.__zmmCocos.background() };
  })()`);
  if (boot.error) { bad++; console.log('启动 ✗ ' + boot.error); }
  else {
    console.log('启动 ✓ 资源就绪（背景图 ' + (boot.bg ? '已加载' : '缺失') + '）');
    if (!boot.bg) bad++;
    /* 视觉验收四连拍：规则页(首次启动) → 列表 → 胜利弹窗 → 棋盘 */
    mkdirSync('docs/screenshots', { recursive: true });
    await delay(500);
    await client.screenshot('docs/screenshots/cocos-rules.png');   /* 首次启动规则弹窗应在最前 */
    await client.evaluate(`window.__zmmCocos.closeOverlay()`);
    await delay(500);
    await client.screenshot('docs/screenshots/cocos-list.png');    /* 列表页（星级/锁/难度条） */
    /* L1 驱动通关 */
    const g = await client.evaluate(`(() => {
      const z = window.__zmmCocos;
      if (!z.load(1)) return { error: 'L1 加载失败' };
      for (const rc of z.level().solution) z.dbltap(rc[0], rc[1]);
      return { won: z.isWon(), fails: z.fails(), cats: z.catCount(), stars: z.save().won['1'] || 0,
        unlockedHas2: z.unlocked().includes(2), persisted: !!localStorage.getItem('zmm_cocos_v1') };
    })()`);
    if (g.error || !g.won || g.fails !== 0) { bad++; console.log('通关 ✗ ' + JSON.stringify(g)); }
    else if (!g.unlockedHas2) { bad++; console.log('解锁 ✗ 通关后 L2 未解锁'); }
    else if (!g.persisted) { bad++; console.log('存档 ✗ localStorage 无 zmm_cocos_v1'); }
    else console.log('通关 ✓ L1 驱动通关（猫 ' + g.cats + '，失败 0，' + (g.stars || '?') + '★，L2 已解锁，存档已写入）');
    await delay(700);
    await client.screenshot('docs/screenshots/cocos-win.png');     /* 胜利弹窗（星级+彩纸期间） */
    await client.evaluate(`window.__zmmCocos.closeOverlay()`);
    await delay(500);
    await client.screenshot('docs/screenshots/cocos-board.png');   /* 棋盘页（猫/按钮/猜错图标） */
    await client.evaluate(`(() => { window.__zmmCocos.backToList(); return true; })()`);
    await delay(800);
    console.log('截图 → docs/screenshots/cocos-{rules,list,win,board}.png');
  }
  client.close();
} catch (e) { bad++; console.log('冒烟异常 ✗ ' + e.message); }

console.log(bad ? 'Cocos 冒烟: 失败' : 'Cocos 冒烟: 通过');
process.exit(bad ? 1 : 0);
