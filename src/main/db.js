const Database = require('better-sqlite3')
const path = require('path')
const { app, safeStorage } = require('electron')
const log = require('./logger')

const DEFAULT_LLM_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const DEFAULT_LLM_MODEL = 'doubao-seed-2-0-mini-260215'
const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_MAX_CONTEXT = 20
const DEFAULT_MULTI_AGENT_ENABLED = true
const DEFAULT_PET_SCALE = 1
const MIN_PET_SCALE = 0.6
const MAX_PET_SCALE = 1.8
const DEFAULT_CHAT_SIDE = 'right'
const DEFAULT_CHAT_OFFSET_X = 20
const DEFAULT_CHAT_OFFSET_Y = -10
const DEFAULT_MEMORY_SUMMARY_SYSTEM_PROMPT = '你是长期记忆提取器。请把对话总结为 3-6 条短要点（总计不超过 120 字），仅保留长期有价值信息：事实、偏好、目标、约束、约定。不要复述寒暄，不要编造，不要输出无关解释。'
const DEFAULT_VOICE_ENABLED = false
const DEFAULT_VOICE_AUTO_PLAY = true
const DEFAULT_VOICE_REGION = 'cn-beijing'
const DEFAULT_VOICE_ASR_MODE = 'stream'
const LEGACY_VOICE_ASR_STREAM_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream'
const DEFAULT_VOICE_ASR_STREAM_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
const DEFAULT_VOICE_ASR_RESOURCE_ID = 'volc.seedasr.sauc.duration'
const DEFAULT_VOICE_ASR_FILE_RESOURCE_ID = 'volc.seedasr.auc'
const DEFAULT_VOICE_ASR_UPLOAD_ENDPOINT = ''
const DEFAULT_VOICE_TTS_RESOURCE_ID = 'seed-tts-2.0'
const DEFAULT_VOICE_TTS_FORMAT = 'mp3'
const DEFAULT_VOICE_TTS_SAMPLE_RATE = 24000
const DEFAULT_CHAR_VOICE_TYPE = 'zh_female_vv_uranus_bigtts'
const DEFAULT_CHAR_VOICE_EMOTION = 'auto'
const DEFAULT_CHAR_VOICE_MAP = Object.freeze({
  baihu: 'zh_male_taocheng_uranus_bigtts',
  hamster_orange: 'zh_female_xiaohe_uranus_bigtts',
  muyu: 'zh_male_m191_uranus_bigtts',
})
const DEFAULT_CHAR_EMOTION_MAP = Object.freeze({
  baihu: 'happy',
  muyu: 'neutral',
  hamster_orange: 'happy',
  hamster_gray: 'neutral',
  frog: 'happy',
  capybara: 'comfort',
  qinglong: 'neutral',
  zhuque: 'happy',
  xuanwu: 'neutral',
})
const SUPPORTED_CHAR_EMOTIONS = new Set([
  'auto',
  'neutral',
  'happy',
  'comfort',
  'angry',
  'tension',
  'storytelling',
  'tender',
])

const DEFAULT_CHAT_PROMPTS = Object.freeze({
  default: '你是木鱼桌宠里的陪伴型 AI。回答要简短、友好、贴近日常。避免危险建议。',
  baihu: `你是“白虎桌宠”，人设是反差搞怪：平时像猫，偶尔傲娇嘴硬；当用户语气挑衅、冒犯、激将或持续抬杠时，你会短暂进入“虎吼模式”回一句有压迫感的话，再迅速收回到搞怪状态。

行为规则：
1) 常态语气：偏搞怪、有个性、会吐槽但不恶意；回复 1-3 句，简短有梗。
2) 虎吼触发（仅语义触发）：当检测到明显挑衅/冒犯时，允许用一次“虎吼句”表达威慑感（不辱骂、不威胁、不违法）。
3) 虎吼频率限制：连续对话中最多连续触发 1 次，下一轮优先回到猫系搞怪语气。
4) 输出风格：少说教，优先给可执行建议；保持角色一致性与幽默感。
5) 安全边界：拒绝危险、违法、自残、仇恨等内容，改为温和劝阻与替代建议。`,
  muyu: '你是木鱼桌宠，语气平静、温和、略带幽默。每次回复 1-3 句，优先帮助用户放松和专注，避免空话。',
  hamster_orange: '你是橙色仓鼠桌宠，语气活泼可爱但不幼稚。每次回复 1-3 句，给轻松且可执行的小建议。',
  hamster_gray: '你是灰色仓鼠桌宠，语气冷静细致、偏务实。优先给步骤化建议，避免情绪化表达。',
  frog: '你是青蛙桌宠，语气轻松接地气。遇到压力话题先共情，再给一个立刻能做的小行动。',
  capybara: '你是癞蛤蟆桌宠，语气慢节奏、松弛、稳。优先帮用户降压，建议不夸张、可执行。',
  qinglong: '你是青龙桌宠，语气自信克制。先给结论，再给一句理由，避免夸张。',
  zhuque: '你是朱雀桌宠，语气热情明快。鼓励行动但不鸡汤，每次回复 1-3 句。',
  xuanwu: '你是玄武桌宠，语气沉稳谨慎。优先识别风险并给稳妥可行方案。',
})

