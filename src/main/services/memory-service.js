const log = require('../logger')

const FALLBACK_SESSION_ID = 'pet_baihu'
const INPUT_TOKEN_LIMIT = 6000
const PROFILE_EXTRACTION_INTERVAL = 3
const SUMMARY_STRUCTURED_KEYS = ['facts', 'preferences', 'goals', 'constraints', 'todos', 'risks', 'key_moments', 'open_threads']
const SUMMARY_NOISE_PATTERNS = [
  /\[object object\]/i,
  /无意义内容|重复发1|多次询问.*身份|乱发字符|零散内容/i,
  /\/clear/i,
]

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 2)
}

function parseSafeInt(value, fallback = 0) {
  const n = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(n) ? n : fallback
}

function normalizeSessionId(value, fallback = FALLBACK_SESSION_ID) {
  const sessionId = String(value || '').trim()
  return sessionId || fallback
}

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeStructuredList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeText(item)).filter(Boolean)
}

function hasNoiseSignal(text) {
  const source = String(text || '').trim()
  if (!source) return true
  return SUMMARY_NOISE_PATTERNS.some((pattern) => pattern.test(source))
}

function hasAnyStructuredInfo(structured) {
  if (!structured || typeof structured !== 'object') return false
  return SUMMARY_STRUCTURED_KEYS.some((key) => normalizeStructuredList(structured[key]).length > 0)
}


class MemoryService {
  constructor(db, llmService) {
    this.db = db
    this.llmService = llmService
    this._locks = new Map()
  }

  _getDefaultSessionId() {
    return normalizeSessionId(this.db.DEFAULT_SESSION_ID, FALLBACK_SESSION_ID)
  }

  _buildConversationText(messages = []) {
    if (!Array.isArray(messages) || messages.length === 0) return ''
    return messages.map((item) => `[${item.role}] ${item.content}`).join('\n')
  }

  _shouldTrigger({ unsummarizedCount = 0, threshold = 20, isQuitting = false, force = false } = {}) {
    if (force) return unsummarizedCount > 0
    const effectiveThreshold = isQuitting ? Math.min(threshold, 10) : threshold
    return unsummarizedCount >= effectiveThreshold
  }

  _skipLowQualitySlice(sessionId, inputSlice = [], reason = 'quality-gated') {
    if (!Array.isArray(inputSlice) || inputSlice.length === 0) return
    const fromMsgId = Number(inputSlice[0]?.id || 0)
    const toMsgId = Number(inputSlice[inputSlice.length - 1]?.id || 0)
    if (fromMsgId <= 0 || toMsgId <= 0) return
    const sid = normalizeSessionId(sessionId, this._getDefaultSessionId())
    const markerId = this.db.addMemorySummary(`[SKIP:${reason}]`, fromMsgId, toMsgId, sid, {
      structured: null,
    })
    if (markerId > 0) {
      this.db.softDeleteSummary(markerId)
    }
  }

  async runSummaryIfNeeded({
    sessionId = '',
    threshold = 20,
    maxMessages = 40,
    isQuitting = false,
    force = false,
  } = {}) {
    const sid = normalizeSessionId(sessionId, this._getDefaultSessionId())
    const prev = this._locks.get(sid) || Promise.resolve()
    const next = prev.then(() => this._doRunSummary({
      sessionId: sid,
      threshold,
      maxMessages,
      isQuitting,
      force,
    }))
    // Always settle so the chain doesn't block future calls on rejection.
    this._locks.set(sid, next.catch(() => {}))
    return next
  }

