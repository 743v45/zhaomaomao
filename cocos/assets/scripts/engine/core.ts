/* 由 npm run build 自动生成（源自 engine/src，禁止手改） */
export default function () {
  'use strict';

  /* 24 色柔和调色板：[css 颜色, 中文名]。
   * 规则（taevas 确认）：同一颜色全盘必定只属于一个连通块 ⇒ 区块数 ≤ 调色板长度，
   * 每个区块直接独占一种颜色（regionColors = 恒等映射），不做图着色复用。 */
  const PALETTE = [
    ['#F7C6D2', '樱粉'], ['#FCE38A', '柠檬黄'], ['#B8E6B0', '薄荷绿'], ['#AED6F5', '天空蓝'],
    ['#D9C4EE', '香芋紫'], ['#F8C48E', '蜜橘'], ['#9FD8D4', '湖水青'], ['#F5A9A0', '珊瑚红'],
    ['#C3E88F', '青草绿'], ['#9CC5E8', '冰蓝'], ['#F7E7B4', '奶油'], ['#D6E8C8', '鼠尾草'],
    ['#E9C3B4', '豆沙'], ['#C5C8EE', '淡紫蓝'], ['#F2B279', '落日橙'], ['#A8DFC5', '翡翠绿'],
    ['#F2AFC9', '玫瑰粉'], ['#E8DDB4', '浅卡其'], ['#B8CCDF', '雾蓝'], ['#E3C6DC', '藕荷'],
    ['#FCD4B0', '奶杏'], ['#CFE8DA', '浅葱'], ['#E8D0F0', '丁香'], ['#F8E2C8', '香草']
  ];

  /* 区块编号 → 字母（A..Z, AA..），用于文档与提示 */
  function regionLetter(i) {
    let s = ''; i = i + 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  function cellName(r, c) { return 'R' + (r + 1) + 'C' + (c + 1); }

  /* 统计区块数量 */
  function regionCount(regions) { let k = 0; for (let i = 0; i < regions.length; i++) if (regions[i] + 1 > k) k = regions[i] + 1; return k; }

  /* 各区块的格子列表：id -> [[r,c],...] */
  function regionCells(n, regions) {
    const K = regionCount(regions);
    const out = Array.from({ length: K }, () => []);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[regions[r * n + c]].push([r, c]);
    return out;
  }

  /* 区块着色：每区块独占一色（同色必连通 ⇒ 恒等映射，区块 i 用调色板 i）。
   * 兼容保留函数签名；返回 regionColors[id] = 调色板下标。 */
  function computeRegionColors(n, regions) {
    const K = regionCount(regions);
    const colors = new Array(K);
    for (let i = 0; i < K; i++) colors[i] = i;
    return colors;
  }

  /* 放置校验：给定猫的位置列表，返回全部违规（行/列/区块重复、八邻相邻）。
   * cats: [[r,c],...]（0 基）。胜利判定 = isWin。 */
  function checkPlacement(level, cats) {
    const n = level.size, regions = level.regions;
    const vi = [];
    const rowMap = new Map(), colMap = new Map(), regMap = new Map();
    for (const rc of cats) {
      const [r, c] = rc, g = regions[r * n + c];
      if (!rowMap.has(r)) rowMap.set(r, []); rowMap.get(r).push(rc);
      if (!colMap.has(c)) colMap.set(c, []); colMap.get(c).push(rc);
      if (!regMap.has(g)) regMap.set(g, []); regMap.get(g).push(rc);
    }
    rowMap.forEach((list, r) => { if (list.length > 1) vi.push({ type: 'row', cells: list, text: '第 ' + (r + 1) + ' 行有 ' + list.length + ' 只猫' }); });
    colMap.forEach((list, c) => { if (list.length > 1) vi.push({ type: 'col', cells: list, text: '第 ' + (c + 1) + ' 列有 ' + list.length + ' 只猫' }); });
    regMap.forEach((list, g) => { if (list.length > 1) vi.push({ type: 'region', cells: list, text: '区块 ' + regionLetter(g) + ' 有 ' + list.length + ' 只猫' }); });
    for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) {
      const dr = Math.abs(cats[i][0] - cats[j][0]), dc = Math.abs(cats[i][1] - cats[j][1]);
      if (dr <= 1 && dc <= 1) vi.push({ type: 'adj', cells: [cats[i], cats[j]], text: cellName(cats[i][0], cats[i][1]) + ' 与 ' + cellName(cats[j][0], cats[j][1]) + ' 八向相邻' });
    }
    return vi;
  }

  function isWin(level, cats) {
    return cats.length === level.size && checkPlacement(level, cats).length === 0;
  }

  return { PALETTE, regionLetter, cellName, regionCount, regionCells, computeRegionColors, checkPlacement, isWin };
};