const DEFAULT_CHARACTERS = [
  {
    id: 'baihu',
    name: '白虎',
    animationType: 'static',
    isActive: 1,
    sortOrder: 0,
    idleImg: 'images/baihu_idle.webp',
    hitImg: 'images/baihu_hit.webp',
    mainAudio: 'audio/baihu_main.mp3',
    rareAudio: 'audio/baihu_rare.mp3',
    rareAudioPool: [],
    floatTextColor: '#FF4444',
    voiceType: getDefaultVoiceTypeForId('baihu'),
    voiceEmotion: getDefaultVoiceEmotionForId('baihu'),
    isCustom: 0,
  },
  {
    id: 'muyu',
    name: '木鱼',
    animationType: 'static',
    isActive: 1,
    sortOrder: 1,
    idleImg: 'images/muyu_idle.webp',
    hitImg: 'images/muyu_hit.webp',
    mainAudio: 'audio/muyu_main.mp3',
    rareAudio: '',
    rareAudioPool: ['audio/muyu_rare_1.mp3', 'audio/muyu_rare_2.mp3', 'audio/muyu_rare_3.mp3'],
    floatTextColor: '#FFD76A',
    voiceType: getDefaultVoiceTypeForId('muyu'),
    voiceEmotion: getDefaultVoiceEmotionForId('muyu'),
    isCustom: 0,
  },
  {
    id: 'hamster_orange',
    name: '橙色仓鼠',
    animationType: 'static',
    isActive: 1,
    sortOrder: 2,
    idleImg: 'images/hamster_orange_idle.webp',
    hitImg: 'images/hamster_orange_hit.webp',
    mainAudio: 'audio/hamster_orange_main.mp3',
    rareAudio: '',
    rareAudioPool: [],
    floatTextColor: '#FF4444',
    voiceType: getDefaultVoiceTypeForId('hamster_orange'),
    voiceEmotion: getDefaultVoiceEmotionForId('hamster_orange'),
    isCustom: 0,
  },
  {
    id: 'hamster_gray',
    name: '灰色仓鼠',
    animationType: 'static',
    isActive: 0,
    sortOrder: 3,
    idleImg: 'images/hamster_gray_idle.webp',
    hitImg: 'images/hamster_gray_hit.webp',
    mainAudio: 'audio/hamster_gray_main.mp3',
    rareAudio: 'audio/hamster_gray_rare.mp3',
    rareAudioPool: [],
    floatTextColor: '#FF4444',
    voiceType: getDefaultVoiceTypeForId('hamster_gray'),
    voiceEmotion: getDefaultVoiceEmotionForId('hamster_gray'),
    isCustom: 0,
  },
  {
    id: 'frog',
    name: '青蛙',
    animationType: 'static',
    isActive: 0,
    sortOrder: 4,
    idleImg: 'images/frog_idle.webp',
    hitImg: 'images/frog_hit.webp',
    mainAudio: 'audio/frog_main.mp3',
    rareAudio: 'audio/frog_rare.mp3',
    rareAudioPool: [],
    floatTextColor: '#FF4444',
    voiceType: getDefaultVoiceTypeForId('frog'),
    voiceEmotion: getDefaultVoiceEmotionForId('frog'),
    isCustom: 0,
  },
  {
    id: 'capybara',
    name: '癞蛤蟆',
    animationType: 'static',
    isActive: 0,
    sortOrder: 5,
    idleImg: 'images/capybara_idle.webp',
    hitImg: 'images/capybara_hit.webp',
    mainAudio: 'audio/capybara_main.mp3',
    rareAudio: '',
    rareAudioPool: [],
    floatTextColor: '#FF4444',
    voiceType: getDefaultVoiceTypeForId('capybara'),
    voiceEmotion: getDefaultVoiceEmotionForId('capybara'),
    isCustom: 0,
  },
  {
    id: 'qinglong',
    name: '青龙',
    animationType: 'static',
    isActive: 0,
    sortOrder: 6,
    idleImg: 'images/qinglong_idle.webp',
    hitImg: 'images/qinglong_hit.webp',
    mainAudio: 'audio/qinglong_main.mp3',
    rareAudio: '',
    rareAudioPool: [],
    floatTextColor: '#FF4444',
    voiceType: getDefaultVoiceTypeForId('qinglong'),
    voiceEmotion: getDefaultVoiceEmotionForId('qinglong'),
    isCustom: 0,
  },
  {
    id: 'zhuque',
    name: '朱雀',
    animationType: 'static',
    isActive: 0,
    sortOrder: 7,
    idleImg: 'images/zhuque_idle.webp',
    hitImg: 'images/zhuque_hit.webp',
    mainAudio: 'audio/zhuque_main.mp3',
    rareAudio: '',
    rareAudioPool: [],
    floatTextColor: '#FF4444',
    voiceType: getDefaultVoiceTypeForId('zhuque'),
    voiceEmotion: getDefaultVoiceEmotionForId('zhuque'),
    isCustom: 0,
  },
  {
    id: 'xuanwu',
    name: '玄武',
    animationType: 'static',
    isActive: 0,
    sortOrder: 8,
    idleImg: 'images/xuanwu_idle.webp',
    hitImg: 'images/xuanwu_hit.webp',
    mainAudio: 'audio/xuanwu_main.mp3',
    rareAudio: 'audio/xuanwu_rare.mp3',
    rareAudioPool: [],
    floatTextColor: '#FF4444',
    voiceType: getDefaultVoiceTypeForId('xuanwu'),
    voiceEmotion: getDefaultVoiceEmotionForId('xuanwu'),
    isCustom: 0,
  },
]

const DEFAULT_CHAR_MAP = new Map(DEFAULT_CHARACTERS.map((item) => [item.id, item]))

let _db = null

function getDefaultChatPromptForId(charId) {
  return DEFAULT_CHAT_PROMPTS[charId] || DEFAULT_CHAT_PROMPTS.default
}

function getDefaultVoiceTypeForId(charId) {
  return DEFAULT_CHAR_VOICE_MAP[charId] || DEFAULT_CHAR_VOICE_TYPE
}

