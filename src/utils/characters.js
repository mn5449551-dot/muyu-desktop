export const DEFAULT_CHARACTERS = [
  {
    id: 'baihu',
    name: '白虎',
    idleImg: '/images/baihu_idle.webp',
    hitImg: '/images/baihu_hit.webp',
    mainAudio: '/audio/baihu_main.mp3',
    rareAudio: '/audio/baihu_rare.mp3',
    rareAudioPool: [],
    animationType: 'static',
    floatTextColor: '#FF4444',
    voiceType: 'zh_male_taocheng_uranus_bigtts',
    voiceEmotion: 'happy',
    isActive: true,
    sortOrder: 0,
    isCustom: false,
  },
  {
    id: 'muyu',
    name: '木鱼',
    idleImg: '/images/muyu_idle.webp',
    hitImg: '/images/muyu_hit.webp',
    mainAudio: '/audio/muyu_main.mp3',
    rareAudio: '',
    rareAudioPool: ['/audio/muyu_rare_1.mp3', '/audio/muyu_rare_2.mp3', '/audio/muyu_rare_3.mp3'],
    animationType: 'static',
    floatTextColor: '#FFD76A',
    voiceType: 'zh_male_m191_uranus_bigtts',
    voiceEmotion: 'neutral',
    isActive: true,
    sortOrder: 1,
    isCustom: false,
  },
  {
    id: 'hamster_orange',
    name: '橙色仓鼠',
    idleImg: '/images/hamster_orange_idle.webp',
    hitImg: '/images/hamster_orange_hit.webp',
    mainAudio: '/audio/hamster_orange_main.mp3',
    rareAudio: '',
    rareAudioPool: [],
    animationType: 'static',
    floatTextColor: '#FF4444',
    voiceType: 'zh_female_xiaohe_uranus_bigtts',
    voiceEmotion: 'happy',
    isActive: true,
    sortOrder: 2,
    isCustom: false,
  },
  {
    id: 'hamster_gray',
    name: '灰色仓鼠',
    idleImg: '/images/hamster_gray_idle.webp',
    hitImg: '/images/hamster_gray_hit.webp',
    mainAudio: '/audio/hamster_gray_main.mp3',
    rareAudio: '/audio/hamster_gray_rare.mp3',
    rareAudioPool: [],
    animationType: 'static',
    floatTextColor: '#FF4444',
    voiceType: 'zh_female_vv_uranus_bigtts',
    voiceEmotion: 'neutral',
    isActive: false,
    sortOrder: 3,
    isCustom: false,
  },
  {
    id: 'frog',
    name: '青蛙',
    idleImg: '/images/frog_idle.webp',
    hitImg: '/images/frog_hit.webp',
    mainAudio: '/audio/frog_main.mp3',
    rareAudio: '/audio/frog_rare.mp3',
    rareAudioPool: [],
    animationType: 'static',
    floatTextColor: '#FF4444',
    voiceType: 'zh_female_vv_uranus_bigtts',
    voiceEmotion: 'happy',
    isActive: false,
    sortOrder: 4,
    isCustom: false,
  },
  {
    id: 'capybara',
    name: '癞蛤蟆',
    idleImg: '/images/capybara_idle.webp',
    hitImg: '/images/capybara_hit.webp',
    mainAudio: '/audio/capybara_main.mp3',
    rareAudio: '',
    rareAudioPool: [],
    animationType: 'static',
    floatTextColor: '#FF4444',
    voiceType: 'zh_female_vv_uranus_bigtts',
    voiceEmotion: 'comfort',
    isActive: false,
    sortOrder: 5,
    isCustom: false,
  },
  {
    id: 'qinglong',
    name: '青龙',
    idleImg: '/images/qinglong_idle.webp',
    hitImg: '/images/qinglong_hit.webp',
    mainAudio: '/audio/qinglong_main.mp3',
    rareAudio: '',
    rareAudioPool: [],
    animationType: 'static',
    floatTextColor: '#FF4444',
    voiceType: 'zh_female_vv_uranus_bigtts',
    voiceEmotion: 'neutral',
    isActive: false,
    sortOrder: 6,
    isCustom: false,
  },
  {
    id: 'zhuque',
    name: '朱雀',
    idleImg: '/images/zhuque_idle.webp',
    hitImg: '/images/zhuque_hit.webp',
    mainAudio: '/audio/zhuque_main.mp3',
    rareAudio: '',
    rareAudioPool: [],
    animationType: 'static',
    floatTextColor: '#FF4444',
    voiceType: 'zh_female_vv_uranus_bigtts',
    voiceEmotion: 'happy',
    isActive: false,
    sortOrder: 7,
    isCustom: false,
  },
  {
    id: 'xuanwu',
    name: '玄武',
    idleImg: '/images/xuanwu_idle.webp',
    hitImg: '/images/xuanwu_hit.webp',
    mainAudio: '/audio/xuanwu_main.mp3',
    rareAudio: '/audio/xuanwu_rare.mp3',
    rareAudioPool: [],
    animationType: 'static',
    floatTextColor: '#FF4444',
    voiceType: 'zh_female_vv_uranus_bigtts',
    voiceEmotion: 'neutral',
    isActive: false,
    sortOrder: 8,
    isCustom: false,
  },
]

