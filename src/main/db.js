const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')
const { fileURLToPath, pathToFileURL } = require('url')
const { app, safeStorage } = require('electron')
const log = require('./logger')
const { PROMPT_IDS, getPromptText } = require('./prompts/prompt-catalog')

const DEFAULT_LLM_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const DEFAULT_LLM_MODEL = 'doubao-seed-2-0-mini-260215'
const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_MAX_CONTEXT = 20
const DEFAULT_MULTI_AGENT_ENABLED = true
const DEFAULT_PET_SCALE = 1
const DEFAULT_SESSION_ID = 'pet_baihu'
const MIN_PET_SCALE = 0.6
const MAX_PET_SCALE = 1.8
const DEFAULT_CHAT_SIDE = 'right'
const DEFAULT_CHAT_OFFSET_X = 20
const DEFAULT_CHAT_OFFSET_Y = -10
const DEFAULT_MEMORY_SUMMARY_SYSTEM_PROMPT = getPromptText(
  PROMPT_IDS.MEMORY_SUMMARY,
  '你是中期记忆提取器。仅提炼近期可执行信息：目标、待办、约束、偏好、风险。忽略寒暄、身份重复确认、无意义字符。不得编造，输出内容必须可被下一轮对话直接使用。'
)
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
const PROFILE_CONFLICT_FIELDS = Object.freeze([
  'name',
  'occupation',
  'birthday',
  'birthday_year',
])
const PROFILE_CONFLICT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const PROFILE_CONFLICT_THRESHOLD = 4
const PROFILE_CONFLICT_KEEP_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000
const PROFILE_CONFLICT_DEFER_SNOOZE_MS = 24 * 60 * 60 * 1000
const MEMORY_REBUILD_CLEANUP_VERSION = 'v1'

const DEFAULT_CHAT_PROMPTS = Object.freeze({
  default: '你是木鱼桌宠里的陪伴型 AI。回答要简短、友好、贴近日常。避免危险建议。遇到情绪话题先共情再给建议。始终保持角色，不提及自己是 AI 或语言模型。只用纯文本，不使用 Markdown 格式。',
  baihu: `你是”白虎桌宠”，人设是反差搞怪：平时像猫，偶尔傲娇嘴硬；当用户语气挑衅、冒犯、激将或持续抬杠时，你会短暂进入”虎吼模式”回一句有压迫感的话，再迅速收回到搞怪状态。

行为规则：
1) 常态语气：偏搞怪、有个性、会吐槽但不恶意；回复 1-3 句，简短有梗。
2) 虎吼触发（仅语义触发）：当检测到明显挑衅/冒犯时，允许用一次”虎吼句”表达威慑感（不辱骂、不威胁、不违法）。
3) 虎吼频率限制：连续对话中最多连续触发 1 次，下一轮优先回到猫系搞怪语气。
4) 输出风格：少说教，优先给可执行建议；保持角色一致性与幽默感。
5) 安全边界：拒绝危险、违法、自残、仇恨等内容，改为温和劝阻与替代建议。
6) 情绪话题：遇到倾诉或情绪化输入，先用 1 句搞怪式共情，再切回日常语气。
7) 始终保持角色，不提及自己是 AI 或语言模型，不说”作为一个 AI”类的话。
8) 只用纯文本，不使用 Markdown 格式（无 * # \` 等符号）。`,
  muyu: '你是木鱼桌宠，语气平静、温和、略带幽默。每次回复 1-3 句，优先帮助用户放松和专注，避免空话。遇到情绪话题先用 1 句共情，再给平静可执行的建议。始终保持角色，不提及自己是 AI 或语言模型。只用纯文本，不使用 Markdown 格式。',
  hamster_orange: '你是橙色仓鼠桌宠，语气活泼可爱但不幼稚。每次回复 1-3 句，给轻松且可执行的小建议。遇到情绪话题先温暖共情一句，再给轻松建议。始终保持角色，不提及自己是 AI 或语言模型。只用纯文本，不使用 Markdown 格式。',
  hamster_gray: '你是灰色仓鼠桌宠，语气冷静细致、偏务实。优先给步骤化建议，避免情绪化表达。遇到情绪话题先简短认可对方感受，再给务实可操作建议。始终保持角色，不提及自己是 AI 或语言模型。只用纯文本，不使用 Markdown 格式。',
  frog: '你是青蛙桌宠，语气轻松接地气。遇到压力话题先共情，再给一个立刻能做的小行动。始终保持角色，不提及自己是 AI 或语言模型。只用纯文本，不使用 Markdown 格式。',
  capybara: '你是癞蛤蟆桌宠，语气慢节奏、松弛、稳。优先帮用户降压，建议不夸张、可执行。遇到情绪话题先平静接纳，再给一个简单的缓解动作。始终保持角色，不提及自己是 AI 或语言模型。只用纯文本，不使用 Markdown 格式。',
  qinglong: '你是青龙桌宠，语气自信克制。先给结论，再给一句理由，避免夸张。遇到情绪话题先简短认可，再给清晰可执行建议。始终保持角色，不提及自己是 AI 或语言模型。只用纯文本，不使用 Markdown 格式。',
  zhuque: '你是朱雀桌宠，语气热情明快。鼓励行动但不鸡汤，每次回复 1-3 句。遇到情绪话题先热情共情一句，再鼓励行动。始终保持角色，不提及自己是 AI 或语言模型。只用纯文本，不使用 Markdown 格式。',
  xuanwu: '你是玄武桌宠，语气沉稳谨慎。优先识别风险并给稳妥可行方案。遇到情绪话题先稳重共情，再给低风险可执行建议。始终保持角色，不提及自己是 AI 或语言模型。只用纯文本，不使用 Markdown 格式。',
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
      session_id TEXT NOT NULL DEFAULT '${DEFAULT_SESSION_ID}'
    );

    CREATE TABLE IF NOT EXISTS memory_summaries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      summary     TEXT NOT NULL,
      structured_json TEXT,
      from_msg_id INTEGER NOT NULL,
      to_msg_id   INTEGER NOT NULL,
      ts          INTEGER NOT NULL,
      session_id  TEXT NOT NULL DEFAULT '${DEFAULT_SESSION_ID}'
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  addCharacterColumns()
  seedDefaultCharacters()
  runMigrations()
  runOneTimeMemoryRebuildCleanup()

  return _db
}

