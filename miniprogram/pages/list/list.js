var LEVELS = require('../../data/levels.js');

Page({
  data: { groups: [] },

  onLoad: function () {
    var won = wx.getStorageSync('zmm_won') || {};
    var bySize = {};
    LEVELS.forEach(function (l) { (bySize[l.size] = bySize[l.size] || []).push(l); });
    var sizes = Object.keys(bySize).map(Number).sort(function (a, b) { return a - b; });
    var unlocked = function (id) { return id === 1 || !!won[id - 1]; };
    this.setData({
      groups: sizes.map(function (s) {
        return {
          size: s,
          levels: bySize[s].map(function (l) {
            return {
              id: l.id, name: l.name, difficulty: l.difficulty,
              done: !!won[l.id], locked: !unlocked(l.id)
            };
          })
        };
      })
    });
  },

  onTapLevel: function (e) {
    var id = e.currentTarget.dataset.id;
    var locked = e.currentTarget.dataset.locked;
    if (locked) {
      wx.showToast({ title: '先通过上一关喵', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/game/game?id=' + id });
  }
});
