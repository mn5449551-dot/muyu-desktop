// app.js
const storage = require('./utils/storage');
const { KEYS } = storage;

App({
  onLaunch() {
    this.globalData.soundEnabled = storage.get(KEYS.SOUND_ENABLED, true);
    this.globalData.vibrationEnabled = storage.get(KEYS.VIBRATION_ENABLED, true);
  },
  globalData: {
    soundEnabled: true,
    vibrationEnabled: true,
  },
});
