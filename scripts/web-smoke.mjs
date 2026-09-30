#!/usr/bin/env node
/* 网页冒烟验收（零依赖）：chrome-headless-shell + 内置 WebSocket 走 CDP。
 * 用法: node scripts/web-smoke.mjs [基址，默认 http://localhost:8137]
 * 检查项：
 *   1) 游戏页 /web/ 经 window.__zmm（真实 pointer 事件）驱动 L1 通关（won=true, fails=0）；
 *   2) 生成器页 /web/gen.html 自动出图成功，且 __zmmGen.generateMap 带种子可复现。
 * 供 20 分钟 QA 循环与 CI 使用；正式关卡验收仍走 CLI accept 回写。 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://localhost:8137').replace(/\/$/, '');
const CANDIDATES = [
  '~/.cache/puppeteer/chrome-headless-shell/mac_arm-152.0.7977.54/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  '~/.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.204/chrome-headless-shell-mac-arm64/chrome-headless-shell'
].map(p => p.replace(/^~/, os.homedir()));
import { existsSync } from 'node:fs';
const BIN = CANDIDATES.find(existsSync);
if (!BIN) { console.error('未找到 chrome-headless-shell（' + CANDIDATES.join(' 或 ') + '）'); process.exit(2); }

const PORT = 9333;
const proc = spawn(BIN, [
  '--headless', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + mkdtempSync(path.join(os.tmpdir(), 'zmm-smoke-')),
  'about:blank'
], { stdio: 'ignore' });
const cleanup = () => { try { proc.kill('SIGKILL'); } catch (_) {} };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); });

/* 等调试端口就绪 */
async function getJson(pathname, method = 'GET') {
  const res = await fetch('http://127.0.0.1:' + PORT + pathname, { method });
  return res.json();
}
let ok = false;
for (let i = 0; i < 50 && !ok; i++) {
  try { await getJson('/json/version'); ok = true; } catch (_) { await delay(100); }
}
if (!ok) { console.error('chrome-headless-shell 调试端口未就绪'); process.exit(2); }

/* 极简 CDP 客户端 */
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
      }
    });
    ws.onerror = () => reject(new Error('WebSocket 连接失败'));
  });
}

async function openPage(url) {
  const tab = await getJson('/json/new?' + encodeURIComponent(url), 'PUT');
  const client = await cdp(tab.webSocketDebuggerUrl);
  for (let i = 0; i < 100; i++) {
    const ready = await client.evaluate('document.readyState === "complete"').catch(() => false);
    if (ready) return client;
    await delay(100);
  }
  throw new Error('页面加载超时: ' + url);
}

let bad = 0;
try {
  /* 1) 游戏页 */
  const game = await openPage(BASE + '/web/');
  const g = await game.evaluate(`(async () => {
    for (let i = 0; i < 100; i++) { if (window.__zmm && window.LEVELS) break; await new Promise(r => setTimeout(r, 50)); }
    if (!window.__zmm || !window.LEVELS) return { error: '接口未就绪' };
    if (!window.__zmm.load(1)) return { error: 'L1 加载失败' };
    for (const rc of window.__zmm.level().solution) window.__zmm.dbltap(rc[0], rc[1]);
    return { won: window.__zmm.isWon(), fails: window.__zmm.fails(), cats: window.__zmm.catCount() };
  })()`);
  game.close();
  if (g.error || !g.won || g.fails !== 0) { bad++; console.log('游戏页 ✗ ' + JSON.stringify(g)); }
  else console.log('游戏页 ✓ L1 pointer 驱动通关（猫 ' + g.cats + '，失败 0）');

  /* 2) 生成器页 */
  const gen = await openPage(BASE + '/web/gen.html');
  const r = await gen.evaluate(`(async () => {
    for (let i = 0; i < 600; i++) { if (window.__zmmGen && !document.getElementById('genBtn').disabled) break; await new Promise(r => setTimeout(r, 100)); }
    if (!window.__zmmGen) return { error: '__zmmGen 未就绪' };
    const auto = { tries: __zmmGen.state.tries, ms: __zmmGen.state.ms, diff: __zmmGen.state.rec && __zmmGen.state.rec.sc.total, W: __zmmGen.state.rec && __zmmGen.state.rec.W };
    const a = await __zmmGen.generateMap(10, 30, 12345);
    const b = await __zmmGen.generateMap(10, 30, 12345);
    const c = await __zmmGen.generateMap(16, 75, null);
    return { auto, repro: JSON.stringify(a.best.level.regions) === JSON.stringify(b.best.level.regions),
      big: { diff: c.best && c.best.sc.total, W: c.best && c.best.W, tries: c.tries, ms: c.ms, withinGrace: c.ms < 20000 } };
  })()`);
  gen.close();
  if (r.error) { bad++; console.log('生成器页 ✗ ' + r.error); }
  else if (!r.repro) { bad++; console.log('生成器页 ✗ 种子复现失败 ' + JSON.stringify(r)); }
  else if (!r.big || !r.big.withinGrace) { bad++; console.log('生成器页 ✗ 16×16 超时 ' + JSON.stringify(r.big)); }
  else console.log('生成器页 ✓ 自动出图 ' + r.auto.tries + ' 次/' + r.auto.ms + 'ms（难度 ' + r.auto.diff + ' W' + r.auto.W +
    '）；种子复现 ✓；16×16 难度 ' + r.big.diff + ' W' + r.big.W + ' ' + r.big.tries + ' 次/' + r.big.ms + 'ms（宽限内 ✓）');
} catch (e) { bad++; console.log('冒烟异常 ✗ ' + e.message); }

console.log(bad ? '网页冒烟: 失败' : '网页冒烟: 通过');
process.exit(bad ? 1 : 0);
