const crypto = require('crypto')
const zlib = require('zlib')
const WebSocket = require('ws')
const log = require('../logger')
const { classifyVoiceError, buildErrorPayload } = require('./error-classifier')

const ASR_SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit'
const ASR_QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query'
const ASR_STREAM_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
const TTS_V3_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
const ASR_MODE_STREAM = 'stream'
const ASR_MODE_FILE = 'file'
const ASR_BASE_REQUEST = Object.freeze({
  model_name: 'bigmodel',
  enable_itn: true,
  enable_punc: true,
})
const ASR_STREAM_REQUEST = Object.freeze({
  result_type: 'full',
  show_utterances: true,
  enable_accelerate_text: false,
  accelerate_score: 0,
  end_window_size: 350,
})

const DEFAULT_CHAR_VOICE = 'zh_female_vv_uranus_bigtts'
const CHAR_VOICE_MAP = Object.freeze({
  baihu: 'zh_male_taocheng_uranus_bigtts',
  hamster_orange: 'zh_female_xiaohe_uranus_bigtts',
  muyu: 'zh_male_m191_uranus_bigtts',
})
const CHAR_DEFAULT_EMOTION_MAP = Object.freeze({
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
const SUPPORTED_EMOTIONS = new Set([
  'auto',
  'neutral',
  'happy',
  'comfort',
  'angry',
  'tension',
  'storytelling',
  'tender',
])

const EMOTION_KEYWORDS = Object.freeze({
  angry: ['气死', '可恶', '生气', '烦死', '滚', '吼', '打死你', '惹毛', '炸了'],
  comfort: ['安慰', '别怕', '抱抱', '没事', '缓一缓', '放松', '稳住', '别紧张'],
  storytelling: ['讲故事', '故事', '从前', '后来', '有一天', '然后呢'],
  tension: ['紧急', '救命', '糟了', '快点', '来不及', '危险', '崩溃'],
  happy: ['哈哈', '开心', '高兴', '太棒', '舒服', '可爱', '好耶'],
})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`
}

function toStatusCode(value) {
  const n = Number(value)
  return Number.isInteger(n) ? n : 0
}

function toBool(value, fallback = false) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (text === '1' || text === 'true') return true
  if (text === '0' || text === 'false') return false
  return fallback
}

function normalizeEmotionValue(value, fallback = '') {
  const raw = String(value || '').trim().toLowerCase()
  if (SUPPORTED_EMOTIONS.has(raw)) return raw

  const nextFallback = String(fallback || '').trim().toLowerCase()
  if (SUPPORTED_EMOTIONS.has(nextFallback)) return nextFallback
  return ''
}

function normalizeAsrMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  return mode === ASR_MODE_FILE ? ASR_MODE_FILE : ASR_MODE_STREAM
}

function hasHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim())
}

function stripDataUrlPrefix(input) {
  const text = String(input || '')
  if (!text.startsWith('data:')) {
    return { mimeType: '', base64: '' }
  }
  const commaIndex = text.indexOf(',')
  if (commaIndex < 0) {
    return { mimeType: '', base64: '' }
  }
  const meta = text.slice(5, commaIndex) // remove "data:"
  const metaParts = meta.split(';').map((item) => item.trim()).filter(Boolean)
  const firstPart = metaParts[0] || ''
  const mimeType = firstPart && !firstPart.includes('=') ? firstPart.toLowerCase() : ''
  const hasBase64Flag = metaParts.some((item) => item.toLowerCase() === 'base64')
  if (!hasBase64Flag) {
    return { mimeType, base64: '' }
  }
  return {
    mimeType,
    base64: text.slice(commaIndex + 1),
  }
}

function inferAudioFormat(mimeType) {
  const mime = String(mimeType || '').toLowerCase()
  if (mime.includes('mp3') || mime.includes('mpeg')) return { format: 'mp3', codec: 'raw' }
  if (mime.includes('wav')) return { format: 'wav', codec: 'raw' }
  if (mime.includes('ogg')) return { format: 'ogg', codec: 'opus' }
  if (mime.includes('pcm') || mime.includes('x-pcm') || mime.includes('l16') || mime.includes('s16le')) {
    return { format: 'pcm', codec: 'raw' }
  }
  if (mime.includes('webm')) return { format: 'ogg', codec: 'opus' }
  return { format: 'ogg', codec: 'opus' }
}

function extensionByMimeType(mimeType) {
  const mime = String(mimeType || '').toLowerCase()
  if (mime.includes('mp3') || mime.includes('mpeg')) return 'mp3'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('pcm')) return 'pcm'
  return 'bin'
}

function looksLikeAsrUrlFormatError(text) {
  const source = String(text || '').toLowerCase()
  return /audio\.url|url|http|https|invalid|illegal|unsupported|data:|协议|链接|地址/.test(source)
}

function isAsrInvalidAudioUri(code, messageText) {
  const msg = String(messageText || '').toLowerCase()
  return Number(code) === 45000006 && /invalid audio uri|audio download failed|音频.*下载|无效.*uri/.test(msg)
}

function isAsrUnsupportedAudioFormat(code, messageText) {
  const msg = String(messageText || '').toLowerCase()
  return Number(code) === 45000151 && /unsupported format|invalid audio format|format raw|raw/.test(msg)
}

function extractUploadedUrl(responseBodyText) {
  const raw = String(responseBodyText || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw

  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  if (!parsed || typeof parsed !== 'object') return ''

  const candidates = [
    parsed.url,
    parsed.fileUrl,
    parsed.location,
    parsed.data?.url,
    parsed.data?.fileUrl,
    parsed.data?.location,
    parsed.result?.url,
    parsed.result?.fileUrl,
  ]
  for (const item of candidates) {
    const value = String(item || '').trim()
    if (/^https?:\/\//i.test(value)) return value
  }
  return ''
}

function ttsFormatToMime(format) {
  const value = String(format || '').toLowerCase()
  if (value === 'pcm') return 'audio/pcm'
  if (value === 'ogg' || value === 'ogg_opus') return 'audio/ogg'
  if (value === 'wav') return 'audio/wav'
  return 'audio/mpeg'
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(String(text || ''))
  } catch {
    return null
  }
}

function toBase64FromArrayBuffer(buffer) {
  return Buffer.from(buffer).toString('base64')
}

function extractTtsCode(packet) {
  if (!packet || typeof packet !== 'object') return 0
  return toStatusCode(packet.code ?? packet?.header?.code ?? packet?.status_code)
}

function extractTtsMessage(packet) {
  if (!packet || typeof packet !== 'object') return ''
  return String(packet.message || packet?.header?.message || packet?.msg || '').trim()
}

function extractTtsAudioChunk(packet) {
  if (!packet || typeof packet !== 'object') return ''
  const candidates = [
    packet.data,
    packet.audio,
    packet.audio_data,
    packet?.data?.audio,
    packet?.data?.audio_data,
    packet?.data?.payload,
    packet?.result?.audio,
    packet?.result?.audio_data,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return ''
}

function collectSseJsonPackets(streamText) {
  const packets = []
  const lines = String(streamText || '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line.startsWith('data:')) continue
    const jsonText = line.slice(5).trim()
    if (!jsonText || jsonText === '[DONE]') continue
    const parsed = parseJsonSafe(jsonText)
    if (parsed && typeof parsed === 'object') {
      packets.push(parsed)
    }
  }
  return packets
}

function extractJsonObjectsFromText(rawText) {
  const text = String(rawText || '')
  const out = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
      continue
    }

    if (ch === '}') {
      if (depth > 0) depth -= 1
      if (depth === 0 && start >= 0) {
        const chunk = text.slice(start, i + 1)
        const parsed = parseJsonSafe(chunk)
        if (parsed && typeof parsed === 'object') out.push(parsed)
        start = -1
      }
    }
  }

  return out
}

function cleanObject(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cleanObject)
  const next = {}
  Object.entries(value).forEach(([key, val]) => {
    if (val === undefined || val === null || val === '') return
    next[key] = typeof val === 'object' ? cleanObject(val) : val
  })
  return next
}

const WS_PROTOCOL_VERSION = 1
const WS_HEADER_SIZE = 1
const WS_MESSAGE_FULL_CLIENT_REQUEST = 0x1
const WS_MESSAGE_AUDIO_ONLY_REQUEST = 0x2
const WS_MESSAGE_FULL_SERVER_RESPONSE = 0x9
const WS_MESSAGE_SERVER_ERROR = 0xf
const WS_FLAG_NO_SEQUENCE = 0x0
const WS_FLAG_HAS_SEQUENCE = 0x1
const WS_FLAG_LAST_NO_SEQUENCE = 0x2
const WS_FLAG_LAST_NEGATIVE_SEQUENCE = 0x3
const WS_SERIALIZATION_NONE = 0x0
const WS_SERIALIZATION_JSON = 0x1
const WS_COMPRESSION_NONE = 0x0
const WS_COMPRESSION_GZIP = 0x1

function gzipBuffer(buffer) {
  return zlib.gzipSync(Buffer.from(buffer))
}

function maybeGunzipBuffer(buffer, compression) {
  if (compression !== WS_COMPRESSION_GZIP) return Buffer.from(buffer)
  return zlib.gunzipSync(Buffer.from(buffer))
}

function buildWsHeader(messageType, flag, serialization, compression) {
  const header = Buffer.alloc(4)
  header[0] = ((WS_PROTOCOL_VERSION & 0x0f) << 4) | (WS_HEADER_SIZE & 0x0f)
  header[1] = ((messageType & 0x0f) << 4) | (flag & 0x0f)
  header[2] = ((serialization & 0x0f) << 4) | (compression & 0x0f)
  header[3] = 0x00
  return header
}

function buildWsPacket({ messageType, flag, serialization, compression, payload, sequence = null }) {
  const body = Buffer.from(payload || [])
  const header = buildWsHeader(messageType, flag, serialization, compression)
  const parts = [header]

  if (typeof sequence === 'number') {
    const seq = Buffer.alloc(4)
    seq.writeInt32BE(sequence, 0)
    parts.push(seq)
  }

  const size = Buffer.alloc(4)
  size.writeUInt32BE(body.length, 0)
  parts.push(size, body)
  return Buffer.concat(parts)
}

function buildAsrRequestPayload({ audioInfo, stream = false, audioOverrides = {} } = {}) {
  const request = stream
    ? { ...ASR_BASE_REQUEST, ...ASR_STREAM_REQUEST }
    : { ...ASR_BASE_REQUEST }
  return cleanObject({
    user: {
      uid: `muyu-desktop-${Date.now()}`,
    },
    audio: {
      format: audioInfo.format,
      codec: audioInfo.codec,
      rate: 16000,
      bits: 16,
      channel: 1,
      ...audioOverrides,
    },
    request,
  })
}

function buildAsrFullRequestPacket(audioInfo, { stream = false } = {}) {
  const requestPayload = buildAsrRequestPayload({ audioInfo, stream })
  return buildWsPacket({
    messageType: WS_MESSAGE_FULL_CLIENT_REQUEST,
    flag: WS_FLAG_NO_SEQUENCE,
    serialization: WS_SERIALIZATION_JSON,
    compression: WS_COMPRESSION_GZIP,
    payload: gzipBuffer(Buffer.from(JSON.stringify(requestPayload), 'utf8')),
    sequence: null,
  })
}

function buildAsrWsHeaders(credentials, connectId) {
  return {
    'X-Api-App-Key': credentials.appId,
    'X-Api-Access-Key': credentials.accessKey,
    'X-Api-Resource-Id': credentials.asrResourceId,
    'X-Api-Connect-Id': connectId,
  }
}

function parseWsPacket(rawData) {
  const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData || [])
  if (data.length < 8) {
    return { type: -1, flag: 0, serialization: 0, compression: 0, payload: Buffer.alloc(0) }
  }

  const headerSize = (data[0] & 0x0f) * 4
  const type = (data[1] >> 4) & 0x0f
  const flag = data[1] & 0x0f
  const serialization = (data[2] >> 4) & 0x0f
  const compression = data[2] & 0x0f
  let offset = Math.max(4, headerSize)
  let sequence = null

  if (type === WS_MESSAGE_FULL_SERVER_RESPONSE && (flag === WS_FLAG_HAS_SEQUENCE || flag === WS_FLAG_LAST_NEGATIVE_SEQUENCE)) {
    if (data.length < offset + 4) {
      throw new Error('ASR 流式响应序列号缺失')
    }
    sequence = data.readInt32BE(offset)
    offset += 4
  }

  if (type === WS_MESSAGE_SERVER_ERROR) {
    if (data.length < offset + 8) {
      throw new Error('ASR 流式错误响应格式异常')
    }
    const errorCode = data.readUInt32BE(offset)
    const errorSize = data.readUInt32BE(offset + 4)
    const messageStart = offset + 8
    const messageEnd = Math.min(messageStart + errorSize, data.length)
    const message = data.slice(messageStart, messageEnd).toString('utf8')
    return {
      type,
      flag,
      serialization,
      compression,
      sequence,
      errorCode,
      errorMessage: message,
      payload: Buffer.alloc(0),
      isLast: true,
    }
  }

  if (data.length < offset + 4) {
    throw new Error('ASR 流式响应 payload 长度缺失')
  }
  const payloadSize = data.readUInt32BE(offset)
  offset += 4
  const end = Math.min(offset + payloadSize, data.length)
  const payload = data.slice(offset, end)
  const isLast = flag === WS_FLAG_LAST_NO_SEQUENCE || flag === WS_FLAG_LAST_NEGATIVE_SEQUENCE

  return {
    type,
    flag,
    serialization,
    compression,
    sequence,
    payload,
    isLast,
  }
}

function extractAsrTextFromPacket(packet) {
  if (!packet || typeof packet !== 'object') {
    return { text: '', code: 0, message: '', utterances: [] }
  }
  const payload = packet.result || packet
  const rawUtterances = Array.isArray(payload?.utterances) ? payload.utterances : []
  const utterances = normalizeAsrUtterances(rawUtterances)
  const text = resolveAsrPacketText(payload, utterances)

  const code = toStatusCode(packet.code ?? packet?.header?.code ?? packet?.status_code)
  const message = String(packet.message || packet?.header?.message || packet?.msg || '').trim()
  return {
    text: String(text || '').trim(),
    code,
    message,
    utterances,
  }
}

function normalizeAsrUtterances(rawUtterances = []) {
  if (!Array.isArray(rawUtterances) || rawUtterances.length === 0) return []
  return rawUtterances
    .map((item) => {
      const text = typeof item?.text === 'string' ? item.text.trim() : ''
      if (!text) return null
      return {
        text,
        startTime: Number.isFinite(Number(item?.start_time)) ? Number(item.start_time) : null,
        endTime: Number.isFinite(Number(item?.end_time)) ? Number(item.end_time) : null,
        definite: Boolean(item?.definite),
        additions: item?.additions && typeof item.additions === 'object' ? item.additions : null,
      }
    })
    .filter(Boolean)
}

function resolveAsrPacketText(payload, utterances = []) {
  if (typeof payload?.text === 'string' && payload.text.trim()) {
    return payload.text.trim()
  }

  if (Array.isArray(payload)) {
    return payload
      .map((item) => (typeof item?.text === 'string' ? item.text.trim() : ''))
      .filter(Boolean)
      .join('')
  }

  if (Array.isArray(utterances) && utterances.length > 0) {
    return utterances
      .map((item) => item.text)
      .filter(Boolean)
      .join('')
  }

  return ''
}

function getUtterancesVersion(utterances = []) {
  if (!Array.isArray(utterances) || utterances.length === 0) return ''
  return utterances
    .map((item) => `${item?.startTime ?? ''}-${item?.endTime ?? ''}-${item?.definite ? 1 : 0}-${item?.text || ''}`)
    .join('|')
}

function isAsrSuccessCode(code) {
  return !code || code === 20000000
}

function splitBufferBySize(buffer, chunkSize = 6400) {
  const bytes = Buffer.from(buffer || [])
  if (!bytes.length) return []
  const size = Math.max(512, Number(chunkSize) || 6400)
  const chunks = []
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(bytes.slice(i, Math.min(i + size, bytes.length)))
  }
  return chunks
}

function parseAudioChunkPayload(payload = {}) {
  const directBase64 = String(payload.audioBase64 || '').trim()
  if (directBase64) {
    return {
      mimeType: String(payload.mimeType || '').trim().toLowerCase(),
      audioBuffer: Buffer.from(directBase64, 'base64'),
    }
  }

  const source = String(payload.audioDataUrl || '').trim()
  if (!source.startsWith('data:')) {
    throw new Error('流式 ASR 需要 data:audio/* 录音数据')
  }
  const parsed = stripDataUrlPrefix(source)
  if (!parsed.base64) {
    throw new Error('录音数据解析失败')
  }
  return {
    mimeType: String(payload.mimeType || parsed.mimeType || '').trim().toLowerCase(),
    audioBuffer: Buffer.from(parsed.base64, 'base64'),
  }
}

class VoiceService {
  constructor(db) {
    this.db = db
    this.streamSessions = new Map()
  }

  mergeCredentials(overrides = {}) {
    const stored = this.db.getVoiceCredentials()
    const credentials = { ...stored }

    if (overrides.region !== undefined) credentials.region = String(overrides.region || '').trim()
    if (overrides.appId !== undefined) credentials.appId = String(overrides.appId || '').trim()
    if (overrides.accessKey !== undefined) credentials.accessKey = String(overrides.accessKey || '').trim()
    if (overrides.asrMode !== undefined) credentials.asrMode = normalizeAsrMode(overrides.asrMode)
    if (overrides.asrResourceId !== undefined) credentials.asrResourceId = String(overrides.asrResourceId || '').trim()
    if (overrides.asrStreamUrl !== undefined) credentials.asrStreamUrl = String(overrides.asrStreamUrl || '').trim()
    if (overrides.asrUploadEndpoint !== undefined) {
      credentials.asrUploadEndpoint = String(overrides.asrUploadEndpoint || '').trim()
    }
    if (overrides.ttsResourceId !== undefined) credentials.ttsResourceId = String(overrides.ttsResourceId || '').trim()
    if (overrides.ttsFormat !== undefined) credentials.ttsFormat = String(overrides.ttsFormat || '').trim().toLowerCase()
    if (overrides.ttsSampleRate !== undefined) {
      const n = Number.parseInt(overrides.ttsSampleRate, 10)
      if (Number.isFinite(n) && n > 0) credentials.ttsSampleRate = n
    }
    if (overrides.enabled !== undefined) credentials.enabled = toBool(overrides.enabled, credentials.enabled)
    if (overrides.autoPlay !== undefined) credentials.autoPlay = toBool(overrides.autoPlay, credentials.autoPlay)
    credentials.asrMode = normalizeAsrMode(credentials.asrMode)
    credentials.asrStreamUrl = String(credentials.asrStreamUrl || ASR_STREAM_URL).trim() || ASR_STREAM_URL

    return credentials
  }

  assertCommonCredentials(credentials) {
    if (!credentials.appId) throw new Error('缺少语音 AppID')
    if (!credentials.accessKey) throw new Error('缺少语音 AccessToken')
  }

  getCharacterVoicePrefs(charId) {
    const id = String(charId || '').trim().toLowerCase()
    if (!id || typeof this.db?.getCharacterById !== 'function') {
      return { voiceType: '', voiceEmotion: '' }
    }
    const row = this.db.getCharacterById(id)
    return {
      voiceType: String(row?.voiceType || '').trim(),
      voiceEmotion: normalizeEmotionValue(row?.voiceEmotion, ''),
    }
  }

  resolveVoiceType(charId, explicitVoiceType = '') {
    const direct = String(explicitVoiceType || '').trim()
    if (direct) return direct

    const prefs = this.getCharacterVoicePrefs(charId)
    if (prefs.voiceType) return prefs.voiceType

    const id = String(charId || '').trim().toLowerCase()
    return CHAR_VOICE_MAP[id] || DEFAULT_CHAR_VOICE
  }

  detectEmotion(text, charId, explicitEmotion) {
    const direct = normalizeEmotionValue(explicitEmotion, '')
    if (direct && direct !== 'auto') return direct

    const prefs = this.getCharacterVoicePrefs(charId)
    const defaultEmotion = normalizeEmotionValue(
      prefs.voiceEmotion,
      normalizeEmotionValue(CHAR_DEFAULT_EMOTION_MAP[String(charId || '').trim().toLowerCase()], 'happy')
    )

    const source = String(text || '').toLowerCase()
    if (!source) {
      return defaultEmotion && defaultEmotion !== 'auto' ? defaultEmotion : 'happy'
    }

    if (EMOTION_KEYWORDS.angry.some((item) => source.includes(item))) return 'angry'
    if (EMOTION_KEYWORDS.tension.some((item) => source.includes(item))) return 'tension'
    if (EMOTION_KEYWORDS.comfort.some((item) => source.includes(item))) return 'comfort'
    if (EMOTION_KEYWORDS.storytelling.some((item) => source.includes(item))) return 'storytelling'
    if (EMOTION_KEYWORDS.happy.some((item) => source.includes(item))) return 'happy'

    return defaultEmotion && defaultEmotion !== 'auto' ? defaultEmotion : 'happy'
  }

  async uploadAudioDataUrl(audioDataUrl, mimeType, uploadEndpoint) {
    const endpoint = String(uploadEndpoint || '').trim()
    if (!/^https?:\/\//i.test(endpoint)) {
      throw new Error('ASR 上传接口地址无效，需为 http(s) URL')
    }

    const parsed = stripDataUrlPrefix(audioDataUrl)
    if (!parsed.base64) {
      throw new Error('录音数据解析失败，无法上传 ASR 音频')
    }
    const audioMime = String(mimeType || parsed.mimeType || 'audio/webm').toLowerCase()
    const fileExt = extensionByMimeType(audioMime)
    const fileName = `muyu_voice_${Date.now()}.${fileExt}`
    const bytes = Buffer.from(parsed.base64, 'base64')

    const form = new FormData()
    form.append('file', new Blob([bytes], { type: audioMime }), fileName)

    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
    })
    const responseText = await response.text()
    if (!response.ok) {
      throw new Error(`ASR 上传失败(${response.status}): ${responseText.slice(0, 180)}`)
    }

    const uploadedUrl = extractUploadedUrl(responseText)
    if (!uploadedUrl) {
      throw new Error('ASR 上传接口未返回有效 URL（需返回 http(s) 链接）')
    }
    return uploadedUrl
  }

  async transcribeAudio(payload = {}) {
    const credentials = this.mergeCredentials(payload.config || {})
    this.assertCommonCredentials(credentials)

    if (!credentials.asrResourceId) {
      throw new Error('缺少 ASR 资源 ID')
    }

    const mode = normalizeAsrMode(payload.asrMode || credentials.asrMode)
    if (mode === ASR_MODE_FILE) {
      return this.transcribeAudioByFile(payload, credentials)
    }

    const source = String(payload.audioDataUrl || payload.audioUrl || '').trim()
    if (source && hasHttpUrl(source)) {
      // 流式模式无法直接消费 URL，这里自动回落到文件识别。
      return this.transcribeAudioByFile(payload, credentials)
    }

    try {
      return await this.transcribeAudioByStream(payload, credentials)
    } catch (error) {
      const message = String(error?.message || error || '')
      const canFallbackToFile = Boolean(String(credentials.asrUploadEndpoint || '').trim())
      const shouldFallback = canFallbackToFile && /websocket|stream|unsupported|format|协议|45000151/i.test(message)
      if (!shouldFallback) throw error
      log.warn(`[voice-asr] stream fallback to file mode: ${message}`)
      return this.transcribeAudioByFile(payload, credentials)
    }
  }

  buildStreamRequestPacket(audioInfo) {
    return buildAsrFullRequestPacket(audioInfo, { stream: true })
  }

  emitStreamError(session, error) {
    if (!session || session.closed) return
    const message = String(error?.message || error || 'ASR 流式异常')
    const classification = classifyVoiceError(error, {
      source: 'voice_asr',
      mode: ASR_MODE_STREAM,
    })
    if (typeof session.handlers?.onError === 'function') {
      session.handlers.onError(buildErrorPayload({
        sessionId: session.sessionId,
        requestId: session.connectId,
        message,
        classification,
      }))
    }
  }

  closeStreamSession(sessionId, reason = '') {
    const session = this.streamSessions.get(sessionId)
    if (!session) return
    session.closed = true
    this.streamSessions.delete(sessionId)
    if (session.timeoutRef) {
      clearTimeout(session.timeoutRef)
      session.timeoutRef = null
    }
    if (session.finalTimeoutRef) {
      clearTimeout(session.finalTimeoutRef)
      session.finalTimeoutRef = null
    }
    try {
      session.ws?.close()
    } catch {
      // ignore
    }
    if (reason && session.serverLogId) {
      log.info(`[voice-asr] stream closed session=${sessionId} reason=${reason} logid=${session.serverLogId}`)
    }
  }

  settleStreamFinal(session, text, extras = {}) {
    if (!session || session.settled) return
    const finalText = String(text || session.lastText || '').trim()
    if (!finalText) {
      const error = new Error('ASR 未返回可识别文本，请重试或检查录音内容')
      session.settled = true
      session.rejectFinal(error)
      this.emitStreamError(session, error)
      this.closeStreamSession(session.sessionId, 'empty-final')
      return
    }

    const finalUtterances = Array.isArray(extras.utterances) && extras.utterances.length
      ? extras.utterances
      : session.lastUtterances

    session.settled = true
    const payload = {
      sessionId: session.sessionId,
      requestId: session.connectId,
      text: finalText,
      utterances: Array.isArray(finalUtterances) ? finalUtterances : [],
      isFinalFrame: true,
      provider: 'volcengine-asr-sauc',
      mode: ASR_MODE_STREAM,
      logid: session.serverLogId || '',
    }
    if (typeof session.handlers?.onFinal === 'function') {
      session.handlers.onFinal(payload)
    }
    session.resolveFinal(payload)
    this.closeStreamSession(session.sessionId, 'final')
  }

  failStreamSession(session, error) {
    if (!session || session.closed || session.settled) return
    const normalized = error instanceof Error ? error : new Error(String(error || 'ASR 流式异常'))
    session.settled = true
    session.rejectFinal(normalized)
    this.emitStreamError(session, normalized)
    this.closeStreamSession(session.sessionId, 'error')
  }

  handleStreamMessage(session, raw) {
    try {
      const frame = parseWsPacket(raw)
      if (frame.type === WS_MESSAGE_SERVER_ERROR) {
        if (isAsrUnsupportedAudioFormat(frame.errorCode, frame.errorMessage)) {
          throw new Error('ASR 不接受当前音频格式。请使用 pcm/wav/ogg/mp3（避免 raw）')
        }
        const detail = frame.errorMessage ? `: ${frame.errorMessage}` : ''
        throw new Error(`ASR 流式服务错误(${frame.errorCode || 0})${detail}`)
      }
      if (frame.type !== WS_MESSAGE_FULL_SERVER_RESPONSE) return

      const payloadBuffer = maybeGunzipBuffer(frame.payload, frame.compression)
      const payloadText = payloadBuffer.toString('utf8')
      const packet = frame.serialization === WS_SERIALIZATION_JSON ? parseJsonSafe(payloadText) : null
      if (!packet || typeof packet !== 'object') {
        if (frame.isLast && !session.lastText) {
          throw new Error(`ASR 流式返回无法解析: ${payloadText.slice(0, 180)}`)
        }
        return
      }

      const extracted = extractAsrTextFromPacket(packet)
      if (!isAsrSuccessCode(extracted.code)) {
        if (isAsrUnsupportedAudioFormat(extracted.code, extracted.message)) {
          throw new Error('ASR 不接受当前音频格式。请使用 pcm/wav/ogg/mp3（避免 raw）')
        }
        throw new Error(`ASR 流式识别失败(${extracted.code}): ${extracted.message || 'unknown'}`)
      }

      const nextUtterances = Array.isArray(extracted.utterances) ? extracted.utterances : []
      const nextUtterancesVersion = getUtterancesVersion(nextUtterances)
      const utterancesChanged = nextUtterancesVersion && nextUtterancesVersion !== session.lastUtterancesVersion
      const textChanged = Boolean(extracted.text) && extracted.text !== session.lastText

      if (textChanged) {
        session.lastText = extracted.text
      }
      if (utterancesChanged) {
        session.lastUtterances = nextUtterances
        session.lastUtterancesVersion = nextUtterancesVersion
      }

      const hasChanges = textChanged || utterancesChanged
      if (hasChanges) {
        if (typeof session.handlers?.onPartial === 'function') {
          session.handlers.onPartial({
            sessionId: session.sessionId,
            requestId: session.connectId,
            text: extracted.text || session.lastText,
            utterances: nextUtterances,
            final: Boolean(frame.isLast),
            isFinalFrame: Boolean(frame.isLast),
          })
        }
      }

      if (frame.isLast) {
        this.settleStreamFinal(session, extracted.text || session.lastText, {
          utterances: nextUtterances,
        })
      }
    } catch (error) {
      this.failStreamSession(session, error)
    }
  }

  async startStreamSession(payload = {}, handlers = {}) {
    const credentials = this.mergeCredentials(payload.config || {})
    this.assertCommonCredentials(credentials)
    if (!credentials.asrResourceId) {
      throw new Error('缺少 ASR 资源 ID')
    }

    const sessionId = makeRequestId()
    const connectId = makeRequestId()
    const wsUrl = String(credentials.asrStreamUrl || ASR_STREAM_URL).trim() || ASR_STREAM_URL
    const audioInfo = inferAudioFormat(payload.mimeType || 'audio/webm')
    const requestPacket = this.buildStreamRequestPacket(audioInfo)

    const session = {
      sessionId,
      connectId,
      handlers,
      ws: null,
      settled: false,
      closed: false,
      stopSent: false,
      lastText: '',
      lastUtterances: [],
      lastUtterancesVersion: '',
      serverLogId: '',
      timeoutRef: null,
      finalTimeoutRef: null,
      resolveFinal: null,
      rejectFinal: null,
    }

    session.waitFinal = new Promise((resolve, reject) => {
      session.resolveFinal = resolve
      session.rejectFinal = reject
    })

    return new Promise((resolve, reject) => {
      let opened = false
      const ws = new WebSocket(wsUrl, {
        headers: buildAsrWsHeaders(credentials, connectId),
      })
      session.ws = ws
      this.streamSessions.set(sessionId, session)

      session.timeoutRef = setTimeout(() => {
        const err = new Error('ASR 流式建连超时，请重试')
        if (!opened) reject(err)
        this.failStreamSession(session, err)
      }, 12_000)

      ws.on('upgrade', (res) => {
        session.serverLogId = String(res?.headers?.['x-tt-logid'] || '').trim()
      })

      ws.on('open', () => {
        try {
          ws.send(requestPacket)
          opened = true
          clearTimeout(session.timeoutRef)
          session.timeoutRef = null
          resolve({
            sessionId,
            requestId: connectId,
            mode: ASR_MODE_STREAM,
          })
        } catch (error) {
          reject(error)
          this.failStreamSession(session, error)
        }
      })

      ws.on('message', (raw) => {
        this.handleStreamMessage(session, raw)
      })

      ws.on('error', (error) => {
        const err = new Error(`ASR 流式连接失败: ${error?.message || error}`)
        if (!opened) reject(err)
        this.failStreamSession(session, err)
      })

      ws.on('close', () => {
        if (session.closed || session.settled) return
        if (session.stopSent && session.lastText) {
          this.settleStreamFinal(session, session.lastText)
          return
        }
        const err = new Error('ASR 流式连接已关闭，未收到识别结果')
        if (!opened) reject(err)
        this.failStreamSession(session, err)
      })
    })
  }

  async pushStreamChunk(payload = {}) {
    const sessionId = String(payload.sessionId || '').trim()
    const session = this.streamSessions.get(sessionId)
    if (!session || session.closed || session.settled) {
      throw new Error('语音识别会话不存在或已结束')
    }
    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
      throw new Error('ASR 流式会话未就绪')
    }

    const { audioBuffer } = parseAudioChunkPayload(payload)
    if (!audioBuffer.length) {
      return { ok: true, ignored: true }
    }

    const packet = buildWsPacket({
      messageType: WS_MESSAGE_AUDIO_ONLY_REQUEST,
      flag: WS_FLAG_NO_SEQUENCE,
      serialization: WS_SERIALIZATION_NONE,
      compression: WS_COMPRESSION_GZIP,
      payload: gzipBuffer(audioBuffer),
      sequence: null,
    })

    session.ws.send(packet)
    return { ok: true, bytes: audioBuffer.length }
  }

  async stopStreamSession(payload = {}) {
    const sessionId = String(payload.sessionId || '').trim()
    const session = this.streamSessions.get(sessionId)
    if (!session || session.closed || session.settled) {
      throw new Error('语音识别会话不存在或已结束')
    }
    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
      throw new Error('ASR 流式会话未就绪')
    }

    let finalBuffer = Buffer.alloc(0)
    try {
      finalBuffer = parseAudioChunkPayload(payload).audioBuffer
    } catch {
      finalBuffer = Buffer.alloc(0)
    }

    const packet = buildWsPacket({
      messageType: WS_MESSAGE_AUDIO_ONLY_REQUEST,
      flag: WS_FLAG_LAST_NO_SEQUENCE,
      serialization: WS_SERIALIZATION_NONE,
      compression: WS_COMPRESSION_GZIP,
      payload: gzipBuffer(finalBuffer),
      sequence: null,
    })
    session.stopSent = true
    session.ws.send(packet)

    return new Promise((resolve, reject) => {
      session.finalTimeoutRef = setTimeout(() => {
        const lastText = String(session.lastText || '').trim()
        if (lastText) {
          // Some providers may close/timeout without a final frame; keep the best partial text.
          this.settleStreamFinal(session, lastText)
          return
        }
        const err = new Error('ASR 结束后等待结果超时，请重试')
        this.failStreamSession(session, err)
        reject(err)
      }, 10_000)

      session.waitFinal.then((result) => {
        if (session.finalTimeoutRef) {
          clearTimeout(session.finalTimeoutRef)
          session.finalTimeoutRef = null
        }
        resolve(result)
      }).catch((error) => {
        if (session.finalTimeoutRef) {
          clearTimeout(session.finalTimeoutRef)
          session.finalTimeoutRef = null
        }
        reject(error)
      })
    })
  }

  async cancelStreamSession(payload = {}) {
    const sessionId = String(payload.sessionId || '').trim()
    const session = this.streamSessions.get(sessionId)
    if (!session) {
      return { canceled: false }
    }
    const err = new Error('已取消语音识别')
    session.settled = true
    session.rejectFinal(err)
    this.closeStreamSession(sessionId, 'canceled')
    return { canceled: true }
  }

  async transcribeAudioByStream(payload = {}, credentials) {
    const sourceAudio = String(payload.audioDataUrl || payload.audioUrl || '').trim()
    if (!sourceAudio) throw new Error('录音数据为空')
    if (!sourceAudio.startsWith('data:')) {
      throw new Error('流式 ASR 需要 data:audio/* 录音数据')
    }

    let mimeType = String(payload.mimeType || '').trim()
    const parsed = stripDataUrlPrefix(sourceAudio)
    mimeType = mimeType || parsed.mimeType
    if (!parsed.base64) throw new Error('录音数据解析失败')

    const audioBuffer = Buffer.from(parsed.base64, 'base64')
    if (!audioBuffer.length) throw new Error('录音数据为空')

    const audioInfo = inferAudioFormat(mimeType)
    const connectId = makeRequestId()
    const wsUrl = String(credentials.asrStreamUrl || ASR_STREAM_URL).trim() || ASR_STREAM_URL

    const fullRequestPacket = buildAsrFullRequestPacket(audioInfo, { stream: true })

    const audioChunks = splitBufferBySize(audioBuffer, 6400)
    if (!audioChunks.length) throw new Error('录音数据为空')

    let finalText = ''
    let serverLogId = ''
    await new Promise((resolve, reject) => {
      let settled = false
      const done = (error = null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          ws.close()
        } catch {
          // ignore
        }
        if (error) reject(error)
        else resolve()
      }

      const ws = new WebSocket(wsUrl, {
        headers: buildAsrWsHeaders(credentials, connectId),
      })

      const timer = setTimeout(() => {
        if (finalText) {
          done()
          return
        }
        done(new Error('ASR 流式识别超时，请重试'))
      }, 25_000)

      ws.on('upgrade', (res) => {
        serverLogId = String(res?.headers?.['x-tt-logid'] || '').trim()
      })

      ws.on('open', async () => {
        try {
          ws.send(fullRequestPacket)
          for (let i = 0; i < audioChunks.length; i += 1) {
            const chunk = audioChunks[i]
            const isLast = i === audioChunks.length - 1
            const packet = buildWsPacket({
              messageType: WS_MESSAGE_AUDIO_ONLY_REQUEST,
              flag: isLast ? WS_FLAG_LAST_NO_SEQUENCE : WS_FLAG_NO_SEQUENCE,
              serialization: WS_SERIALIZATION_NONE,
              compression: WS_COMPRESSION_GZIP,
              payload: gzipBuffer(chunk),
              sequence: null,
            })
            ws.send(packet)
            // 官方建议 100-200ms 分包，客户端离线录音场景用较短间隔即可稳定服务端处理。
            await sleep(25)
          }
        } catch (error) {
          done(error)
        }
      })

      ws.on('message', (raw) => {
        try {
          const frame = parseWsPacket(raw)
          if (frame.type === WS_MESSAGE_SERVER_ERROR) {
            const detail = frame.errorMessage ? `: ${frame.errorMessage}` : ''
            throw new Error(`ASR 流式服务错误(${frame.errorCode || 0})${detail}`)
          }
          if (frame.type !== WS_MESSAGE_FULL_SERVER_RESPONSE) return

          const payloadBuffer = maybeGunzipBuffer(frame.payload, frame.compression)
          const payloadText = payloadBuffer.toString('utf8')
          const packet = frame.serialization === WS_SERIALIZATION_JSON ? parseJsonSafe(payloadText) : null
          if (!packet || typeof packet !== 'object') {
            if (frame.isLast && !finalText) {
              throw new Error(`ASR 流式返回无法解析: ${payloadText.slice(0, 180)}`)
            }
            return
          }

          const extracted = extractAsrTextFromPacket(packet)
          if (extracted.code && extracted.code !== 20000000) {
            throw new Error(`ASR 流式识别失败(${extracted.code}): ${extracted.message || 'unknown'}`)
          }
          if (extracted.text) finalText = extracted.text

          if (frame.isLast) {
            if (!finalText) throw new Error('ASR 未返回可识别文本，请重试或检查录音内容')
            done()
          }
        } catch (error) {
          done(error)
        }
      })

      ws.on('error', (error) => {
        done(new Error(`ASR 流式连接失败: ${error?.message || error}`))
      })

      ws.on('close', () => {
        if (settled) return
        if (finalText) {
          done()
          return
        }
        done(new Error('ASR 流式连接已关闭，未收到识别结果'))
      })
    })

    if (!finalText) {
      throw new Error('ASR 未返回可识别文本，请重试或检查录音内容')
    }

    if (serverLogId) {
      log.info(`[voice-asr] stream success connectId=${connectId} logid=${serverLogId}`)
    }

    return {
      requestId: connectId,
      text: finalText,
      provider: 'volcengine-asr-sauc',
      mode: ASR_MODE_STREAM,
      logid: serverLogId,
    }
  }

  async transcribeAudioByFile(payload = {}, credentials) {
    const sourceAudioUrl = String(payload.audioUrl || payload.audioDataUrl || '').trim()
    if (!sourceAudioUrl) throw new Error('录音数据为空')

    let mimeType = String(payload.mimeType || '').trim()
    let audioUrl = sourceAudioUrl
    const isDataUrl = sourceAudioUrl.startsWith('data:')
    if (isDataUrl) {
      const parsed = stripDataUrlPrefix(sourceAudioUrl)
      mimeType = mimeType || parsed.mimeType
      if (!parsed.base64) throw new Error('录音数据解析失败')
      const uploadEndpoint = String(credentials.asrUploadEndpoint || '').trim()
      if (uploadEndpoint) {
        audioUrl = await this.uploadAudioDataUrl(sourceAudioUrl, mimeType, uploadEndpoint)
        log.info(`[voice-asr] uploaded audio for asr: ${uploadEndpoint}`)
      }
    } else if (!hasHttpUrl(audioUrl)) {
      throw new Error('ASR 音频地址需为 data:audio/* 或可访问的 http(s) URL')
    }

    const audioInfo = inferAudioFormat(mimeType)
    const requestId = makeRequestId()

    const submitBody = buildAsrRequestPayload({
      audioInfo,
      audioOverrides: { url: audioUrl },
    })

    const submitResp = await fetch(ASR_SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-App-Key': credentials.appId,
        'X-Api-Access-Key': credentials.accessKey,
        'X-Api-Resource-Id': credentials.asrResourceId,
        'X-Api-Request-Id': requestId,
        'X-Api-Sequence': '-1',
      },
      body: JSON.stringify(submitBody),
    })

    const submitText = await submitResp.text()
    if (!submitResp.ok) {
      if (isDataUrl && !credentials.asrUploadEndpoint && looksLikeAsrUrlFormatError(submitText)) {
        throw new Error('ASR 接口不接受 data: 音频地址。请在设置中配置“ASR 上传接口（可选）”，或改用流式 ASR。')
      }
      throw new Error(`ASR 提交失败(${submitResp.status}): ${submitText.slice(0, 240)}`)
    }

    const submitCode = toStatusCode(submitResp.headers.get('X-Api-Status-Code'))
    if (submitCode && submitCode !== 20000000) {
      const submitMsg = submitResp.headers.get('X-Api-Message') || submitText || 'unknown'
      if (isDataUrl && !credentials.asrUploadEndpoint && looksLikeAsrUrlFormatError(submitMsg)) {
        throw new Error(`ASR 提交被拒绝(${submitCode})：当前账号要求 http(s) 音频 URL，请先配置 ASR 上传接口。`)
      }
      throw new Error(`ASR 提交被拒绝(${submitCode}): ${submitMsg}`)
    }

    const maxRounds = 24
    for (let i = 0; i < maxRounds; i += 1) {
      await sleep(i === 0 ? 250 : 550)

      const queryResp = await fetch(ASR_QUERY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-App-Key': credentials.appId,
          'X-Api-Access-Key': credentials.accessKey,
          'X-Api-Resource-Id': credentials.asrResourceId,
          'X-Api-Request-Id': requestId,
        },
        body: '{}',
      })

      const queryText = await queryResp.text()
      if (!queryResp.ok) {
        throw new Error(`ASR 查询失败(${queryResp.status}): ${queryText.slice(0, 240)}`)
      }

      const parsed = parseJsonSafe(queryText)
      const result = parsed?.result
      const text = typeof result?.text === 'string'
        ? result.text
        : (Array.isArray(result) && typeof result[0]?.text === 'string' ? result[0].text : '')

      if (String(text || '').trim()) {
        return {
          requestId,
          text: String(text).trim(),
          provider: 'volcengine-asr-auc',
          mode: ASR_MODE_FILE,
        }
      }

      const queryCode = toStatusCode(queryResp.headers.get('X-Api-Status-Code'))
      const queryMsg = String(queryResp.headers.get('X-Api-Message') || '').trim()
      const doneAndEmpty = queryCode === 20000000 && i >= 3
      const hardFail = queryCode !== 0 && queryCode !== 20000000 && i >= 3

      if (doneAndEmpty) {
        throw new Error('ASR 未返回可识别文本，请重试或检查录音内容')
      }
      if (hardFail) {
        if (isAsrInvalidAudioUri(queryCode, queryMsg || queryText)) {
          throw new Error('ASR 无法下载音频：当前录音地址不是可公网访问的 http(s) 文件。请在设置里配置“ASR 上传接口”，或改用流式 ASR。')
        }
        throw new Error(`ASR 查询失败(${queryCode}): ${queryMsg || queryText.slice(0, 180)}`)
      }
    }

    throw new Error('ASR 识别超时，请重试')
  }

  async requestTtsOnce({ credentials, text, charId, emotion, voiceType }) {
    const requestId = makeRequestId()
    const payload = cleanObject({
      user: {
        uid: `muyu-desktop-${Date.now()}`,
      },
      namespace: 'BidirectionalTTS',
      req_params: {
        text,
        speaker: this.resolveVoiceType(charId, voiceType),
        audio_params: {
          format: credentials.ttsFormat || 'mp3',
          sample_rate: credentials.ttsSampleRate || 24000,
          emotion,
          emotion_scale: emotion ? 4 : undefined,
        },
      },
    })

    const response = await fetch(TTS_V3_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json, audio/*',
        'X-Api-App-Id': credentials.appId,
        'X-Api-Access-Key': credentials.accessKey,
        'X-Api-Resource-Id': credentials.ttsResourceId,
        'X-Api-Request-Id': requestId,
      },
      body: JSON.stringify(payload),
    })

    const contentType = String(response.headers.get('content-type') || '').toLowerCase()
    if (contentType.startsWith('audio/')) {
      const raw = await response.arrayBuffer()
      if (!response.ok) {
        throw new Error(`TTS 请求失败(${response.status}): 返回了 audio 流但状态异常`)
      }
      const base64 = toBase64FromArrayBuffer(raw)
      if (!base64) {
        throw new Error('TTS 未返回音频数据（audio 流为空）')
      }
      return {
        requestId,
        voiceType: payload?.req_params?.speaker || DEFAULT_CHAR_VOICE,
        emotion: emotion || '',
        format: credentials.ttsFormat || 'mp3',
        audioBase64: base64,
      }
    }

    const streamText = await response.text()
    if (!response.ok) {
      throw new Error(`TTS 请求失败(${response.status}): ${streamText.slice(0, 260)}`)
    }

    const audioChunks = []
    const packets = collectSseJsonPackets(streamText)
    if (packets.length > 0) {
      for (const packet of packets) {
        const code = extractTtsCode(packet)
        if (code !== 0 && code !== 20000000) {
          throw new Error(`TTS 合成失败(${code}): ${extractTtsMessage(packet) || 'unknown'}`)
        }
        const chunk = extractTtsAudioChunk(packet)
        if (chunk) audioChunks.push(chunk)
      }
    } else {
      const singleJson = parseJsonSafe(streamText)
      if (singleJson && typeof singleJson === 'object') {
        const code = extractTtsCode(singleJson)
        if (code !== 0 && code !== 20000000) {
          throw new Error(`TTS 合成失败(${code}): ${extractTtsMessage(singleJson) || 'unknown'}`)
        }
        const chunk = extractTtsAudioChunk(singleJson)
        if (chunk) audioChunks.push(chunk)
      } else {
        // Some chunked responses concatenate multiple JSON objects without SSE markers.
        const jsonObjects = extractJsonObjectsFromText(streamText)
        for (const packet of jsonObjects) {
          const code = extractTtsCode(packet)
          if (code !== 0 && code !== 20000000) {
            throw new Error(`TTS 合成失败(${code}): ${extractTtsMessage(packet) || 'unknown'}`)
          }
          const chunk = extractTtsAudioChunk(packet)
          if (chunk) audioChunks.push(chunk)
        }
      }
    }

    if (audioChunks.length === 0) {
      const snippet = streamText.replace(/\s+/g, ' ').slice(0, 180)
      throw new Error(`TTS 未返回音频数据（返回片段: ${snippet || 'empty'}）`)
    }

    const resolvedVoiceType = payload?.req_params?.speaker || DEFAULT_CHAR_VOICE
    return {
      requestId,
      voiceType: resolvedVoiceType,
      emotion: emotion || '',
      format: credentials.ttsFormat || 'mp3',
      audioBase64: audioChunks.join(''),
    }
  }

  async synthesize(payload = {}) {
    const text = String(payload.text || '').trim()
    if (!text) throw new Error('TTS 文本不能为空')

    const credentials = this.mergeCredentials(payload.config || {})
    this.assertCommonCredentials(credentials)
    if (!credentials.ttsResourceId) {
      throw new Error('缺少 TTS 资源 ID')
    }

    const charId = String(payload.charId || '').trim()
    const requestedVoiceType = String(payload.voiceType || '').trim()
    const wantedEmotion = this.detectEmotion(text, charId, payload.emotion)

    try {
      const result = await this.requestTtsOnce({
        credentials,
        text,
        charId,
        emotion: wantedEmotion,
        voiceType: requestedVoiceType,
      })

      return {
        ...result,
        mimeType: ttsFormatToMime(result.format),
        fallbackEmotionUsed: false,
      }
    } catch (error) {
      const message = String(error?.message || error || '')
      const maybeEmotionIssue = /emotion|情感|unsupported|400|40402003|invalid/i.test(message)
      if (!wantedEmotion || !maybeEmotionIssue) throw error

      log.warn(`[voice-tts] emotion fallback for ${charId}: ${wantedEmotion}`)
      const fallback = await this.requestTtsOnce({
        credentials,
        text,
        charId,
        emotion: '',
        voiceType: requestedVoiceType,
      })
      return {
        ...fallback,
        mimeType: ttsFormatToMime(fallback.format),
        fallbackEmotionUsed: true,
      }
    }
  }

  async testConnection(overrides = {}) {
    const start = Date.now()
    const credentials = this.mergeCredentials(overrides || {})
    this.assertCommonCredentials(credentials)

    if (!credentials.ttsResourceId) {
      throw new Error('缺少 TTS 资源 ID')
    }

    const result = await this.synthesize({
      text: '语音连通测试',
      charId: 'muyu',
      emotion: 'neutral',
      config: credentials,
    })

    return {
      ok: true,
      latencyMs: Date.now() - start,
      mode: 'tts',
      voiceType: result.voiceType,
      fallbackEmotionUsed: Boolean(result.fallbackEmotionUsed),
      asrMode: normalizeAsrMode(credentials.asrMode),
      asrConfigured: Boolean(credentials.asrResourceId),
    }
  }
}

module.exports = VoiceService
