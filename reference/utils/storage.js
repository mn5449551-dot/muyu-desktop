// Storage key constants
const KEYS = {
  CURRENT_CHAR: 'muyu_current_char',
  TOTAL_COUNT: 'muyu_total_count',
  SOUND_ENABLED: 'muyu_sound_enabled',
  VIBRATION_ENABLED: 'muyu_vibration_enabled',
  UNLOCKED_CHARS: 'muyu_unlocked_chars',
  UNLOCKED_SHOWN: 'muyu_unlocked_shown',
};

function get(key, defaultVal) {
  try {
    const val = wx.getStorageSync(key);
    return val !== '' && val !== undefined && val !== null ? val : defaultVal;
  } catch (e) {
    return defaultVal;
  }
}

function set(key, val) {
  try {
    wx.setStorageSync(key, val);
  } catch (e) {}
}

module.exports = { KEYS, get, set };