  async _extractAndMergeProfile(conversationText, sessionId = '') {
    const extracted = await this.llmService.generateProfileExtraction(conversationText)
    if (!extracted || typeof extracted !== 'object') return

    const existing = this.db.getUserProfile()
    const toSave = {}
    const conflicts = []

    const upsertProfileField = (fieldKey, nextValue) => {
      const normalized = normalizeText(nextValue)
      if (!normalized) return

      const oldValue = existing[fieldKey]
      const normalizedOldValue = normalizeText(oldValue)
      if (!normalizedOldValue) {
        toSave[fieldKey] = normalized
        return
      }

      if (normalized !== normalizedOldValue) {
        conflicts.push({ fieldKey, oldValue, newValue: normalized })
      }
    }

    upsertProfileField('name', extracted.name)
    upsertProfileField('occupation', extracted.occupation)

    const birthday = normalizeText(extracted.birthday)
    if (/^\d{2}-\d{2}$/.test(birthday)) {
      upsertProfileField('birthday', birthday)
    }

    const birthdayYear = parseSafeInt(extracted.birthday_year, 0)
    if (birthdayYear > 0) {
      upsertProfileField('birthday_year', String(birthdayYear))
    }

    if (Array.isArray(extracted.traits) && extracted.traits.length > 0) {
      const existingTraits = String(existing.traits || '')
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
      const incomingTraits = extracted.traits
        .map((item) => normalizeText(item))
        .filter(Boolean)
      const merged = Array.from(new Set(existingTraits.concat(incomingTraits)))
      if (merged.length > existingTraits.length) {
        toSave.traits = merged.join(', ')
      }
    }

    const notesAppend = normalizeText(extracted.notes_append)
    if (notesAppend) {
      const prev = normalizeText(existing.notes)
      toSave.notes = prev ? `${prev}\n---\n${notesAppend}` : notesAppend
    }

    Object.entries(toSave).forEach(([key, value]) => {
      this.db.setUserProfileField(key, String(value || ''))
    })

    if (typeof this.db.recordProfileFieldConflict === 'function' && conflicts.length > 0) {
      const sid = normalizeSessionId(sessionId, this._getDefaultSessionId())
      conflicts.forEach((item) => {
        this.db.recordProfileFieldConflict({
          fieldKey: item.fieldKey,
          oldValue: item.oldValue,
          newValue: item.newValue,
          sessionId: sid,
          createdAt: Date.now(),
        })
      })
    }
  }

  async _doRunSummary({ sessionId, threshold, maxMessages, isQuitting, force }) {
    const unsummarized = this.db.getUnsummarizedMessages(sessionId)
    const pendingCount = unsummarized.length

    const rejectLowQuality = (markerReason, reason) => {
      this._skipLowQualitySlice(sessionId, inputSlice, markerReason)
      return { created: false, reason, pending: pendingCount }
    }

    if (!this._shouldTrigger({
      unsummarizedCount: pendingCount,
      threshold,
      isQuitting,
      force,
    })) {
      return { created: false, reason: 'threshold-not-met', pending: pendingCount }
    }

    let inputSlice = unsummarized.slice(0, maxMessages)
    let inputText = this._buildConversationText(inputSlice)
    while (estimateTokens(inputText) > INPUT_TOKEN_LIMIT && inputSlice.length > 2) {
      inputSlice = inputSlice.slice(1)
      inputText = this._buildConversationText(inputSlice)
    }

    if (inputSlice.length === 0) {
      return { created: false, reason: 'summary-empty', pending: pendingCount }
    }
    const fromMsgId = inputSlice[0].id
    const toMsgId = inputSlice[inputSlice.length - 1].id

    let summaryResult
    try {
      summaryResult = await this.llmService.generateSummary(inputSlice, sessionId)
    } catch (err) {
      log.error('[memory-service]', err)
      throw err
    }
    const summaryText = typeof summaryResult === 'string'
      ? String(summaryResult || '').trim()
      : String(summaryResult?.summaryText || '').trim()
    const summaryStructured = summaryResult && typeof summaryResult === 'object'
      ? (summaryResult.structured || null)
      : null

    if (!summaryText) {
      return rejectLowQuality('summary-empty', 'summary-empty')
    }
    if (!summaryStructured || typeof summaryStructured !== 'object') {
      return rejectLowQuality('no-structured', 'quality-gated-no-structured')
    }
    if (hasNoiseSignal(inputText) || hasNoiseSignal(summaryText)) {
      return rejectLowQuality('noisy', 'quality-gated-noisy')
    }
    if (!hasAnyStructuredInfo(summaryStructured)) {
      return rejectLowQuality('empty-structured', 'quality-gated-empty-structured')
    }
    this.db.addMemorySummary(summaryText, fromMsgId, toMsgId, sessionId, {
      structured: summaryStructured,
    })
    this.db.addSummaryHistory({
      sessionId,
      summaryText,
      fromMsgId,
      toMsgId,
      inputTokens: estimateTokens(inputText),
      outputTokens: estimateTokens(summaryText),
      createdAt: Date.now(),
    })

    const summaryCount = typeof this.db.getSummaryHistoryCount === 'function'
      ? this.db.getSummaryHistoryCount(sessionId)
      : 0
    if (summaryCount > 0 && summaryCount % PROFILE_EXTRACTION_INTERVAL === 0) {
      this._extractAndMergeProfile(inputText, sessionId).catch((error) => {
        log.warn('[profile-extract]', error?.message || String(error))
      })
    }

    return { created: true, from: fromMsgId, to: toMsgId, count: inputSlice.length }
  }
}

module.exports = MemoryService
