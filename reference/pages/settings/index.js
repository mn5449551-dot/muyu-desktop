// pages/settings/index.js
const storage = require('../../utils/storage');
const { KEYS } = storage;

Page({
  data: {
    soundEnabled: true,
    vibrationEnabled: true,
  },

  onLoad() {
    this.setData({
      soundEnabled: storage.get(KEYS.SOUND_ENABLED, true),
      vibrationEnabled: storage.get(KEYS.VIBRATION_ENABLED, true),
    });
  },

  onUnload() {
    if (this._tryAudio) {
      try { this._tryAudio.destroy(); } catch (e) {}
    }
  },

  onSoundChange(e) {
    const val = e.detail.value;
    this.setData({ soundEnabled: val });
    storage.set(KEYS.SOUND_ENABLED, val);
    getApp().globalData.soundEnabled = val;
  },

  onVibrationChange(e) {
    const val = e.detail.value;
    this.setData({ vibrationEnabled: val });
    storage.set(KEYS.VIBRATION_ENABLED, val);
    getApp().globalData.vibrationEnabled = val;
  },

  trySound() {
    if (!this._tryAudio) {
      this._tryAudio = wx.createInnerAudioContext();
      this._tryAudio.obeyMuteSwitch = false;
      this._tryAudio.onerror = () => {};
    }
    this._tryAudio.src = '/assets/audio/muyu_main.mp3';
    this._tryAudio.seek(0);
    this._tryAudio.play();
  },

  tryVibration() {
    wx.vibrateShort({ type: 'medium' });
  },
});
