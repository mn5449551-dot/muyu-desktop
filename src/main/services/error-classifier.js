const AUTH_PATTERN = /unauthorized|invalid.*key|auth|权限|鉴权/i
const ENDPOINT_PATTERN = /endpoint|not found|completions|responses|路由|路径/i
const TIMEOUT_PATTERN = /timeout|timed out|超时/i
const NETWORK_PATTERN = /fetch failed|network|econn|enotfound|dns|socket|断网|网络/i
const MISSING_KEY_PATTERN = /缺少.*api\s*key|未配置.*api\s*key|请先.*api\s*key|missing.*api\s*key|apikey/i
const ASR_NO_TEXT_PATTERN = /未返回可识别文本|未识别到有效文本|录音内容|说得更清楚|语音过短|empty|no text/i
const AUDIO_FORMAT_PATTERN = /不接受当前音频格式|unsupported|format|pcm\/wav\/ogg\/mp3|invalid audio/i

const KNOWN_KINDS = new Set([
  'missing_key',
  'auth',
  'timeout',
  'endpoint',
  'network',
  'provider',
  'unknown',
  'aborted',
  'asr_no_text',
  'audio_format',
])

function normalizeKind(kind) {
  const value = String(kind || '').trim().toLowerCase()
  return KNOWN_KINDS.has(value) ? value : ''
}

function parseStatusCode(value) {
  const n = Number(value)
  if (Number.isInteger(n) && n >= 100 && n <= 599) return n
  const text = String(value || '')
  const match = text.match(/\b([1-5]\d{2})\b/)
  return match ? Number(match[1]) : null
}

function classifyCommon({ message = '', status = null, mode = '' } = {}) {
  const text = String(message || '')

  if (status === 401 || status === 403 || AUTH_PATTERN.test(text)) {
    return {
      kind: 'auth',
      reasonCode: 'auth_invalid_credential',
      retryable: false,
      status,
      mode,
    }
  }

  if ([404, 405, 415, 422].includes(status) || ENDPOINT_PATTERN.test(text)) {
    return {
      kind: 'endpoint',
      reasonCode: 'endpoint_mismatch',
      retryable: false,
      status,
      mode,
    }
  }

  if (TIMEOUT_PATTERN.test(text)) {
    return {
      kind: 'timeout',
      reasonCode: 'request_timeout',
      retryable: true,
      status,
      mode,
    }
  }

  if (NETWORK_PATTERN.test(text)) {
    return {
      kind: 'network',
      reasonCode: 'network_unreachable',
      retryable: true,
      status,
      mode,
    }
  }

  return {
    kind: 'provider',
    reasonCode: 'provider_error',
    retryable: false,
    status,
    mode,
  }
}

function classifyLlmError(errorLike) {
  const message = String(errorLike?.message || errorLike || '')
  const mode = String(errorLike?.mode || '').trim().toLowerCase()
  const status = parseStatusCode(errorLike?.httpStatus) || parseStatusCode(errorLike?.status) || parseStatusCode(message)

  if (MISSING_KEY_PATTERN.test(message)) {
    return {
      source: 'llm',
      kind: 'missing_key',
      reasonCode: 'llm_missing_api_key',
      retryable: false,
      status,
      mode,
    }
  }

  const base = classifyCommon({ message, status, mode })
  if (base.kind === 'auth') base.reasonCode = 'llm_auth_invalid_key'
  if (base.kind === 'endpoint') base.reasonCode = 'llm_endpoint_mismatch'
  if (base.kind === 'timeout') base.reasonCode = 'llm_timeout'
  if (base.kind === 'network') base.reasonCode = 'llm_network_unreachable'
  if (base.kind === 'provider') base.reasonCode = 'llm_provider_error'

  return {
    source: 'llm',
    ...base,
  }
}

function classifyVoiceError(errorLike, context = {}) {
  const message = String(errorLike?.message || errorLike || '')
  const mode = String(context.mode || errorLike?.mode || '').trim().toLowerCase()
  const status = parseStatusCode(errorLike?.httpStatus) || parseStatusCode(errorLike?.status) || parseStatusCode(message)
  const source = String(context.source || 'voice_asr')

  if (ASR_NO_TEXT_PATTERN.test(message)) {
    return {
      source,
      kind: 'asr_no_text',
      reasonCode: 'voice_asr_no_text',
      retryable: true,
      status,
      mode,
    }
  }

  if (AUDIO_FORMAT_PATTERN.test(message)) {
    return {
      source,
      kind: 'audio_format',
      reasonCode: 'voice_asr_unsupported_audio',
      retryable: false,
      status,
      mode,
    }
  }

  const base = classifyCommon({ message, status, mode })
  if (base.kind === 'auth') base.reasonCode = 'voice_auth_invalid_token'
  if (base.kind === 'endpoint') base.reasonCode = 'voice_endpoint_mismatch'
  if (base.kind === 'timeout') base.reasonCode = 'voice_timeout'
  if (base.kind === 'network') base.reasonCode = 'voice_network_unreachable'
  if (base.kind === 'provider') base.reasonCode = 'voice_provider_error'

  return {
    source,
    ...base,
  }
}

function buildErrorPayload({
  requestId = '',
  sessionId = '',
  message = '',
  aborted = false,
  classification = {},
} = {}) {
  const kind = aborted ? 'aborted' : normalizeKind(classification.kind) || 'unknown'
  const reasonCode = aborted
    ? 'request_aborted'
    : String(classification.reasonCode || 'unknown_error').trim().toLowerCase()

  return {
    requestId: String(requestId || '').trim(),
    sessionId: String(sessionId || '').trim(),
    source: String(classification.source || '').trim() || 'unknown',
    message: String(message || '').trim() || '请求失败',
    aborted: Boolean(aborted),
    kind,
    reasonCode,
    retryable: aborted ? true : Boolean(classification.retryable),
    status: parseStatusCode(classification.status),
    mode: String(classification.mode || '').trim().toLowerCase(),
  }
}

module.exports = {
  classifyLlmError,
  classifyVoiceError,
  buildErrorPayload,
}