function normalizeVoiceEmotion(value, fallback = DEFAULT_CHAR_VOICE_EMOTION) {
  const raw = String(value || '').trim().toLowerCase()
  if (SUPPORTED_CHAR_EMOTIONS.has(raw)) return raw
  return SUPPORTED_CHAR_EMOTIONS.has(fallback) ? fallback : DEFAULT_CHAR_VOICE_EMOTION
}

function getDefaultVoiceEmotionForId(charId) {
  return normalizeVoiceEmotion(DEFAULT_CHAR_EMOTION_MAP[charId], DEFAULT_CHAR_VOICE_EMOTION)
}

function validatePromptLength(prompt, fieldName) {
  if (prompt.length < 20 || prompt.length > 1200) {
    throw new Error(`${fieldName}长度需在 20 到 1200 字之间`)
  }
}

function getDb() {
  if (_db) return _db

  const dbPath = path.join(app.getPath('userData'), 'muyu.db')
  _db = new Database(dbPath)
  log.info('database opened:', dbPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')

  _db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      animation_type  TEXT NOT NULL DEFAULT 'static',
      is_active       INTEGER NOT NULL DEFAULT 1,
      sort_order      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      ts         INTEGER NOT NULL,
      session_id TEXT NOT NULL DEFAULT 'default'
    );

    CREATE TABLE IF NOT EXISTS memory_summaries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      summary     TEXT NOT NULL,
      from_msg_id INTEGER NOT NULL,
      to_msg_id   INTEGER NOT NULL,
      ts          INTEGER NOT NULL,
      session_id  TEXT NOT NULL DEFAULT 'default'
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  addCharacterColumns()
  seedDefaultCharacters()

  return _db
}

function addColumnIfMissing(columnName, sqlType, defaultClause = '') {
  const db = _db
  const columns = db.prepare('PRAGMA table_info(characters)').all()
  if (columns.some((column) => column.name === columnName)) return

  const defaultSql = defaultClause ? ` ${defaultClause}` : ''
  db.exec(`ALTER TABLE characters ADD COLUMN ${columnName} ${sqlType}${defaultSql}`)
}

function addCharacterColumns() {
  addColumnIfMissing('idle_img', 'TEXT')
  addColumnIfMissing('hit_img', 'TEXT')
  addColumnIfMissing('main_audio', 'TEXT')
  addColumnIfMissing('rare_audio', 'TEXT')
  addColumnIfMissing('rare_audio_pool_json', 'TEXT', "DEFAULT '[]'")
  addColumnIfMissing('chat_system_prompt', 'TEXT')
  addColumnIfMissing('float_text_color', 'TEXT', "DEFAULT '#FF4444'")
  addColumnIfMissing('voice_type', 'TEXT', `DEFAULT '${DEFAULT_CHAR_VOICE_TYPE}'`)
  addColumnIfMissing('voice_emotion', 'TEXT', `DEFAULT '${DEFAULT_CHAR_VOICE_EMOTION}'`)
  addColumnIfMissing('is_custom', 'INTEGER', 'DEFAULT 0')
  addColumnIfMissing('chat_offset_x', 'INTEGER', `DEFAULT ${DEFAULT_CHAT_OFFSET_X}`)
  addColumnIfMissing('chat_offset_y', 'INTEGER', `DEFAULT ${DEFAULT_CHAT_OFFSET_Y}`)
  addColumnIfMissing('chat_side', 'TEXT', `DEFAULT '${DEFAULT_CHAT_SIDE}'`)
  addColumnIfMissing('updated_at', 'INTEGER', 'DEFAULT 0')
}

