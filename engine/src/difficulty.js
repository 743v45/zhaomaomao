/* 难度打分（1~100）：尺寸分 + 逻辑分 + 强制格分 → 单调校准表。
 * score(level, trace) 的 trace 来自 hint.analyze（同一份推理链，保证打分与提示一致）。
 * 本文件由 `node engine/cli.js recalibrate` 整体生成——校准表为 100 关 raw 全序排名 → 1..100；
 * 手工修改会被下次 recalibrate 覆盖。UMD 三端通用。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.CatChess = root.CatChess || {}; Object.assign(root.CatChess, factory()); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const r2 = v => Math.round(v * 100) / 100;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* 校准表（recalibrate 烘焙）：raw 全序 → 1..100，单调分段线性插值 */
  const CAL_RAW = [4,6.71,8.08,9.43,12.14,12.49,13.71,15.44,16.77,17.77,18.6,19.76,20.26,21.6,21.85,22.82,23.99,24.97,25.4,26.43,28.58,29.88,30.88,32.9,33.37,34.1,34.77,36.64,36.66,37.63,37.81,40.02,40.41,44.55,44.67,45.96,46.33,46.84,47.77,48.14,48.46,48.93,49.84,50,50.06,50.18,51.29,52.25,53.08,53.41,53.74,54.28,54.85,55.49,56.42,56.44,57.9,58.14,58.79,59.91,62.1,62.36,62.77,62.85,62.95,63.57,63.86,64.3,64.96,65.06,65.95,66.55,66.58,66.94,67.17,67.94,68.28,68.7,69.93,70.33,71.71,71.97,72.46,72.54,73.36,73.9,74.13,74.22,74.64,75.2,76.5,79.33,79.76,80.69,81.34,81.68,82.23,83.51,84.85,87.16];
  const CAL_SCORE = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100];
  function calibrate(raw) {
    if (raw <= CAL_RAW[0]) return CAL_SCORE[0];
    const last = CAL_RAW.length - 1;
    if (raw >= CAL_RAW[last]) return CAL_SCORE[last];
    let lo = 0, hi = last;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (CAL_RAW[mid] <= raw) lo = mid; else hi = mid; }
    if (CAL_RAW[lo] === raw) return CAL_SCORE[lo];
    const t = (raw - CAL_RAW[lo]) / (CAL_RAW[hi] - CAL_RAW[lo]);
    return Math.round(CAL_SCORE[lo] + t * (CAL_SCORE[hi] - CAL_SCORE[lo]));
  }

  function score(level, trace) {
    const n = level.size, regions = level.regions;
    const steps = (trace && trace.steps) || [];
    const wsum = steps.reduce((s, st) => s + (st.weight || 0), 0);
    const trials = steps.filter(st => st.type === 'trial').length;

    let K = 0; for (let i = 0; i < regions.length; i++) if (regions[i] + 1 > K) K = regions[i] + 1;
    let forced = 0; {
      const sizes = new Array(K).fill(0);
      for (let i = 0; i < regions.length; i++) sizes[regions[i]]++;
      forced = sizes.filter(s => s === 1).length;
    }

    const sizePts = ((n - 6) / 14) * 38;                                    // 0 ~ 38（6x6 → 20x20）
    const wavg = wsum / n;                                                   // 平均每只猫的推理权重
    const logicPts = Math.max(0, Math.min(1, (wavg - 1.5) / 4.5)) * 38 + 4;  // 4 ~ 42（推理链加权）
    const forcedPts = (1 - Math.min(1, (forced * 2) / n)) * 8;               // 0 ~ 8（强制格越多越容易）

    const raw = sizePts + logicPts + forcedPts;
    const total = clamp(calibrate(raw), 1, 100);
    return {
      total: total,
      raw: r2(raw),
      detail: { sizePts: r2(sizePts), logicPts: r2(logicPts), forcedPts: r2(forcedPts), wsum: wsum, trials: trials, regions: K, forced: forced }
    };
  }

  return { score: score };
});