function normalizeAssetPath(assetPath) {
  if (!assetPath) return ''
  if (assetPath.startsWith('http://') || assetPath.startsWith('https://') || assetPath.startsWith('file://')) return assetPath
  if (assetPath.startsWith('./images/')) return assetPath.slice(2)
  if (assetPath.startsWith('./audio/')) return assetPath.slice(2)
  // In packaged macOS app, renderer runs on file://.../index.html.
  // Root paths like /images/... resolve to file system root and break.
  if (assetPath.startsWith('/images/')) return assetPath.slice(1)
  if (assetPath.startsWith('/audio/')) return assetPath.slice(1)
  if (assetPath.startsWith('images/')) return assetPath
  if (assetPath.startsWith('audio/')) return assetPath
  if (assetPath.startsWith('/')) return assetPath
  return assetPath
}

function normalizeCharacter(row) {
  return {
    id: row.id,
    name: row.name,
    idleImg: normalizeAssetPath(row.idleImg),
    hitImg: normalizeAssetPath(row.hitImg),
    mainAudio: normalizeAssetPath(row.mainAudio),
    rareAudio: normalizeAssetPath(row.rareAudio),
    rareAudioPool: Array.isArray(row.rareAudioPool)
      ? row.rareAudioPool.map((item) => normalizeAssetPath(item)).filter(Boolean)
      : [],
    chatSystemPrompt: typeof row.chatSystemPrompt === 'string' ? row.chatSystemPrompt : '',
    animationType: row.animationType || 'static',
    floatTextColor: row.floatTextColor || '#FF4444',
    voiceType: row.voiceType || 'zh_female_vv_uranus_bigtts',
    voiceEmotion: row.voiceEmotion || 'auto',
    isActive: Boolean(row.isActive),
    sortOrder: Number.isFinite(row.sortOrder) ? row.sortOrder : 0,
    isCustom: Boolean(row.isCustom),
  }
}

export function mergeCharacters(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return DEFAULT_CHARACTERS

  const mergedMap = new Map(DEFAULT_CHARACTERS.map((item) => [item.id, item]))

  rows.forEach((row) => {
    const current = mergedMap.get(row.id) || {}
    mergedMap.set(row.id, normalizeCharacter({ ...current, ...row }))
  })

  return Array.from(mergedMap.values()).sort((a, b) => a.sortOrder - b.sortOrder)
}

export function findById(id, characterList = DEFAULT_CHARACTERS) {
  return characterList.find((item) => item.id === id) || characterList[0]
}

export function getActiveChars(characterList = DEFAULT_CHARACTERS) {
  return characterList.filter((item) => item.isActive)
}
