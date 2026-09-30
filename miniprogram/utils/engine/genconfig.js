/* 生成配置（单一来源）：CLI（engine/cli.js）与 web 生成器（web/gen.html）共用同一份，
 * 改这一处即双端同步——「地图生成与数据单独配置化，多版使用相同的配置」。
 * UMD：Node require / 浏览器 script 标签 / 小程序 require 均可加载。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.CatChess = root.CatChess || {}; Object.assign(root.CatChess, factory()); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {
    /* 难度带：|score - target| ≤ DIFF_BAND 视为带内 */
    DIFF_BAND: 5,
    /* size ≥ WEIGHT_MIN_SIZE 时按小区块权重择优；带内 W ≥ W_ACCEPT 提前接受 */
    WEIGHT_MIN_SIZE: 12,
    W_ACCEPT: 70,
    /* 重试预算（CLI 与 web 生成器一致） */
    ROUNDS: 3,
    ATTEMPTS: 150,
    /* web 生成器宽限：带内已有候选且耗时超过此值即收手（W 未达 W_ACCEPT 也不再等，
     * 大棋盘单次尝试约 0.3~1.5s，避免点击后长时间等待）；CLI 批量生成不受此限 */
    WEB_GRACE_MS: 6000,

    /* 单次生成尝试参数：难度目标 + 随机源 → 强制格数 / 生长偏置 / 收紧档位。
     * 强制格数随难度递减；收紧保留格数按棋盘尺寸分档（高阶大棋盘恒收紧且保留 4~7 格，
     * 减少 1~4 格碎区块——实测小区块惩罚 P 减半以上且难度带内仍可达；
     * 小棋盘维持 2~3 + 原概率，小区块是中小盘的形态多样性）。 */
    paramSpace: function (size, target, rng) {
      const hard = Math.min(1, Math.max(0, target / 100));
      let forcedWish = Math.round(size * (0.40 - 0.32 * hard));    /* 越难强制格越少 */
      forcedWish = Math.max(1, Math.min(size - 2, forcedWish));
      forcedWish = Math.max(1, forcedWish + Math.round((rng() * 2 - 1) * 1.5)); /* 抖动 */
      const horizBias = 0.15 + rng() * 0.7;                        /* 条状化程度随机 */
      let tighten, tightenMin, tightenMax;
      if (size >= 16) { tighten = true; tightenMin = 5; tightenMax = 7; }
      else if (size >= 12) { tighten = true; tightenMin = 4; tightenMax = 5; }
      else { tighten = hard > 0.45 ? rng() < 0.7 : rng() < 0.25; tightenMin = 2; tightenMax = 3; }
      return { forcedWish: forcedWish, horizBias: horizBias, tighten: tighten, tightenMin: tightenMin, tightenMax: tightenMax };
    }
  };
});