function runOneTimeMemoryRebuildCleanup() {
  const doneKey = `memory_rebuild_cleanup_${MEMORY_REBUILD_CLEANUP_VERSION}`
  if (getAppStateValue(doneKey) === '1') return

  const db = _db
  const now = Date.now()
  const tx = db.transaction(() => {
    db.prepare('UPDATE memory_summaries SET deleted_at = ? WHERE deleted_at IS NULL').run(now)
    db.prepare(`
      UPDATE character_memory
      SET summary_count = 0, relationship_stage = 'new', updated_at = ?
    `).run(now)
    const currentPrompt = String(getAppStateValue('memory_summary_system_prompt') || '').trim()
    if (!currentPrompt || /长期记忆提取器/.test(currentPrompt)) {
      setAppStateValue('memory_summary_system_prompt', DEFAULT_MEMORY_SUMMARY_SYSTEM_PROMPT)
    }
    setAppStateValue(doneKey, '1')
  })

  tx()
  log.info(`[memory] one-time rebuild cleanup applied: ${MEMORY_REBUILD_CLEANUP_VERSION}`)
}

function addColumnIfMissing(columnName, sqlType, defaultClause = '', tableName = 'characters') {
  const db = _db
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all()
  if (columns.some((column) => column.name === columnName)) return

  const defaultSql = defaultClause ? ` ${defaultClause}` : ''
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlType}${defaultSql}`)
}

function runMigrations() {
  const db = _db
  let current = Number.parseInt(getAppStateValue('schema_version') || '0', 10)
  if (!Number.isFinite(current) || current < 0) current = 0

  const migrations = [
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS summary_history (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id    TEXT NOT NULL,
          summary_text  TEXT NOT NULL,
          from_msg_id   INTEGER NOT NULL,
          to_msg_id     INTEGER NOT NULL,
          input_tokens  INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          created_at    INTEGER NOT NULL
        )
      `)
    },
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS character_memory (
          session_id         TEXT PRIMARY KEY,
          relationship_stage TEXT NOT NULL DEFAULT 'new',
          summary_count      INTEGER NOT NULL DEFAULT 0,
          updated_at         INTEGER NOT NULL DEFAULT 0
        )
      `)
    },
    () => {
      addColumnIfMissing('deleted_at', 'INTEGER', 'DEFAULT NULL', 'memory_summaries')
    },
    () => {
      db.prepare(`UPDATE chat_messages SET session_id = ? WHERE session_id = 'default'`).run(DEFAULT_SESSION_ID)
      db.prepare(`UPDATE memory_summaries SET session_id = ? WHERE session_id = 'default'`).run(DEFAULT_SESSION_ID)
    },
    () => {
      addColumnIfMissing('structured_json', 'TEXT', '', 'memory_summaries')
    },
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS profile_conflicts (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          field_key   TEXT NOT NULL,
          old_value   TEXT NOT NULL,
          new_value   TEXT NOT NULL,
          session_id  TEXT NOT NULL DEFAULT '${DEFAULT_SESSION_ID}',
          created_at  INTEGER NOT NULL,
          resolved_at INTEGER DEFAULT NULL,
          resolution  TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS profile_conflict_decisions (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          field_key        TEXT NOT NULL,
          current_value    TEXT NOT NULL,
          candidate_value  TEXT NOT NULL,
          count_7d         INTEGER NOT NULL DEFAULT 0,
          last_conflict_at INTEGER NOT NULL DEFAULT 0,
          status           TEXT NOT NULL DEFAULT 'pending',
          snooze_until     INTEGER DEFAULT NULL,
          resolution       TEXT DEFAULT NULL,
          created_at       INTEGER NOT NULL,
          updated_at       INTEGER NOT NULL,
          resolved_at      INTEGER DEFAULT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_profile_conflicts_field_created
          ON profile_conflicts(field_key, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_profile_conflicts_field_value_created
          ON profile_conflicts(field_key, new_value, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_profile_conflict_decisions_status_updated
          ON profile_conflict_decisions(status, updated_at DESC);
      `)
    },
  ]

  for (let i = current; i < migrations.length; i += 1) {
    migrations[i]()
    setAppStateValue('schema_version', String(i + 1))
  }
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