function seedDefaultCharacters() {
  const db = _db
  const count = db.prepare('SELECT COUNT(*) as n FROM characters').get().n
  const insert = db.prepare(`
    INSERT OR IGNORE INTO characters (
      id, name, animation_type, is_active, sort_order,
      idle_img, hit_img, main_audio, rare_audio, rare_audio_pool_json, chat_system_prompt,
      float_text_color, voice_type, voice_emotion, is_custom, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction(() => {
    DEFAULT_CHARACTERS.forEach((row) => {
      insert.run(
        row.id,
        row.name,
        row.animationType,
        row.isActive,
        row.sortOrder,
        row.idleImg,
        row.hitImg,
        row.mainAudio,
        row.rareAudio,
        JSON.stringify(row.rareAudioPool),
        getDefaultChatPromptForId(row.id),
        row.floatTextColor,
        row.voiceType,
        row.voiceEmotion,
        row.isCustom,
        Date.now()
      )
    })
  })

  if (count === 0) {
    tx()
    return
  }

  // Backfill new columns for existing rows after migration.
  const update = db.prepare(`
    UPDATE characters
    SET
      idle_img = COALESCE(idle_img, ?),
      hit_img = COALESCE(hit_img, ?),
      main_audio = COALESCE(main_audio, ?),
      rare_audio = COALESCE(rare_audio, ?),
      rare_audio_pool_json = CASE
        WHEN rare_audio_pool_json IS NULL OR rare_audio_pool_json = '' THEN ?
        ELSE rare_audio_pool_json
      END,
      chat_system_prompt = COALESCE(NULLIF(chat_system_prompt, ''), ?),
      float_text_color = COALESCE(float_text_color, ?),
      voice_type = COALESCE(NULLIF(voice_type, ''), ?),
      voice_emotion = COALESCE(NULLIF(voice_emotion, ''), ?),
      is_custom = COALESCE(is_custom, 0),
      chat_offset_x = COALESCE(chat_offset_x, ?),
      chat_offset_y = COALESCE(chat_offset_y, ?),
      chat_side = COALESCE(NULLIF(chat_side, ''), ?),
      updated_at = CASE WHEN updated_at = 0 THEN ? ELSE updated_at END
    WHERE id = ?
  `)

  const backfillTx = db.transaction(() => {
    DEFAULT_CHARACTERS.forEach((row) => {
      update.run(
        row.idleImg,
        row.hitImg,
        row.mainAudio,
        row.rareAudio,
        JSON.stringify(row.rareAudioPool),
        getDefaultChatPromptForId(row.id),
        row.floatTextColor,
        row.voiceType,
        row.voiceEmotion,
        DEFAULT_CHAT_OFFSET_X,
        DEFAULT_CHAT_OFFSET_Y,
        DEFAULT_CHAT_SIDE,
        Date.now(),
        row.id
      )
    })
  })

  backfillTx()
}

function parseRarePool(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function normalizeCharacterRow(row) {
  const fallback = DEFAULT_CHAR_MAP.get(row.id) || {}

  return {
    id: row.id,
    name: row.name || fallback.name || row.id,
    animationType: row.animation_type || fallback.animationType || 'static',
    isActive: row.is_active === 1,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : (fallback.sortOrder || 0),
    idleImg: row.idle_img || fallback.idleImg || '',
    hitImg: row.hit_img || fallback.hitImg || '',
    mainAudio: row.main_audio || fallback.mainAudio || '',
    rareAudio: row.rare_audio || fallback.rareAudio || '',
    rareAudioPool: parseRarePool(row.rare_audio_pool_json, fallback.rareAudioPool || []),
    chatSystemPrompt: row.chat_system_prompt || getDefaultChatPromptForId(row.id),
    floatTextColor: row.float_text_color || fallback.floatTextColor || '#FF4444',
    voiceType: row.voice_type || fallback.voiceType || getDefaultVoiceTypeForId(row.id),
    voiceEmotion: normalizeVoiceEmotion(row.voice_emotion, fallback.voiceEmotion || getDefaultVoiceEmotionForId(row.id)),
    isCustom: row.is_custom === 1,
    chatOffsetX: Number.isFinite(row.chat_offset_x) ? row.chat_offset_x : DEFAULT_CHAT_OFFSET_X,
    chatOffsetY: Number.isFinite(row.chat_offset_y) ? row.chat_offset_y : DEFAULT_CHAT_OFFSET_Y,
    chatSide: row.chat_side === 'left' ? 'left' : DEFAULT_CHAT_SIDE,
    updatedAt: row.updated_at || 0,
  }
}

function listCharacters() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM characters ORDER BY sort_order ASC, id ASC').all()
  return rows.map(normalizeCharacterRow)
}

function getState() {
  const db = getDb()
  const countRow = db.prepare("SELECT value FROM app_state WHERE key = 'total_count'").get()
  const charRow = db.prepare("SELECT value FROM app_state WHERE key = 'current_char'").get()

  return {
    count: countRow ? parseInt(countRow.value, 10) : 0,
    currentCharId: charRow ? charRow.value : 'muyu',
  }
}

function saveCount(count) {
  getDb()
    .prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('total_count', ?)")
    .run(String(count))
}

function setCurrentChar(charId) {
  getDb()
    .prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('current_char', ?)")
    .run(charId)
}

function sanitizeCharacterId(input) {
  if (!input || typeof input !== 'string') throw new Error('角色 ID 不能为空')
  const id = input.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_')
  if (!id) throw new Error('角色 ID 非法')
  return id
}

function upsertCharacter(input) {
  const db = getDb()

  const id = sanitizeCharacterId(input.id)
  const existing = db
    .prepare('SELECT id, sort_order, chat_system_prompt, voice_type, voice_emotion, chat_offset_x, chat_offset_y, chat_side FROM characters WHERE id = ?')
    .get(id)

  if (!existing) {
    throw new Error('当前版本不支持新增角色，请编辑已有角色')
  }

  const nextOrder = existing.sort_order

  const isCustom = input.isCustom ? 1 : (DEFAULT_CHAR_MAP.has(id) ? 0 : 1)

  let chatSystemPrompt = typeof input.chatSystemPrompt === 'string'
    ? input.chatSystemPrompt.trim()
    : ''

  if (!chatSystemPrompt && existing?.chat_system_prompt) {
    chatSystemPrompt = String(existing.chat_system_prompt).trim()
  }
  if (!chatSystemPrompt && !isCustom) {
    chatSystemPrompt = getDefaultChatPromptForId(id)
  }
  if (!chatSystemPrompt && isCustom) {
    throw new Error('自定义角色必须填写系统提示词')
  }
  validatePromptLength(chatSystemPrompt, '角色系统提示词')

  const payload = {
    id,
    name: String(input.name || id),
    animationType: String(input.animationType || 'static'),
    isActive: input.isActive ? 1 : 0,
    sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : nextOrder,
    idleImg: String(input.idleImg || ''),
    hitImg: String(input.hitImg || ''),
    mainAudio: String(input.mainAudio || ''),
    rareAudio: String(input.rareAudio || ''),
    rareAudioPool: Array.isArray(input.rareAudioPool) ? input.rareAudioPool : [],
    chatSystemPrompt,
    floatTextColor: String(input.floatTextColor || '#FF4444'),
    voiceType: String(input.voiceType || '').trim() || String(existing?.voice_type || '').trim() || getDefaultVoiceTypeForId(id),
    voiceEmotion: normalizeVoiceEmotion(input.voiceEmotion, normalizeVoiceEmotion(existing?.voice_emotion, getDefaultVoiceEmotionForId(id))),
    isCustom,
    chatOffsetX: Number.isFinite(input.chatOffsetX) ? Math.round(input.chatOffsetX) : (existing?.chat_offset_x ?? DEFAULT_CHAT_OFFSET_X),
    chatOffsetY: Number.isFinite(input.chatOffsetY) ? Math.round(input.chatOffsetY) : (existing?.chat_offset_y ?? DEFAULT_CHAT_OFFSET_Y),
    chatSide: input.chatSide === 'left' ? 'left' : (existing?.chat_side === 'left' ? 'left' : DEFAULT_CHAT_SIDE),
    updatedAt: Date.now(),
  }

  db.prepare(`
    INSERT INTO characters (
      id, name, animation_type, is_active, sort_order,
      idle_img, hit_img, main_audio, rare_audio, rare_audio_pool_json, chat_system_prompt,
      float_text_color, voice_type, voice_emotion, is_custom, chat_offset_x, chat_offset_y, chat_side, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      animation_type = excluded.animation_type,
      is_active = excluded.is_active,
      sort_order = excluded.sort_order,
      idle_img = excluded.idle_img,
      hit_img = excluded.hit_img,
      main_audio = excluded.main_audio,
      rare_audio = excluded.rare_audio,
      rare_audio_pool_json = excluded.rare_audio_pool_json,
      chat_system_prompt = excluded.chat_system_prompt,
      float_text_color = excluded.float_text_color,
      voice_type = excluded.voice_type,
      voice_emotion = excluded.voice_emotion,
      is_custom = excluded.is_custom,
      chat_offset_x = excluded.chat_offset_x,
      chat_offset_y = excluded.chat_offset_y,
      chat_side = excluded.chat_side,
      updated_at = excluded.updated_at
  `).run(
    payload.id,
    payload.name,
    payload.animationType,
    payload.isActive,
    payload.sortOrder,
    payload.idleImg,
    payload.hitImg,
    payload.mainAudio,
    payload.rareAudio,
    JSON.stringify(payload.rareAudioPool),
    payload.chatSystemPrompt,
    payload.floatTextColor,
    payload.voiceType,
    payload.voiceEmotion,
    payload.isCustom,
    payload.chatOffsetX,
    payload.chatOffsetY,
    payload.chatSide,
    payload.updatedAt
  )

  return db.prepare('SELECT * FROM characters WHERE id = ?').get(payload.id)
}

function toggleCharacterActive(id, isActive) {
  const db = getDb()
  db.prepare('UPDATE characters SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive ? 1 : 0, Date.now(), id)
}

function reorderCharacters(ids) {
  if (!Array.isArray(ids)) return

  const db = getDb()
  const update = db.prepare('UPDATE characters SET sort_order = ?, updated_at = ? WHERE id = ?')

  const tx = db.transaction(() => {
    ids.forEach((id, index) => update.run(index, Date.now(), id))
  })

  tx()
}

function getCharacterById(charId) {
  if (!charId) return null
  const db = getDb()
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId)
  return row ? normalizeCharacterRow(row) : null
}

function setCharacterChatWindowPrefs(charId, prefs = {}) {
  if (!charId) return null
  const db = getDb()
  const existing = db.prepare('SELECT id FROM characters WHERE id = ?').get(charId)
  if (!existing) return null

  const offsetX = Number.isFinite(prefs.offsetX) ? Math.round(prefs.offsetX) : DEFAULT_CHAT_OFFSET_X
  const offsetY = Number.isFinite(prefs.offsetY) ? Math.round(prefs.offsetY) : DEFAULT_CHAT_OFFSET_Y
  const side = prefs.side === 'left' ? 'left' : DEFAULT_CHAT_SIDE

  db.prepare(`
    UPDATE characters
    SET
      chat_offset_x = ?,
      chat_offset_y = ?,
      chat_side = ?,
      updated_at = ?
    WHERE id = ?
  `).run(offsetX, offsetY, side, Date.now(), charId)

  return getCharacterById(charId)
}

function getAppStateValue(key) {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key)
  return row ? row.value : null
}

function setAppStateValue(key, value) {
  const db = getDb()

  if (value === null || value === undefined || value === '') {
    db.prepare('DELETE FROM app_state WHERE key = ?').run(key)
    return
  }

  db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(key, String(value))
}

function getBooleanAppStateValue(key, defaultValue = false) {
  const raw = getAppStateValue(key)
  if (raw === null || raw === undefined) return defaultValue
  const value = String(raw).trim().toLowerCase()
  return value === '1' || value === 'true'
}

function normalizeAsrMode(mode, asrResourceId = '') {
  const input = String(mode || '').trim().toLowerCase()
  if (input === 'stream' || input === 'file') return input
  const resource = String(asrResourceId || '').trim().toLowerCase()
  if (resource.includes('.sauc.')) return 'stream'
  if (resource.includes('.auc')) return 'file'
  return DEFAULT_VOICE_ASR_MODE
}

function defaultAsrResourceIdByMode(asrMode) {
  return asrMode === 'file' ? DEFAULT_VOICE_ASR_FILE_RESOURCE_ID : DEFAULT_VOICE_ASR_RESOURCE_ID
}

function normalizeAsrResourceIdByMode(asrMode, asrResourceId = '') {
  const mode = normalizeAsrMode(asrMode, asrResourceId)
  const raw = String(asrResourceId || '').trim()
  if (!raw) return defaultAsrResourceIdByMode(mode)

  const lower = raw.toLowerCase()
  if (mode === 'stream' && lower.includes('.auc')) return DEFAULT_VOICE_ASR_RESOURCE_ID
  if (mode === 'file' && lower.includes('.sauc.')) return DEFAULT_VOICE_ASR_FILE_RESOURCE_ID
  return raw
}

function normalizeAsrStreamUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return DEFAULT_VOICE_ASR_STREAM_URL
  if (raw === LEGACY_VOICE_ASR_STREAM_URL) return DEFAULT_VOICE_ASR_STREAM_URL
  return raw
}

function getNormalizedVoiceAsrConfig() {
  const storedAsrResourceId = getAppStateValue('voice_asr_resource_id') || ''
  const asrMode = normalizeAsrMode(getAppStateValue('voice_asr_mode'), storedAsrResourceId)
  return {
    asrMode,
    asrResourceId: normalizeAsrResourceIdByMode(asrMode, storedAsrResourceId),
    asrStreamUrl: normalizeAsrStreamUrl(getAppStateValue('voice_asr_stream_url')),
  }
}

function clampPetScale(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_PET_SCALE
  return Math.max(MIN_PET_SCALE, Math.min(MAX_PET_SCALE, Number(n.toFixed(2))))
}

function getPetUiPrefs() {
  const rawScale = Number.parseFloat(getAppStateValue('pet_scale') || `${DEFAULT_PET_SCALE}`)
  return {
    scale: clampPetScale(rawScale),
  }
}

function setPetUiPrefs(payload = {}) {
  if (payload.scale !== undefined) {
    setAppStateValue('pet_scale', clampPetScale(payload.scale).toString())
  }
  return getPetUiPrefs()
}

function getChatWindowPrefs() {
  const width = Number.parseInt(getAppStateValue('chat_window_width') || '', 10)
  const height = Number.parseInt(getAppStateValue('chat_window_height') || '', 10)

  return {
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
  }
}

function setChatWindowPrefs(payload = {}) {
  const width = Number(payload.width)
  const height = Number(payload.height)

  if (Number.isFinite(width) && width > 0) {
    setAppStateValue('chat_window_width', String(Math.round(width)))
  }
  if (Number.isFinite(height) && height > 0) {
    setAppStateValue('chat_window_height', String(Math.round(height)))
  }

  return getChatWindowPrefs()
}

function getChatSystemPrompt(charId) {
  const db = getDb()
  const row = db.prepare('SELECT chat_system_prompt FROM characters WHERE id = ?').get(charId)
  const prompt = row && typeof row.chat_system_prompt === 'string'
    ? row.chat_system_prompt.trim()
    : ''
  return prompt || getDefaultChatPromptForId(charId)
}

function getMemorySummarySystemPrompt() {
  const prompt = (getAppStateValue('memory_summary_system_prompt') || '').trim()
  return prompt || DEFAULT_MEMORY_SUMMARY_SYSTEM_PROMPT
}

function getAppConfig() {
  const voiceAsr = getNormalizedVoiceAsrConfig()

  return {
    llm: {
      baseUrl: getAppStateValue('llm_base_url') || DEFAULT_LLM_BASE_URL,
      model: getAppStateValue('llm_model') || DEFAULT_LLM_MODEL,
      temperature: Number.parseFloat(getAppStateValue('llm_temperature') || `${DEFAULT_TEMPERATURE}`),
      maxContext: Number.parseInt(getAppStateValue('llm_max_context') || `${DEFAULT_MAX_CONTEXT}`, 10),
      multiAgentEnabled: getBooleanAppStateValue('llm_multi_agent_enabled', DEFAULT_MULTI_AGENT_ENABLED),
      memorySummarySystemPrompt: getMemorySummarySystemPrompt(),
      apiKeyConfigured: Boolean(getAppStateValue('llm_api_key_enc')),
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    },
    voice: {
      enabled: getBooleanAppStateValue('voice_enabled', DEFAULT_VOICE_ENABLED),
      autoPlay: getBooleanAppStateValue('voice_auto_play', DEFAULT_VOICE_AUTO_PLAY),
      region: getAppStateValue('voice_region') || DEFAULT_VOICE_REGION,
      appId: getAppStateValue('voice_app_id') || '',
      asrMode: voiceAsr.asrMode,
      asrResourceId: voiceAsr.asrResourceId,
      asrStreamUrl: voiceAsr.asrStreamUrl,
      asrUploadEndpoint: getAppStateValue('voice_asr_upload_endpoint') || DEFAULT_VOICE_ASR_UPLOAD_ENDPOINT,
      ttsResourceId: getAppStateValue('voice_tts_resource_id') || DEFAULT_VOICE_TTS_RESOURCE_ID,
      ttsFormat: (getAppStateValue('voice_tts_format') || DEFAULT_VOICE_TTS_FORMAT).toLowerCase(),
      ttsSampleRate: Number.parseInt(
        getAppStateValue('voice_tts_sample_rate') || `${DEFAULT_VOICE_TTS_SAMPLE_RATE}`,
        10
      ),
      accessKeyConfigured: Boolean(getAppStateValue('voice_access_key_enc')),
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    },
  }
}

function setAppConfig(payload) {
  const llm = payload.llm || {}
  const voice = payload.voice || {}

  if (llm.baseUrl !== undefined) setAppStateValue('llm_base_url', llm.baseUrl.trim())
  if (llm.model !== undefined) setAppStateValue('llm_model', llm.model.trim())
  if (llm.temperature !== undefined) setAppStateValue('llm_temperature', Number(llm.temperature).toString())
  if (llm.maxContext !== undefined) setAppStateValue('llm_max_context', Number(llm.maxContext).toString())
  if (llm.multiAgentEnabled !== undefined) {
    setAppStateValue('llm_multi_agent_enabled', llm.multiAgentEnabled ? '1' : '0')
  }
  if (llm.memorySummarySystemPrompt !== undefined) {
    const prompt = String(llm.memorySummarySystemPrompt || '').trim()
    if (!prompt) {
      throw new Error('全局记忆提取提示词不能为空')
    }
    validatePromptLength(prompt, '全局记忆提取提示词')
    setAppStateValue('memory_summary_system_prompt', prompt)
  }

  if (llm.apiKey !== undefined) {
    const apiKey = String(llm.apiKey || '').trim()
    if (!apiKey) {
      setAppStateValue('llm_api_key_enc', null)
    } else {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('当前系统不支持安全加密存储，无法保存 API Key')
      }
      const encrypted = safeStorage.encryptString(apiKey)
      setAppStateValue('llm_api_key_enc', encrypted.toString('base64'))
    }
  }

  if (voice.enabled !== undefined) {
    setAppStateValue('voice_enabled', voice.enabled ? '1' : '0')
  }
  if (voice.autoPlay !== undefined) {
    setAppStateValue('voice_auto_play', voice.autoPlay ? '1' : '0')
  }
  if (voice.region !== undefined) {
    setAppStateValue('voice_region', String(voice.region || '').trim() || DEFAULT_VOICE_REGION)
  }
  if (voice.appId !== undefined) {
    setAppStateValue('voice_app_id', String(voice.appId || '').trim())
  }
  if (voice.asrMode !== undefined) {
    setAppStateValue('voice_asr_mode', normalizeAsrMode(voice.asrMode))
  }
  if (voice.asrResourceId !== undefined) {
    const asrMode = normalizeAsrMode(voice.asrMode, voice.asrResourceId)
    const value = normalizeAsrResourceIdByMode(asrMode, voice.asrResourceId)
    setAppStateValue('voice_asr_resource_id', value)
  }
  if (voice.asrStreamUrl !== undefined) {
    const url = normalizeAsrStreamUrl(voice.asrStreamUrl)
    setAppStateValue('voice_asr_stream_url', url)
  }
  if (voice.asrUploadEndpoint !== undefined) {
    setAppStateValue('voice_asr_upload_endpoint', String(voice.asrUploadEndpoint || '').trim())
  }
  if (voice.ttsResourceId !== undefined) {
    setAppStateValue('voice_tts_resource_id', String(voice.ttsResourceId || '').trim())
  }
  if (voice.ttsFormat !== undefined) {
    const format = String(voice.ttsFormat || '').trim().toLowerCase()
    setAppStateValue('voice_tts_format', format || DEFAULT_VOICE_TTS_FORMAT)
  }
  if (voice.ttsSampleRate !== undefined) {
    const rate = Number.parseInt(voice.ttsSampleRate, 10)
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('语音采样率必须是正整数')
    }
    setAppStateValue('voice_tts_sample_rate', String(rate))
  }
  if (voice.accessKey !== undefined) {
    const accessKey = String(voice.accessKey || '').trim()
    if (!accessKey) {
      setAppStateValue('voice_access_key_enc', null)
    } else {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('当前系统不支持安全加密存储，无法保存语音 Access Token')
      }
      const encrypted = safeStorage.encryptString(accessKey)
      setAppStateValue('voice_access_key_enc', encrypted.toString('base64'))
    }
  }

  return getAppConfig()
}

function getLlmCredentials() {
  const baseUrl = getAppStateValue('llm_base_url') || DEFAULT_LLM_BASE_URL
  const model = getAppStateValue('llm_model') || DEFAULT_LLM_MODEL
  const temperature = Number.parseFloat(getAppStateValue('llm_temperature') || `${DEFAULT_TEMPERATURE}`)
  const maxContext = Number.parseInt(getAppStateValue('llm_max_context') || `${DEFAULT_MAX_CONTEXT}`, 10)
  const multiAgentEnabled = getBooleanAppStateValue('llm_multi_agent_enabled', DEFAULT_MULTI_AGENT_ENABLED)

  let apiKey = ''
  const encrypted = getAppStateValue('llm_api_key_enc')
  if (encrypted) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统当前不可解密 API Key，请重新配置')
    }
    try {
      apiKey = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      setAppStateValue('llm_api_key_enc', null)
      throw new Error('已保存的 API Key 无法解密，请在设置中重新填写并保存')
    }
  }

  return { baseUrl, model, temperature, maxContext, multiAgentEnabled, apiKey }
}

function getVoiceCredentials() {
  const enabled = getBooleanAppStateValue('voice_enabled', DEFAULT_VOICE_ENABLED)
  const autoPlay = getBooleanAppStateValue('voice_auto_play', DEFAULT_VOICE_AUTO_PLAY)
  const region = getAppStateValue('voice_region') || DEFAULT_VOICE_REGION
  const appId = getAppStateValue('voice_app_id') || ''
  const voiceAsr = getNormalizedVoiceAsrConfig()
  const asrUploadEndpoint = getAppStateValue('voice_asr_upload_endpoint') || DEFAULT_VOICE_ASR_UPLOAD_ENDPOINT
  const ttsResourceId = getAppStateValue('voice_tts_resource_id') || DEFAULT_VOICE_TTS_RESOURCE_ID
  const ttsFormat = (getAppStateValue('voice_tts_format') || DEFAULT_VOICE_TTS_FORMAT).toLowerCase()
  const ttsSampleRate = Number.parseInt(
    getAppStateValue('voice_tts_sample_rate') || `${DEFAULT_VOICE_TTS_SAMPLE_RATE}`,
    10
  )

  let accessKey = ''
  const encrypted = getAppStateValue('voice_access_key_enc')
  if (encrypted) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统当前不可解密语音 Access Token，请重新配置')
    }
    try {
      accessKey = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      setAppStateValue('voice_access_key_enc', null)
      throw new Error('已保存的语音 Access Token 无法解密，请在设置中重新填写并保存')
    }
  }

  return {
    enabled,
    autoPlay,
    region,
    appId,
    accessKey,
    asrMode: voiceAsr.asrMode,
    asrResourceId: voiceAsr.asrResourceId,
    asrStreamUrl: voiceAsr.asrStreamUrl,
    asrUploadEndpoint,
    ttsResourceId,
    ttsFormat,
    ttsSampleRate,
  }
}

function getUserProfile() {
  const db = getDb()
  const profile = { name: '', occupation: '', traits: '', notes: '' }
  const rows = db.prepare('SELECT key, value FROM user_profile').all()

  rows.forEach((row) => {
    profile[row.key] = row.value
  })

  return profile
}

function setUserProfile(payload) {
  const allowed = ['name', 'occupation', 'traits', 'notes']
  const db = getDb()
  const upsert = db.prepare('INSERT OR REPLACE INTO user_profile (key, value, updated_at) VALUES (?, ?, ?)')

  const tx = db.transaction(() => {
    allowed.forEach((key) => {
      if (payload[key] !== undefined) {
        upsert.run(key, String(payload[key] || ''), Date.now())
      }
    })
  })

  tx()
  return getUserProfile()
}

function addChatMessage(role, content, sessionId = 'default') {
  const db = getDb()
  const result = db
    .prepare('INSERT INTO chat_messages (role, content, ts, session_id) VALUES (?, ?, ?, ?)')
    .run(role, content, Date.now(), sessionId)

  return Number(result.lastInsertRowid)
}

function getRecentChatMessages(limit = 20, sessionId = 'default') {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, role, content, ts, session_id as sessionId FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
    .all(sessionId, limit)

  return rows.reverse()
}

function getRecentMemorySummaries(limit = 5, sessionId = 'default') {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, summary, from_msg_id as fromMsgId, to_msg_id as toMsgId, ts, session_id as sessionId FROM memory_summaries WHERE session_id = ? ORDER BY id DESC LIMIT ?')
    .all(sessionId, limit)

  return rows.reverse()
}

function listAllSessionIds() {
  const db = getDb()
  const rows = db.prepare(`
    SELECT DISTINCT session_id AS sessionId FROM chat_messages
    UNION
    SELECT DISTINCT session_id AS sessionId FROM memory_summaries
    ORDER BY sessionId ASC
  `).all()
  return rows.map((row) => String(row.sessionId || '').trim()).filter(Boolean)
}

function normalizeSessionIds(sessionIds) {
  if (!Array.isArray(sessionIds)) return []
  return sessionIds
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function queryBySessionIds(sessionIds, queryTemplate) {
  const db = getDb()
  const ids = normalizeSessionIds(sessionIds)
  if (ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(', ')
  const query = queryTemplate.replace('{placeholders}', placeholders)
  return db.prepare(query).all(...ids)
}

function getChatMessagesBySessionIds(sessionIds = []) {
  return queryBySessionIds(sessionIds, `
    SELECT id, role, content, ts, session_id as sessionId
    FROM chat_messages
    WHERE session_id IN ({placeholders})
    ORDER BY session_id ASC, id ASC
  `)
}

function getMemorySummariesBySessionIds(sessionIds = []) {
  return queryBySessionIds(sessionIds, `
    SELECT id, summary, from_msg_id as fromMsgId, to_msg_id as toMsgId, ts, session_id as sessionId
    FROM memory_summaries
    WHERE session_id IN ({placeholders})
    ORDER BY session_id ASC, id ASC
  `)
}

function getUnsummarizedMessages(sessionId = 'default') {
  const db = getDb()
  const row = db.prepare('SELECT COALESCE(MAX(to_msg_id), 0) as maxToId FROM memory_summaries WHERE session_id = ?').get(sessionId)
  const maxToId = row ? row.maxToId : 0

  return db
    .prepare('SELECT id, role, content, ts, session_id as sessionId FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC')
    .all(sessionId, maxToId)
}

function addMemorySummary(summary, fromMsgId, toMsgId, sessionId = 'default') {
  const db = getDb()
  const result = db
    .prepare('INSERT INTO memory_summaries (summary, from_msg_id, to_msg_id, ts, session_id) VALUES (?, ?, ?, ?, ?)')
    .run(summary, fromMsgId, toMsgId, Date.now(), sessionId)

  return Number(result.lastInsertRowid)
}

module.exports = {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_CONTEXT,
  DEFAULT_MULTI_AGENT_ENABLED,
  DEFAULT_PET_SCALE,
  MIN_PET_SCALE,
  MAX_PET_SCALE,
  DEFAULT_MEMORY_SUMMARY_SYSTEM_PROMPT,
  DEFAULT_CHARACTERS,
  getDb,
  getState,
  saveCount,
  setCurrentChar,
  listCharacters,
  upsertCharacter,
  toggleCharacterActive,
  reorderCharacters,
  getCharacterById,
  setCharacterChatWindowPrefs,
  getChatSystemPrompt,
  getMemorySummarySystemPrompt,
  getAppConfig,
  setAppConfig,
  getPetUiPrefs,
  setPetUiPrefs,
  getChatWindowPrefs,
  setChatWindowPrefs,
  getLlmCredentials,
  getVoiceCredentials,
  getUserProfile,
  setUserProfile,
  addChatMessage,
  getRecentChatMessages,
  listAllSessionIds,
  getChatMessagesBySessionIds,
  getUnsummarizedMessages,
  getRecentMemorySummaries,
  getMemorySummariesBySessionIds,
  addMemorySummary,
}
