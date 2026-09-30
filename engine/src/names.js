/* 关卡命名素材（Node 端 CLI 专用） */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.CatChess = root.CatChess || {}; Object.assign(root.CatChess, factory()); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 尺寸 → 主题（小地图 → 大地图） */
  const THEMES = [
    { max: 7, name: '小院' },
    { max: 10, name: '街区' },
    { max: 14, name: '公园' },
    { max: 18, name: '城区' },
    { max: 99, name: '猫都' }
  ];

  const CAT_NAMES = [
    '团子', '煤球', '布丁', '年糕', '麻薯', '汤圆', '雪球', '花卷', '豆包', '奶糖',
    '橘皮', '瓜皮', '芝麻', '杏仁', '松饼', '曲奇', '泡芙', '奶酪', '蜂蜜', '奶茶',
    '抹茶', '可可', '咖啡', '奶昔', '苏打', '柚子', '柠檬', '桃子', '莓果', '椰果'
  ];

  function levelName(id, size) {
    const theme = THEMES.find(t => size <= t.max).name;
    const cat = CAT_NAMES[(id * 7 + 3) % CAT_NAMES.length];
    return theme + '·' + cat;
  }

  return { THEMES, CAT_NAMES, levelName };
});