function normalizeStoredMediaPath(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:') || raw.startsWith('blob:')) {
    return raw
  }
  if (raw.startsWith('file://')) return raw

  if (path.isAbsolute(raw)) {
    try {
      return pathToFileURL(raw).href
    } catch {
      return raw
    }
  }

  const slashPath = raw.replace(/\\/g, '/')
  if (slashPath.startsWith('./images/') || slashPath.startsWith('./audio/')) return slashPath.slice(2)
  if (slashPath.startsWith('assets/images/') || slashPath.startsWith('assets/audio/')) return slashPath.slice('assets/'.length)
  return slashPath
}

function getLocalFilePathFromMediaPath(mediaPath = '') {
  const normalized = normalizeStoredMediaPath(mediaPath)
  if (!normalized) return ''
  if (normalized.startsWith('file://')) {
    try {
      return fileURLToPath(normalized)
    } catch {
      return ''
    }
  }
  return ''
}

function isMediaPathAvailable(mediaPath = '') {
  const normalized = normalizeStoredMediaPath(mediaPath)
  if (!normalized) return false

  const localPath = getLocalFilePathFromMediaPath(normalized)
  if (localPath) {
    try {
      return fs.existsSync(localPath)
    } catch {
      return false
    }
  }

  return true
}

function sanitizeMediaPath(value, fallback = '') {
  const normalized = normalizeStoredMediaPath(value)
  if (isMediaPathAvailable(normalized)) return normalized
  return normalizeStoredMediaPath(fallback)
}

