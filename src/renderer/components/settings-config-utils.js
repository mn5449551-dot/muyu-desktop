const PET_SCALE_MIN = 0.6
const PET_SCALE_MAX = 1.8
const DEFAULT_ASR_MODE = 'stream'
const DEFAULT_ASR_STREAM_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
const DEFAULT_ASR_STREAM_RESOURCE_ID = 'volc.seedasr.sauc.duration'
const DEFAULT_ASR_FILE_RESOURCE_ID = 'volc.seedasr.auc'
const ASR_STREAM_RESOURCE_PREFIX = 'volc.seedasr.sauc.'
const ASR_FILE_RESOURCE_PREFIX = '.auc'
const DEFAULT_ROLE_VOICE_TYPE = 'zh_female_vv_uranus_bigtts'
const DEFAULT_ROLE_VOICE_EMOTION = 'auto'

const ROLE_VOICE_OPTIONS = Object.freeze([
  { value: 'zh_female_vv_uranus_bigtts', label: 'Vivi 2.0（通用女声）', tone: '通用、多语、情绪覆盖广' },
  { value: 'zh_male_taocheng_uranus_bigtts', label: '小天 2.0（张力男声）', tone: '适合反差、冲突感表达' },
  { value: 'zh_female_xiaohe_uranus_bigtts', label: '小何 2.0（轻快女声）', tone: '适合活泼、陪聊氛围' },
  { value: 'zh_male_m191_uranus_bigtts', label: '云舟 2.0（沉稳男声）', tone: '适合安抚、慢节奏回复' },
])

const ROLE_VOICE_EMOTION_OPTIONS = Object.freeze([
  { value: 'auto', label: '自动（按文本识别）' },
  { value: 'happy', label: '开心 / 轻快' },
  { value: 'comfort', label: '安慰 / 鼓励' },
  { value: 'tension', label: '紧张 / 急促' },
  { value: 'angry', label: '生气 / 压迫感' },
  { value: 'storytelling', label: '讲述 / 叙事' },
  { value: 'tender', label: '温柔 / 轻声' },
  { value: 'neutral', label: '中性 / 平稳' },
])

const ROLE_VOICE_EMOTION_SET = new Set(ROLE_VOICE_EMOTION_OPTIONS.map((item) => item.value))

function normalizeRoleVoiceEmotion(value, fallback = DEFAULT_ROLE_VOICE_EMOTION) {
  const raw = String(value || '').trim().toLowerCase()
  if (ROLE_VOICE_EMOTION_SET.has(raw)) return raw
  return ROLE_VOICE_EMOTION_SET.has(fallback) ? fallback : DEFAULT_ROLE_VOICE_EMOTION
}

function clampPetScale(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.max(PET_SCALE_MIN, Math.min(PET_SCALE_MAX, Number(n.toFixed(2))))
}

function toCharacterForm(character, fallbackSortOrder = 0) {
  if (!character) {
    return {
      id: '',
      name: '',
      animationType: 'static',
      sortOrder: fallbackSortOrder,
      isActive: true,
      idleImg: '',
      hitImg: '',
      mainAudio: '',
      rareAudio: '',
      rareAudioPoolText: '',
      chatSystemPrompt: '',
      floatTextColor: '#FF4444',
      voiceType: DEFAULT_ROLE_VOICE_TYPE,
      voiceEmotion: DEFAULT_ROLE_VOICE_EMOTION,
      isCustom: true,
    }
  }

  return {
    id: character.id,
    name: character.name,
    animationType: character.animationType || 'static',
    sortOrder: character.sortOrder,
    isActive: character.isActive,
    idleImg: character.idleImg || '',
    hitImg: character.hitImg || '',
    mainAudio: character.mainAudio || '',
    rareAudio: character.rareAudio || '',
    rareAudioPoolText: Array.isArray(character.rareAudioPool) ? character.rareAudioPool.join('\n') : '',
    chatSystemPrompt: character.chatSystemPrompt || '',
    floatTextColor: character.floatTextColor || '#FF4444',
    voiceType: character.voiceType || DEFAULT_ROLE_VOICE_TYPE,
    voiceEmotion: normalizeRoleVoiceEmotion(character.voiceEmotion, DEFAULT_ROLE_VOICE_EMOTION),
    isCustom: character.isCustom,
  }
}

