const log = require('../logger')

class MemoryService {
  constructor(db, llmService) {
    this.db = db
    this.llmService = llmService
    this._locks = new Map()
  }

  async runSummaryIfNeeded({ sessionId = 'default', threshold = 20, maxMessages = 40 } = {}) {
    const prev = this._locks.get(sessionId) || Promise.resolve()
    const next = prev.then(() => this._doRunSummary({ sessionId, threshold, maxMessages }))
      .catch((err) => { throw err })
    // Always settle so the chain doesn't block future calls on rejection
    this._locks.set(sessionId, next.catch(() => {}))
    return next
  }

  async _doRunSummary({ sessionId, threshold, maxMessages }) {
    const unsummarized = this.db.getUnsummarizedMessages(sessionId)
    if (unsummarized.length < threshold) {
      return { created: false, reason: 'threshold-not-met', pending: unsummarized.length }
    }

    const slice = unsummarized.slice(0, maxMessages)
    let summary
    try {
      summary = await this.llmService.generateSummary(slice, sessionId)
    } catch (err) {
      log.error('[memory-service]', err)
      throw err
    }
    if (!summary) {
      return { created: false, reason: 'summary-empty', pending: unsummarized.length }
    }

    this.db.addMemorySummary(summary, slice[0].id, slice[slice.length - 1].id, sessionId)
    return { created: true, from: slice[0].id, to: slice[slice.length - 1].id, count: slice.length }
  }
}

module.exports = MemoryService
