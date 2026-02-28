const log = require('../logger')

const FALLBACK_SESSION_ID = 'pet_baihu'
const INPUT_TOKEN_LIMIT = 6000
const PROFILE_EXTRACTION_INTERVAL = 3

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

function isBlank(value) {
  return normalizeText(value) === ''
}

function resolveRelationshipStage(summaryCount) {
  if (summaryCount >= 20) return 'close'
  if (summaryCount >= 5) return 'familiar'
  return 'new'
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

  async _extractAndMergeProfile(conversationText) {
    const extracted = await this.llmService.generateProfileExtraction(conversationText)
    if (!extracted || typeof extracted !== 'object') return

    const existing = this.db.getUserProfile()
    const toSave = {}

    const name = normalizeText(extracted.name)
    if (name && isBlank(existing.name)) {
      toSave.name = name
    }

    const occupation = normalizeText(extracted.occupation)
    if (occupation && isBlank(existing.occupation)) {
      toSave.occupation = occupation
    }

    const birthday = normalizeText(extracted.birthday)
    if (/^\d{2}-\d{2}$/.test(birthday) && isBlank(existing.birthday)) {
      toSave.birthday = birthday
    }

    const birthdayYear = parseSafeInt(extracted.birthday_year, 0)
    if (birthdayYear > 0 && isBlank(existing.birthday_year)) {
      toSave.birthday_year = String(birthdayYear)
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
  }

  async _doRunSummary({ sessionId, threshold, maxMessages, isQuitting, force }) {
    const unsummarized = this.db.getUnsummarizedMessages(sessionId)
    if (!this._shouldTrigger({
      unsummarizedCount: unsummarized.length,
      threshold,
      isQuitting,
      force,
    })) {
      return { created: false, reason: 'threshold-not-met', pending: unsummarized.length }
    }

    let inputSlice = unsummarized.slice(0, maxMessages)
    let inputText = this._buildConversationText(inputSlice)
    while (estimateTokens(inputText) > INPUT_TOKEN_LIMIT && inputSlice.length > 2) {
      inputSlice = inputSlice.slice(1)
      inputText = this._buildConversationText(inputSlice)
    }

    if (inputSlice.length === 0) {
      return { created: false, reason: 'summary-empty', pending: unsummarized.length }
    }

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
      return { created: false, reason: 'summary-empty', pending: unsummarized.length }
    }

    const fromMsgId = inputSlice[0].id
    const toMsgId = inputSlice[inputSlice.length - 1].id
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

    const memory = this.db.getCharacterMemory(sessionId)
    const nextCount = (Number(memory.summaryCount) || 0) + 1
    const nextStage = resolveRelationshipStage(nextCount)
    this.db.upsertCharacterMemory(sessionId, {
      relationshipStage: nextStage,
      summaryCount: nextCount,
    })

    if (nextCount % PROFILE_EXTRACTION_INTERVAL === 0) {
      this._extractAndMergeProfile(inputText).catch((error) => {
        log.warn('[profile-extract]', error?.message || String(error))
      })
    }

    return { created: true, from: fromMsgId, to: toMsgId, count: inputSlice.length }
  }
}

module.exports = MemoryService
