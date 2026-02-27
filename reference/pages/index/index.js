// pages/index/index.js
const storage = require('../../utils/storage');
const { KEYS } = storage;
const { CHARACTERS, findById, UNLOCK_THRESHOLDS } = require('../../utils/characters');
const { getRandom } = require('../../utils/text-pool');

const MILESTONES = {
  100: '整！',
  500: '妙！',
  1000: '牛！',
  2333: '超神！',
  9999: '封神！',
};

const PARTICLE_COLORS = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF9F1C', '#E040FB', '#00BCD4', '#FF5722'];

Page({
  data: {
    char: null,
    count: 0,
    progress: 0,
    progressHint: '',
    isHit: false,
    shakeClass: '',
    squeezeClass: '',
    switchClass: '',
    floatTexts: [],
    particles: [],
    showBadge: false,
    badgeText: '',
    countShakeClass: '',
    showUnlockModal: false,
    unlockChar: null,
  },

  // ── Lifecycle ────────────────────────────

  onLoad() {
    const charId = storage.get(KEYS.CURRENT_CHAR, 'muyu');
    const char = findById(charId);
    const count = storage.get(KEYS.TOTAL_COUNT, 0);

    this.setData({ char, count, progress: this._getProgress(count), progressHint: this._getProgressHint(count) });

    // Animation toggle state (non-reactive)
    this._useA = true;
    this._quadrant = 0;
    this._csUseA = true;
    this._lastWasRare = false;
    this._rareIsPlaying = false;
    this._shareImagePath = '';

    // Storage debounce cache
    this._pendingCount = count;

    // Unlock state in-memory cache (avoids repeated StorageSync reads on every tap)
    this._unlocked = storage.get(KEYS.UNLOCKED_CHARS, ['muyu']);
    this._shown    = storage.get(KEYS.UNLOCKED_SHOWN,  ['muyu']);

    // Audio setup
    this._mainAudio = wx.createInnerAudioContext();
    this._rareAudio = wx.createInnerAudioContext();
    this._mainAudio.obeyMuteSwitch = false;
    this._rareAudio.obeyMuteSwitch = false;
    this._mainAudio.onerror = () => {};
    this._rareAudio.onerror = () => {};

    // Track when rare finishes so taps can resume normal audio
    this._rareAudio.onEnded(() => { this._rareIsPlaying = false; });
    this._rareAudio.onError(() => { this._rareIsPlaying = false; });

    this._setupAudio(char);
    this._checkPendingUnlocks();
    this._buildShareImage();
  },

  onShow() {
    // Refresh character if changed from characters page
    const charId = storage.get(KEYS.CURRENT_CHAR, 'muyu');
    const cur = this.data.char;
    const changed = !cur || cur.id !== charId;
    if (changed) {
      const newChar = findById(charId);
      this._setupAudio(newChar);
      this._rareIsPlaying = false;
      this._lastWasRare = false;
      this.setData({ switchClass: 'switch-squish-out' });
      setTimeout(() => {
        this.setData({ char: newChar, switchClass: 'switch-expand-in' });
        this._buildShareImage();
        setTimeout(() => { this.setData({ switchClass: '' }); }, 160);
      }, 160);
    }
    // Refresh settings
    const gd = getApp().globalData;
    gd.soundEnabled = storage.get(KEYS.SOUND_ENABLED, true);
    gd.vibrationEnabled = storage.get(KEYS.VIBRATION_ENABLED, true);
  },

  onHide() {
    storage.set(KEYS.TOTAL_COUNT, this._pendingCount);
  },

  onUnload() {
    clearTimeout(this._hitTimer);
    clearTimeout(this._badgeTimer);
    storage.set(KEYS.TOTAL_COUNT, this._pendingCount);
    if (this._mainAudio) { try { this._mainAudio.destroy(); } catch (e) {} }
    if (this._rareAudio) { try { this._rareAudio.destroy(); } catch (e) {} }
  },

  // ── Core tap ─────────────────────────────

  onTap() {
    if (this.data.switchClass) return;

    const newCount = this.data.count + 1;

    // Toggle A/B animation classes
    this._useA = !this._useA;
    const shakeClass = this._useA ? 'shake-anim-a' : 'shake-anim-b';
    const squeezeClass = this._useA ? 'squeeze-anim-a' : 'squeeze-anim-b';

    // Compute all visual updates synchronously before a single setData
    const { floatTexts, textId } = this._computeFloatText(newCount);
    const particles = this._computeParticles(newCount);
    const milestoneUpdates = this._computeMilestoneUpdates(newCount);

    this.setData({
      count: newCount,
      progress: this._getProgress(newCount),
      progressHint: this._getProgressHint(newCount),
      isHit: true,
      shakeClass,
      squeezeClass,
      floatTexts,
      particles,
      ...milestoneUpdates,
    });

    this._pendingCount = newCount;
    if (newCount % 10 === 0) storage.set(KEYS.TOTAL_COUNT, newCount);

    // Async cleanups
    if (this._hitTimer) clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => { this.setData({ isHit: false }); }, 300);

    setTimeout(() => {
      this.setData({ floatTexts: this.data.floatTexts.filter(t => t.id !== textId) });
    }, 1600);

    setTimeout(() => { this.setData({ particles: [] }); }, 700);

    if (milestoneUpdates.showBadge) {
      if (this._badgeTimer) clearTimeout(this._badgeTimer);
      this._badgeTimer = setTimeout(() => { this.setData({ showBadge: false }); }, 2500);
      setTimeout(() => { this.setData({ countShakeClass: '' }); }, 650);
    }

    this._playSound();
    this._tryVibrate();
    this._checkUnlock(newCount);

    if (newCount % 50 === 0) {
      this._buildShareImage();
    }
  },

  // ── Navigation ───────────────────────────

  goChars() {
    wx.navigateTo({ url: '/pages/characters/index' });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  // ── Share ────────────────────────────────

  onShareAppMessage() {
    this._buildShareImage();
    return {
      title: `我已经解压了${this.data.count}次，换你了`,
      imageUrl: this._shareImagePath || this.data.char?.idleImg || '',
    };
  },

  onShareTimeline() {
    return {
      title: `我已经解压了${this.data.count}次，换你了`,
    };
  },

  // ── Unlock modal ─────────────────────────

  closeUnlockModal() {
    this.setData({ showUnlockModal: false, unlockChar: null });
  },

  // ── Private helpers ──────────────────────

  _setupAudio(char) {
    if (this._mainAudio) this._mainAudio.src = char.mainAudio;
    if (this._rareAudio && char.rareAudio) this._rareAudio.src = char.rareAudio;
  },

  _playSound() {
    if (!getApp().globalData.soundEnabled) return;

    // Rare is still playing — mute this tap so the punchline lands
    if (this._rareIsPlaying) return;

    const char = this.data.char;
    const pool = char.rareAudioPool;
    const hasRare = (pool && pool.length > 0) || !!char.rareAudio;
    const useRare = hasRare && !this._lastWasRare && Math.random() < 0.02;
    this._lastWasRare = useRare;

    if (useRare) {
      const src = (pool && pool.length > 0)
        ? pool[Math.floor(Math.random() * pool.length)]
        : char.rareAudio;
      this._rareAudio.src = src;
      this._rareIsPlaying = true;
      try {
        this._rareAudio.seek(0);
        this._rareAudio.play();
      } catch (e) {
        this._rareIsPlaying = false;
      }
      return;
    }

    try {
      this._mainAudio.seek(0);
      this._mainAudio.play();
    } catch (e) {}
  },

  _tryVibrate() {
    if (!getApp().globalData.vibrationEnabled) return;
    wx.vibrateShort({ type: 'light' });
  },

  _computeFloatText(tapCount) {
    const id = `ft_${tapCount}`;
    // Quadrant rotation to reduce overlap: 0=left-top, 1=right-top, 2=left-bottom, 3=right-bottom
    const q = this._quadrant;
    this._quadrant = (q + 1) % 4;
    const baseLeft = (q % 2 === 0) ? 8 : 42;
    const baseTop  = (q < 2)       ? 12 : 38;
    const left = baseLeft + Math.random() * 30;
    const top  = baseTop  + Math.random() * 22;
    const isMuyu = this.data.char?.id === 'muyu';
    const color = isMuyu ? '#FFD76A' : '#FF4444';
    const floatTexts = this.data.floatTexts
      .concat([{ id, text: getRandom(isMuyu), left, top, color }])
      .slice(-6);
    return { floatTexts, textId: id };
  },

  _computeParticles(tapCount) {
    const num = 5 + Math.floor(Math.random() * 4); // 5–8
    const particles = [];
    for (let i = 0; i < num; i++) {
      const size = Math.round(20 + Math.random() * 30);
      particles.push({
        id: `p_${tapCount}_${i}`,
        dir: i % 8,
        x: 44 + Math.random() * 12,
        y: 38 + Math.random() * 12,
        color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
        size,
      });
    }
    return particles;
  },

  _getProgress(count) {
    const segments = [0, 100, 500, 1000, 2333, 9999];
    if (count >= 9999) return 100;
    for (let i = 0; i < segments.length - 1; i++) {
      if (count < segments[i + 1]) {
        const lo = segments[i];
        const hi = segments[i + 1];
        return Math.round((count - lo) / (hi - lo) * 100);
      }
    }
    return 100;
  },

  _getProgressHint(count) {
    const segments = [100, 500, 1000, 2333, 9999];
    if (count >= 9999) return '已封神！';
    for (let i = 0; i < segments.length; i++) {
      if (count < segments[i]) {
        return `下一里程碑: ${segments[i]}`;
      }
    }
    return '';
  },

  _computeMilestoneUpdates(count) {
    const text = MILESTONES[count];
    if (!text) return {};
    this._csUseA = !this._csUseA;
    return {
      showBadge: true,
      badgeText: text,
      countShakeClass: this._csUseA ? 'count-shake-a' : 'count-shake-b',
    };
  },

  _checkUnlock(newCount) {
    CHARACTERS.forEach(char => {
      const threshold = UNLOCK_THRESHOLDS[char.id];
      if (!threshold || this._unlocked.includes(char.id)) return;
      if (newCount < threshold) return;
      // Newly unlocked — update cache and persist
      this._unlocked = this._unlocked.concat([char.id]);
      storage.set(KEYS.UNLOCKED_CHARS, this._unlocked);
      if (!this._shown.includes(char.id)) {
        this._shown = this._shown.concat([char.id]);
        storage.set(KEYS.UNLOCKED_SHOWN, this._shown);
        this.setData({
          showUnlockModal: true,
          unlockChar: { id: char.id, name: char.name, idleImg: char.idleImg },
        });
      }
    });
  },

  _checkPendingUnlocks() {
    const count = this.data.count;
    // Include free chars (threshold=0) AND count-reached chars
    const toUnlock = CHARACTERS.filter(c =>
      !this._unlocked.includes(c.id) &&
      (UNLOCK_THRESHOLDS[c.id] === 0 || count >= UNLOCK_THRESHOLDS[c.id])
    );
    if (!toUnlock.length) return;
    const ids = toUnlock.map(c => c.id);
    this._unlocked = this._unlocked.concat(ids);
    this._shown    = this._shown.concat(ids);
    storage.set(KEYS.UNLOCKED_CHARS, this._unlocked);
    storage.set(KEYS.UNLOCKED_SHOWN, this._shown);
    // Silent unlock — don't pop modal for existing users on upgrade
  },

  _buildShareImage() {
    const char = this.data.char;
    if (!char) return;
    try {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: 500, height: 400 });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFCEE';
      ctx.fillRect(0, 0, 500, 400);
      const img = canvas.createImage();
      img.onload = () => {
        ctx.drawImage(img, 100, 30, 300, 300);
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(char.name, 250, 360);
        ctx.font = '26px sans-serif';
        ctx.fillStyle = '#888888';
        ctx.fillText(`已解压 ${this.data.count} 次`, 250, 395);
        wx.canvasToTempFilePath({
          canvas,
          success: (res) => { this._shareImagePath = res.tempFilePath; },
          fail:    () =>    { this._shareImagePath = char.idleImg; },
        });
      };
      img.onerror = () => { this._shareImagePath = char.idleImg; };
      img.src = char.idleImg;
    } catch (e) {
      this._shareImagePath = char.idleImg;
    }
  },
});
