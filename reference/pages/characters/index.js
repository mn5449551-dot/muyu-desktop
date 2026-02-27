// pages/characters/index.js
const storage = require('../../utils/storage');
const { KEYS } = storage;
const { CHARACTERS, UNLOCK_THRESHOLDS } = require('../../utils/characters');

const WARM_COLORS = ['#FFFCEE', '#FFD76A', '#FFB3A0', '#B8E8C0'];

Page({
  data: {
    cards: [],
  },

  onLoad() {
    // Pre-generate stable tilt and bg per character — prevents reshuffling on each visit
    this._cardStyles = {};
    CHARACTERS.forEach(c => {
      this._cardStyles[c.id] = {
        tilt: parseFloat(((Math.random() < 0.5 ? 1 : -1) * (Math.random() * 3 + 1)).toFixed(1)),
        bg: WARM_COLORS[Math.floor(Math.random() * WARM_COLORS.length)],
      };
    });
  },

  onShow() {
    const currentId   = storage.get(KEYS.CURRENT_CHAR, 'muyu');
    const unlockedIds = storage.get(KEYS.UNLOCKED_CHARS, ['muyu']);
    const totalCount  = storage.get(KEYS.TOTAL_COUNT, 0);
    const cards = CHARACTERS.map(c => {
      const isLocked = !unlockedIds.includes(c.id);
      const need = isLocked ? Math.max(0, (UNLOCK_THRESHOLDS[c.id] || 0) - totalCount) : 0;
      const selected = c.id === currentId && !isLocked;
      const { tilt: baseTilt, bg } = this._cardStyles[c.id];
      const tilt = selected ? 0 : baseTilt;
      return { ...c, selected, tilt, bg, isLocked, need };
    });
    this.setData({ cards });
  },

  onSelect(e) {
    const id = e.currentTarget.dataset.id;
    const card = this.data.cards.find(c => c.id === id);
    if (!card) return;
    if (card.isLocked) {
      if (card.need === 0) {
        // Count already meets threshold — unlock and select immediately
        const unlockedIds = storage.get(KEYS.UNLOCKED_CHARS, ['muyu']);
        storage.set(KEYS.UNLOCKED_CHARS, unlockedIds.concat([card.id]));
        storage.set(KEYS.CURRENT_CHAR, card.id);
        wx.navigateBack();
        return;
      }
      // Shake the locked card for feedback
      const idx = this.data.cards.findIndex(c => c.id === id);
      if (idx !== -1) {
        this.setData({ [`cards[${idx}].shaking`]: true });
        setTimeout(() => { this.setData({ [`cards[${idx}].shaking`]: false }); }, 250);
      }
      wx.showToast({ title: `再敲 ${card.need} 次解锁`, icon: 'none', duration: 1500 });
      return;
    }
    storage.set(KEYS.CURRENT_CHAR, id);
    wx.navigateBack();
  },
});