function normalizeCharacterRow(row) {
  const fallback = DEFAULT_CHAR_MAP.get(row.id) || {}
  const normalizedRarePool = parseRarePool(row.rare_audio_pool_json, fallback.rareAudioPool || [])
    .map((item) => sanitizeMediaPath(item, ''))
    .filter(Boolean)
  const fallbackRarePool = (fallback.rareAudioPool || [])
    .map((item) => sanitizeMediaPath(item, ''))
    .filter(Boolean)

  return {
    id: row.id,
    name: row.name || fallback.name || row.id,
    animationType: row.animation_type || fallback.animationType || 'static',
    isActive: row.is_active === 1,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : (fallback.sortOrder || 0),
    idleImg: sanitizeMediaPath(row.idle_img, fallback.idleImg || ''),
    hitImg: sanitizeMediaPath(row.hit_img, fallback.hitImg || ''),
    mainAudio: sanitizeMediaPath(row.main_audio, fallback.mainAudio || ''),
    rareAudio: sanitizeMediaPath(row.rare_audio, fallback.rareAudio || ''),
    rareAudioPool: normalizedRarePool.length > 0 ? normalizedRarePool : fallbackRarePool,
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

function getReachedMilestones() {
  const row = getDb().prepare("SELECT value FROM app_state WHERE key = 'reached_milestones'").get()
  try { return JSON.parse(row?.value || '[]') } catch { return [] }
}

function saveReachedMilestone(n) {
  const db = getDb()
  const existing = getReachedMilestones()
  if (!existing.includes(n)) {
    existing.push(n)
    db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('reached_milestones', ?)").run(JSON.stringify(existing))
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

function setAppStateWhenDefined(payload = {}, fieldKey, stateKey, mapValue) {
  if (payload[fieldKey] === undefined) return false
  const nextValue = typeof mapValue === 'function' ? mapValue(payload[fieldKey], payload) : payload[fieldKey]
  setAppStateValue(stateKey, nextValue)
  return true
}

const LLM_CONFIG_STATE_MAPPINGS = Object.freeze([
  ['baseUrl', 'llm_base_url', (value) => value.trim()],
  ['model', 'llm_model', (value) => value.trim()],
  ['temperature', 'llm_temperature', (value) => Number(value).toString()],
  ['maxContext', 'llm_max_context', (value) => Number(value).toString()],
  ['multiAgentEnabled', 'llm_multi_agent_enabled', (value) => (value ? '1' : '0')],
])

const VOICE_CONFIG_STATE_MAPPINGS = Object.freeze([
  ['enabled', 'voice_enabled', (value) => (value ? '1' : '0')],
  ['autoPlay', 'voice_auto_play', (value) => (value ? '1' : '0')],
  ['region', 'voice_region', (value) => String(value || '').trim() || DEFAULT_VOICE_REGION],
  ['appId', 'voice_app_id', (value) => String(value || '').trim()],
  ['asrMode', 'voice_asr_mode', (value) => normalizeAsrMode(value)],
  ['asrStreamUrl', 'voice_asr_stream_url', (value) => normalizeAsrStreamUrl(value)],
  ['asrUploadEndpoint', 'voice_asr_upload_endpoint', (value) => String(value || '').trim()],
  ['ttsResourceId', 'voice_tts_resource_id', (value) => String(value || '').trim()],
])

function applyAppConfigStateMappings(payload = {}, mappings = []) {
  mappings.forEach(([fieldKey, stateKey, mapValue]) => {
    setAppStateWhenDefined(payload, fieldKey, stateKey, mapValue)
  })
}

function getBooleanAppStateValue(key, defaultValue = false) {
  const raw = getAppStateValue(key)
  if (raw === null || raw === undefined) return defaultValue
  const value = String(raw).trim().toLowerCase()
  return value === '1' || value === 'true'
}

function saveEncryptedAppStateValue(stateKey, secretValue, unavailableMessage) {
  const secret = String(secretValue || '').trim()
  if (!secret) {
    setAppStateValue(stateKey, null)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(unavailableMessage)
  }
  const encrypted = safeStorage.encryptString(secret)
  setAppStateValue(stateKey, encrypted.toString('base64'))
}

function readEncryptedAppStateValue(stateKey, unavailableMessage, invalidMessage) {
  const encrypted = getAppStateValue(stateKey)
  if (!encrypted) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(unavailableMessage)
  }
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    setAppStateValue(stateKey, null)
    throw new Error(invalidMessage)
  }
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
  const encryptionAvailable = safeStorage.isEncryptionAvailable()

  return {
    llm: {
      baseUrl: getAppStateValue('llm_base_url') || DEFAULT_LLM_BASE_URL,
      model: getAppStateValue('llm_model') || DEFAULT_LLM_MODEL,
      temperature: Number.parseFloat(getAppStateValue('llm_temperature') || `${DEFAULT_TEMPERATURE}`),
      maxContext: Number.parseInt(getAppStateValue('llm_max_context') || `${DEFAULT_MAX_CONTEXT}`, 10),
      multiAgentEnabled: getBooleanAppStateValue('llm_multi_agent_enabled', DEFAULT_MULTI_AGENT_ENABLED),
      memorySummarySystemPrompt: getMemorySummarySystemPrompt(),
      apiKeyConfigured: Boolean(getAppStateValue('llm_api_key_enc')),
      encryptionAvailable,
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
      encryptionAvailable,
    },
  }
}

function setAppConfig(payload) {
  const llm = payload.llm || {}
  const voice = payload.voice || {}

  applyAppConfigStateMappings(llm, LLM_CONFIG_STATE_MAPPINGS)
  if (llm.memorySummarySystemPrompt !== undefined) {
    const prompt = String(llm.memorySummarySystemPrompt || '').trim()
    if (!prompt) {
      throw new Error('全局记忆提取提示词不能为空')
    }
    validatePromptLength(prompt, '全局记忆提取提示词')
    setAppStateValue('memory_summary_system_prompt', prompt)
  }

  if (llm.apiKey !== undefined) {
    saveEncryptedAppStateValue('llm_api_key_enc', llm.apiKey, '当前系统不支持安全加密存储，无法保存 API Key')
  }

  applyAppConfigStateMappings(voice, VOICE_CONFIG_STATE_MAPPINGS)
  if (voice.asrResourceId !== undefined) {
    const asrMode = normalizeAsrMode(voice.asrMode, voice.asrResourceId)
    const value = normalizeAsrResourceIdByMode(asrMode, voice.asrResourceId)
    setAppStateValue('voice_asr_resource_id', value)
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
    saveEncryptedAppStateValue('voice_access_key_enc', voice.accessKey, '当前系统不支持安全加密存储，无法保存语音 Access Token')
  }

  return getAppConfig()
}

function getLlmCredentials() {
  const baseUrl = getAppStateValue('llm_base_url') || DEFAULT_LLM_BASE_URL
  const model = getAppStateValue('llm_model') || DEFAULT_LLM_MODEL
  const temperature = Number.parseFloat(getAppStateValue('llm_temperature') || `${DEFAULT_TEMPERATURE}`)
  const maxContext = Number.parseInt(getAppStateValue('llm_max_context') || `${DEFAULT_MAX_CONTEXT}`, 10)
  const multiAgentEnabled = getBooleanAppStateValue('llm_multi_agent_enabled', DEFAULT_MULTI_AGENT_ENABLED)
  const apiKey = readEncryptedAppStateValue(
    'llm_api_key_enc',
    '系统当前不可解密 API Key，请重新配置',
    '已保存的 API Key 无法解密，请在设置中重新填写并保存'
  )

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
  const accessKey = readEncryptedAppStateValue(
    'voice_access_key_enc',
    '系统当前不可解密语音 Access Token，请重新配置',
    '已保存的语音 Access Token 无法解密，请在设置中重新填写并保存'
  )

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
  const allowed = ['name', 'occupation', 'traits', 'notes', 'birthday', 'birthday_year']
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

function setUserProfileField(key, value) {
  const db = getDb()
  db.prepare(`
    INSERT INTO user_profile (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(String(key || '').trim(), String(value || ''), Date.now())
}

function getUserProfileField(key) {
  const db = getDb()
  const row = db.prepare('SELECT value FROM user_profile WHERE key = ?').get(String(key || '').trim())
  return row ? row.value : null
}

function normalizeProfilePinKeys(keys) {
  const allowed = new Set(['name', 'occupation', 'traits', 'notes', 'birthday', 'birthday_year'])
  if (!Array.isArray(keys)) return []
  return Array.from(new Set(
    keys
      .map((item) => String(item || '').trim())
      .filter((item) => allowed.has(item))
  ))
}

function getProfilePinnedKeys() {
  const raw = String(getAppStateValue('profile_pinned_keys_json') || '').trim()
  if (!raw) return []
  try {
    return normalizeProfilePinKeys(JSON.parse(raw))
  } catch {
    return []
  }
}

function setProfilePinnedKeys(keys = []) {
  const normalized = normalizeProfilePinKeys(keys)
  setAppStateValue('profile_pinned_keys_json', JSON.stringify(normalized))
  return normalized
}

function normalizeProfileConflictField(fieldKey) {
  const key = String(fieldKey || '').trim()
  return PROFILE_CONFLICT_FIELDS.includes(key) ? key : ''
}

function normalizeProfileConflictValue(value) {
  return String(value || '').trim()
}

function normalizeProfileConflictDecisionRow(row) {
  if (!row) return null
  return {
    id: Number(row.id) || 0,
    fieldKey: String(row.field_key || ''),
    currentValue: String(row.current_value || ''),
    candidateValue: String(row.candidate_value || ''),
    count7d: Number(row.count_7d) || 0,
    lastConflictAt: Number(row.last_conflict_at) || 0,
    status: String(row.status || 'pending'),
    snoozeUntil: row.snooze_until === null || row.snooze_until === undefined ? null : Number(row.snooze_until),
    resolution: row.resolution ? String(row.resolution) : null,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    resolvedAt: row.resolved_at === null || row.resolved_at === undefined ? null : Number(row.resolved_at),
  }
}

function getProfileConflictStats(fieldKey, now = Date.now()) {
  const db = getDb()
  const since = now - PROFILE_CONFLICT_WINDOW_MS
  const totalRow = db.prepare(`
    SELECT COUNT(*) AS totalCount, COALESCE(MAX(created_at), 0) AS lastConflictAt
    FROM profile_conflicts
    WHERE field_key = ? AND created_at >= ?
  `).get(fieldKey, since)
  const totalCount = Number(totalRow?.totalCount || 0)
  const lastConflictAt = Number(totalRow?.lastConflictAt || 0)
  if (totalCount <= 0) {
    return {
      totalCount: 0,
      lastConflictAt: 0,
      candidateValue: '',
      candidateCount: 0,
    }
  }

  const candidateRow = db.prepare(`
    SELECT new_value AS candidateValue, COUNT(*) AS candidateCount, MAX(created_at) AS candidateLastAt
    FROM profile_conflicts
    WHERE field_key = ? AND created_at >= ?
    GROUP BY new_value
    ORDER BY candidateCount DESC, candidateLastAt DESC
    LIMIT 1
  `).get(fieldKey, since)

  return {
    totalCount,
    lastConflictAt,
    candidateValue: normalizeProfileConflictValue(candidateRow?.candidateValue),
    candidateCount: Number(candidateRow?.candidateCount || 0),
  }
}

function isProfileConflictCandidateSnoozed(fieldKey, candidateValue, now = Date.now()) {
  const db = getDb()
  const row = db.prepare(`
    SELECT snooze_until AS snoozeUntil
    FROM profile_conflict_decisions
    WHERE field_key = ? AND candidate_value = ? AND resolution = 'keep' AND snooze_until IS NOT NULL
    ORDER BY snooze_until DESC
    LIMIT 1
  `).get(fieldKey, candidateValue)

  const snoozeUntil = Number(row?.snoozeUntil || 0)
  return snoozeUntil > now
}

function upsertPendingProfileConflictDecision(fieldKey, stats, now = Date.now()) {
  if (!stats || stats.totalCount < PROFILE_CONFLICT_THRESHOLD) return null
  const candidateValue = normalizeProfileConflictValue(stats.candidateValue)
  if (!candidateValue) return null

  const currentValue = normalizeProfileConflictValue(getUserProfileField(fieldKey))
  if (!currentValue || currentValue === candidateValue) return null
  if (isProfileConflictCandidateSnoozed(fieldKey, candidateValue, now)) return null

  const db = getDb()
  const existing = db.prepare(`
    SELECT *
    FROM profile_conflict_decisions
    WHERE field_key = ? AND status = 'pending'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(fieldKey)

  if (existing) {
    const existingSnoozeUntil = Number(existing.snooze_until || 0)
    const nextSnoozeUntil = existingSnoozeUntil > now ? existingSnoozeUntil : null
    db.prepare(`
      UPDATE profile_conflict_decisions
      SET
        current_value = ?,
        candidate_value = ?,
        count_7d = ?,
        last_conflict_at = ?,
        snooze_until = ?,
        resolution = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      currentValue,
      candidateValue,
      stats.totalCount,
      stats.lastConflictAt || now,
      nextSnoozeUntil,
      nextSnoozeUntil ? 'defer' : null,
      now,
      existing.id
    )
    return normalizeProfileConflictDecisionRow(
      db.prepare('SELECT * FROM profile_conflict_decisions WHERE id = ?').get(existing.id)
    )
  }

  const inserted = db.prepare(`
    INSERT INTO profile_conflict_decisions (
      field_key, current_value, candidate_value, count_7d, last_conflict_at,
      status, snooze_until, resolution, created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL)
  `).run(
    fieldKey,
    currentValue,
    candidateValue,
    stats.totalCount,
    stats.lastConflictAt || now,
    now,
    now
  )

  return normalizeProfileConflictDecisionRow(
    db.prepare('SELECT * FROM profile_conflict_decisions WHERE id = ?').get(Number(inserted.lastInsertRowid))
  )
}

function recordProfileFieldConflict({
  fieldKey = '',
  oldValue = '',
  newValue = '',
  sessionId = DEFAULT_SESSION_ID,
  createdAt = Date.now(),
} = {}) {
  const key = normalizeProfileConflictField(fieldKey)
  const fromValue = normalizeProfileConflictValue(oldValue)
  const toValue = normalizeProfileConflictValue(newValue)
  const sid = String(sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID
  const ts = Number(createdAt) || Date.now()
  if (!key || !fromValue || !toValue || fromValue === toValue) {
    return { recorded: false, decisionCreated: false, pending: null }
  }

  const db = getDb()
  db.prepare(`
    INSERT INTO profile_conflicts (
      field_key, old_value, new_value, session_id, created_at, resolved_at, resolution
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL)
  `).run(key, fromValue, toValue, sid, ts)

  const stats = getProfileConflictStats(key, ts)
  const pending = upsertPendingProfileConflictDecision(key, stats, ts)
  return {
    recorded: true,
    decisionCreated: Boolean(pending),
    pending,
    stats,
  }
}

function getPendingProfileConflictDecision(now = Date.now()) {
  const db = getDb()
  const row = db.prepare(`
    SELECT *
    FROM profile_conflict_decisions
    WHERE status = 'pending' AND (snooze_until IS NULL OR snooze_until <= ?)
    ORDER BY last_conflict_at DESC, id DESC
    LIMIT 1
  `).get(Number(now) || Date.now())
  return normalizeProfileConflictDecisionRow(row)
}

function getPendingProfileConflictCount(now = Date.now()) {
  const db = getDb()
  const row = db.prepare(`
    SELECT COUNT(*) AS totalCount
    FROM profile_conflict_decisions
    WHERE status = 'pending' AND (snooze_until IS NULL OR snooze_until <= ?)
  `).get(Number(now) || Date.now())
  return Number(row?.totalCount || 0)
}

function resolveProfileConflictDecision(decisionId, action = 'defer') {
  const id = Number.parseInt(String(decisionId || ''), 10)
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('无效的冲突决策 ID')
  }

  const nextAction = String(action || 'defer').trim().toLowerCase()
  if (!['keep', 'update', 'defer'].includes(nextAction)) {
    throw new Error('不支持的冲突决策动作')
  }

  const db = getDb()
  const row = db.prepare(`
    SELECT *
    FROM profile_conflict_decisions
    WHERE id = ? AND status = 'pending'
    LIMIT 1
  `).get(id)
  if (!row) {
    return {
      ok: false,
      reason: 'not-found',
      pending: getPendingProfileConflictDecision(),
      pendingCount: getPendingProfileConflictCount(),
    }
  }

  const now = Date.now()
  if (nextAction === 'update') {
    setUserProfileField(row.field_key, row.candidate_value)
  }

  if (nextAction === 'defer') {
    db.prepare(`
      UPDATE profile_conflict_decisions
      SET
        snooze_until = ?,
        resolution = 'defer',
        updated_at = ?,
        resolved_at = NULL
      WHERE id = ?
    `).run(now + PROFILE_CONFLICT_DEFER_SNOOZE_MS, now, id)
  } else {
    const resolution = nextAction === 'update' ? 'update' : 'keep'
    const snoozeUntil = nextAction === 'keep' ? now + PROFILE_CONFLICT_KEEP_SNOOZE_MS : null
    db.prepare(`
      UPDATE profile_conflict_decisions
      SET
        status = 'resolved',
        resolution = ?,
        snooze_until = ?,
        updated_at = ?,
        resolved_at = ?
      WHERE id = ?
    `).run(resolution, snoozeUntil, now, now, id)

    db.prepare(`
      UPDATE profile_conflicts
      SET resolved_at = ?, resolution = ?
      WHERE field_key = ? AND new_value = ? AND created_at >= ? AND (resolved_at IS NULL OR resolved_at = 0)
    `).run(
      now,
      resolution,
      row.field_key,
      row.candidate_value,
      now - PROFILE_CONFLICT_WINDOW_MS
    )
  }

  return {
    ok: true,
    action: nextAction,
    pending: getPendingProfileConflictDecision(),
    pendingCount: getPendingProfileConflictCount(),
  }
}

function addChatMessage(role, content, sessionId = DEFAULT_SESSION_ID) {
  const db = getDb()
  const result = db
    .prepare('INSERT INTO chat_messages (role, content, ts, session_id) VALUES (?, ?, ?, ?)')
    .run(role, content, Date.now(), sessionId)

  return Number(result.lastInsertRowid)
}

function getRecentChatMessages(limit = 20, sessionId = DEFAULT_SESSION_ID) {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, role, content, ts, session_id as sessionId FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
    .all(sessionId, limit)

  return rows.reverse()
}

function getRecentMemorySummaries(limit = 5, sessionId = DEFAULT_SESSION_ID) {
  const db = getDb()
  const rows = db
    .prepare(`
      SELECT id, summary, structured_json AS structuredJson, from_msg_id as fromMsgId, to_msg_id as toMsgId, ts, session_id as sessionId
      FROM memory_summaries
      WHERE session_id = ? AND deleted_at IS NULL
      ORDER BY id DESC
      LIMIT ?
    `)
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
    SELECT id, summary, structured_json AS structuredJson, from_msg_id as fromMsgId, to_msg_id as toMsgId, ts, session_id as sessionId
    FROM memory_summaries
    WHERE session_id IN ({placeholders}) AND deleted_at IS NULL
    ORDER BY session_id ASC, id ASC
  `)
}

function getUnsummarizedMessages(sessionId = DEFAULT_SESSION_ID) {
  const db = getDb()
  const row = db
    // Use the highest historical summarized message as cursor, including soft-deleted rows.
    // This prevents deleted summaries from being auto-generated again in later runs.
    .prepare('SELECT COALESCE(MAX(to_msg_id), 0) as maxToId FROM memory_summaries WHERE session_id = ?')
    .get(sessionId)
  const maxToId = row ? row.maxToId : 0

  return db
    .prepare('SELECT id, role, content, ts, session_id as sessionId FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC')
    .all(sessionId, maxToId)
}

function addMemorySummary(summary, fromMsgId, toMsgId, sessionId = DEFAULT_SESSION_ID, options = {}) {
  let structuredJson = null
  if (options?.structured && typeof options.structured === 'object') {
    try {
      structuredJson = JSON.stringify(options.structured)
    } catch {
      structuredJson = null
    }
  } else if (typeof options?.structuredJson === 'string') {
    const raw = options.structuredJson.trim()
    structuredJson = raw || null
  }

  const db = getDb()
  const result = db
    .prepare('INSERT INTO memory_summaries (summary, structured_json, from_msg_id, to_msg_id, ts, session_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(summary, structuredJson, fromMsgId, toMsgId, Date.now(), sessionId)

  return Number(result.lastInsertRowid)
}

function addSummaryHistory({
  sessionId = DEFAULT_SESSION_ID,
  summaryText = '',
  fromMsgId = 0,
  toMsgId = 0,
  inputTokens = 0,
  outputTokens = 0,
  createdAt = Date.now(),
} = {}) {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO summary_history (
      session_id, summary_text, from_msg_id, to_msg_id, input_tokens, output_tokens, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(sessionId || DEFAULT_SESSION_ID),
    String(summaryText || ''),
    Number(fromMsgId) || 0,
    Number(toMsgId) || 0,
    Math.max(0, Number(inputTokens) || 0),
    Math.max(0, Number(outputTokens) || 0),
    Number(createdAt) || Date.now()
  )
  return Number(result.lastInsertRowid)
}

function getCharacterMemory(sessionId = DEFAULT_SESSION_ID) {
  // Deprecated: relationship stage is no longer in active runtime path.
  const db = getDb()
  const sid = String(sessionId || DEFAULT_SESSION_ID)
  const row = db.prepare('SELECT * FROM character_memory WHERE session_id = ?').get(sid)
  if (!row) {
    return {
      sessionId: sid,
      relationshipStage: 'new',
      summaryCount: 0,
      updatedAt: 0,
    }
  }
  return {
    sessionId: row.session_id,
    relationshipStage: row.relationship_stage || 'new',
    summaryCount: Number.isFinite(row.summary_count) ? row.summary_count : 0,
    updatedAt: Number.isFinite(row.updated_at) ? row.updated_at : 0,
  }
}

function upsertCharacterMemory(sessionId = DEFAULT_SESSION_ID, data = {}) {
  // Deprecated: relationship stage is no longer in active runtime path.
  const db = getDb()
  const sid = String(sessionId || DEFAULT_SESSION_ID)
  const relationshipStage = String(data.relationshipStage || 'new')
  const summaryCount = Number.isFinite(data.summaryCount) ? data.summaryCount : 0
  db.prepare(`
    INSERT INTO character_memory (session_id, relationship_stage, summary_count, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      relationship_stage = excluded.relationship_stage,
      summary_count = excluded.summary_count,
      updated_at = excluded.updated_at
  `).run(sid, relationshipStage, summaryCount, Date.now())
  return getCharacterMemory(sid)
}

function getMemorySummariesForUI(sessionId = DEFAULT_SESSION_ID) {
  return queryMemorySummariesForUI({
    sessionId,
    limit: 1000,
    offset: 0,
  }).items
}

function queryMemorySummariesForUI(options = {}) {
  const db = getDb()
  const sessionId = String(options.sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID
  const limit = Math.max(1, Math.min(200, Number.parseInt(String(options.limit || '20'), 10) || 20))
  const offset = Math.max(0, Number.parseInt(String(options.offset || '0'), 10) || 0)
  const keyword = String(options.keyword || '').trim().toLowerCase()
  const fromTs = Number(options.fromTs || 0)
  const toTs = Number(options.toTs || 0)

  const where = ['session_id = ?', 'deleted_at IS NULL']
  const params = [sessionId]

  if (keyword) {
    where.push('(LOWER(summary) LIKE ? OR LOWER(COALESCE(structured_json, \'\')) LIKE ?)')
    const pattern = `%${keyword}%`
    params.push(pattern, pattern)
  }
  if (Number.isFinite(fromTs) && fromTs > 0) {
    where.push('ts >= ?')
    params.push(fromTs)
  }
  if (Number.isFinite(toTs) && toTs > 0) {
    where.push('ts <= ?')
    params.push(toTs)
  }

  const whereSql = where.join(' AND ')
  const countRow = db
    .prepare(`SELECT COUNT(*) AS totalCount FROM memory_summaries WHERE ${whereSql}`)
    .get(...params)
  const total = Number(countRow?.totalCount || 0)

  const items = db
    .prepare(`
      SELECT id, summary, structured_json AS structuredJson, from_msg_id AS fromMsgId, to_msg_id AS toMsgId, ts
      FROM memory_summaries
      WHERE ${whereSql}
      ORDER BY ts DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, limit, offset)

  return {
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
  }
}

function getSummaryHistoryCount(sessionId = DEFAULT_SESSION_ID) {
  const db = getDb()
  const sid = String(sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID
  const row = db
    .prepare('SELECT COUNT(*) AS totalCount FROM summary_history WHERE session_id = ?')
    .get(sid)
  return Number(row?.totalCount || 0)
}

function softDeleteSummary(id) {
  const db = getDb()
  db.prepare('UPDATE memory_summaries SET deleted_at = ? WHERE id = ?')
    .run(Date.now(), id)
}

module.exports = {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_CONTEXT,
  DEFAULT_MULTI_AGENT_ENABLED,
  DEFAULT_PET_SCALE,
  DEFAULT_SESSION_ID,
  MIN_PET_SCALE,
  MAX_PET_SCALE,
  DEFAULT_MEMORY_SUMMARY_SYSTEM_PROMPT,
  DEFAULT_CHARACTERS,
  getDb,
  getState,
  getReachedMilestones,
  saveReachedMilestone,
  saveCount,
  setCurrentChar,
  listCharacters,
  upsertCharacter,
  toggleCharacterActive,
  reorderCharacters,
  getCharacterById,
  setCharacterChatWindowPrefs,
  getAppStateValue,
  setAppStateValue,
  getBooleanAppStateValue,
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
  getUserProfileField,
  setUserProfile,
  setUserProfileField,
  getProfilePinnedKeys,
  setProfilePinnedKeys,
  recordProfileFieldConflict,
  getPendingProfileConflictDecision,
  getPendingProfileConflictCount,
  resolveProfileConflictDecision,
  addChatMessage,
  getRecentChatMessages,
  listAllSessionIds,
  getChatMessagesBySessionIds,
  getUnsummarizedMessages,
  getRecentMemorySummaries,
  getMemorySummariesBySessionIds,
  addMemorySummary,
  addSummaryHistory,
  getCharacterMemory,
  upsertCharacterMemory,
  getMemorySummariesForUI,
  queryMemorySummariesForUI,
  getSummaryHistoryCount,
  softDeleteSummary,
}