function parseRareAudioPool(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeAsrMode(mode, asrResourceId = '') {
  const value = String(mode || '').trim().toLowerCase()
  if (value === 'stream' || value === 'file') return value
  const resource = String(asrResourceId || '').trim().toLowerCase()
  if (resource.startsWith(ASR_STREAM_RESOURCE_PREFIX)) return 'stream'
  if (resource.includes(ASR_FILE_RESOURCE_PREFIX)) return 'file'
  return DEFAULT_ASR_MODE
}

function defaultAsrResourceIdByMode(mode) {
  return mode === 'file' ? DEFAULT_ASR_FILE_RESOURCE_ID : DEFAULT_ASR_STREAM_RESOURCE_ID
}

function normalizeAsrResourceIdByMode(mode, value) {
  const text = String(value || '').trim()
  if (text) return text
  return defaultAsrResourceIdByMode(normalizeAsrMode(mode, text))
}

function buildSettingsConfig(appConfig = {}) {
  const llm = appConfig.llm || {}
  const voice = appConfig.voice || {}
  const asrMode = normalizeAsrMode(voice.asrMode, voice.asrResourceId)

  return {
    baseUrl: llm.baseUrl || '',
    model: llm.model || '',
    temperature: Number.isFinite(llm.temperature) ? llm.temperature : 0.7,
    maxContext: Number.isFinite(llm.maxContext) ? llm.maxContext : 20,
    multiAgentEnabled: llm.multiAgentEnabled !== false,
    memorySummarySystemPrompt: llm.memorySummarySystemPrompt || '',
    apiKey: '',
    apiKeyConfigured: Boolean(llm.apiKeyConfigured),
    encryptionAvailable: Boolean(llm.encryptionAvailable),
    voiceRegion: voice.region || 'cn-beijing',
    voiceAppId: voice.appId || '',
    voiceAccessKey: '',
    voiceAccessKeyConfigured: Boolean(voice.accessKeyConfigured),
    voiceAsrMode: asrMode,
    voiceAsrResourceId: normalizeAsrResourceIdByMode(asrMode, voice.asrResourceId),
    voiceAsrStreamUrl: String(voice.asrStreamUrl || DEFAULT_ASR_STREAM_URL),
    voiceAsrUploadEndpoint: voice.asrUploadEndpoint || '',
    voiceTtsResourceId: voice.ttsResourceId || '',
    voiceTtsFormat: voice.ttsFormat || 'mp3',
    voiceTtsSampleRate: Number.isFinite(voice.ttsSampleRate) ? voice.ttsSampleRate : 24000,
    voiceEncryptionAvailable: Boolean(voice.encryptionAvailable),
  }
}

function buildLlmConfigSavePayload(config, { apiKeyDirty = false } = {}) {
  const payload = {
    llm: {
      baseUrl: config.baseUrl,
      model: config.model,
      temperature: Number(config.temperature),
      maxContext: Number(config.maxContext),
      multiAgentEnabled: Boolean(config.multiAgentEnabled),
      memorySummarySystemPrompt: String(config.memorySummarySystemPrompt || '').trim(),
    },
  }

  if (apiKeyDirty) {
    payload.llm.apiKey = config.apiKey
  }

  return payload
}

function buildVoiceConfigSavePayload(config, { voiceAccessKeyDirty = false } = {}) {
  const payload = {
    voice: {
      region: config.voiceRegion,
      appId: config.voiceAppId,
      asrMode: normalizeAsrMode(config.voiceAsrMode, config.voiceAsrResourceId),
      asrResourceId: normalizeAsrResourceIdByMode(config.voiceAsrMode, config.voiceAsrResourceId),
      asrStreamUrl: String(config.voiceAsrStreamUrl || '').trim() || DEFAULT_ASR_STREAM_URL,
      asrUploadEndpoint: config.voiceAsrUploadEndpoint,
      ttsResourceId: config.voiceTtsResourceId,
      ttsFormat: config.voiceTtsFormat,
      ttsSampleRate: Number(config.voiceTtsSampleRate),
    },
  }

  if (voiceAccessKeyDirty) {
    payload.voice.accessKey = config.voiceAccessKey
  }

  return payload
}

function buildLlmTestPayload(config, { apiKeyDirty = false, typedKey = '' } = {}) {
  const payload = {
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: Number(config.temperature),
  }

  if (apiKeyDirty) {
    payload.apiKey = typedKey
  }

  return payload
}

function buildVoiceTestPayload(config, { voiceAccessKeyDirty = false, typedToken = '' } = {}) {
  const payload = {
    appId: String(config.voiceAppId || '').trim(),
    ttsResourceId: String(config.voiceTtsResourceId || '').trim(),
    asrMode: normalizeAsrMode(config.voiceAsrMode, config.voiceAsrResourceId),
    asrResourceId: normalizeAsrResourceIdByMode(config.voiceAsrMode, config.voiceAsrResourceId),
    asrStreamUrl: String(config.voiceAsrStreamUrl || '').trim() || DEFAULT_ASR_STREAM_URL,
    ttsFormat: String(config.voiceTtsFormat || 'mp3').trim().toLowerCase(),
    ttsSampleRate: Number(config.voiceTtsSampleRate),
  }

  if (voiceAccessKeyDirty) {
    payload.accessKey = typedToken
  }

  return payload
}

export {
  DEFAULT_ASR_FILE_RESOURCE_ID,
  DEFAULT_ASR_MODE,
  DEFAULT_ASR_STREAM_RESOURCE_ID,
  DEFAULT_ASR_STREAM_URL,
  PET_SCALE_MAX,
  PET_SCALE_MIN,
  buildLlmConfigSavePayload,
  buildVoiceConfigSavePayload,
  buildLlmTestPayload,
  buildSettingsConfig,
  buildVoiceTestPayload,
  clampPetScale,
  normalizeAsrMode,
  normalizeAsrResourceIdByMode,
  parseRareAudioPool,
  ROLE_VOICE_EMOTION_OPTIONS,
  ROLE_VOICE_OPTIONS,
  toCharacterForm,
}
