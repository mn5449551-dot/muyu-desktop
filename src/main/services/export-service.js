const fs = require('fs')
const path = require('path')
const log = require('../logger')

const EXPORT_SCOPE_KEYS = ['chats', 'summaries', 'profile']
const EXPORT_FORMAT_KEYS = ['markdown', 'json', 'jsonl']

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatTimestampForFile(ts) {
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  const hh = pad2(d.getHours())
  const min = pad2(d.getMinutes())
  const ss = pad2(d.getSeconds())
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`
}

function toIso(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n)) return ''
  return new Date(n).toISOString()
}

function toLocal(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n)) return ''
  return new Date(n).toLocaleString()
}

function inferCharIdFromSessionId(sessionId) {
  const sid = String(sessionId || '')
  if (!sid.startsWith('pet_')) return ''
  return sid.slice(4)
}

function getSessionMeta(sessionId, charNameById) {
  const sid = String(sessionId || '').trim()
  const charId = inferCharIdFromSessionId(sid)
  const charName = charId ? (charNameById.get(charId) || charId) : ''
  return { sid, charId, charName }
}

function sanitizeFilePart(input) {
  return String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function parseJsonObject(value) {
  if (!value || typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // ignore
  }
  return null
}

class ExportService {
  constructor(db) {
    this.db = db
  }

  normalizeIncludeScopes(includeScopes) {
    const hasInput = includeScopes && typeof includeScopes === 'object'
    if (!hasInput) {
      return {
        chats: true,
        summaries: true,
        profile: true,
        selectedScopes: EXPORT_SCOPE_KEYS.slice(),
      }
    }

    const all = Boolean(includeScopes.all)
    const normalized = {
      chats: all || Boolean(includeScopes.chats),
      summaries: all || Boolean(includeScopes.summaries),
      profile: all || Boolean(includeScopes.profile),
    }
    const selectedScopes = EXPORT_SCOPE_KEYS.filter((key) => normalized[key])

    return { ...normalized, selectedScopes }
  }

  normalizeFormats(formats) {
    const hasInput = formats && typeof formats === 'object'
    if (!hasInput) {
      return {
        markdown: true,
        json: true,
        jsonl: true,
        selectedFormats: EXPORT_FORMAT_KEYS.slice(),
      }
    }

    const normalized = {
      markdown: Boolean(formats.markdown),
      json: Boolean(formats.json),
      jsonl: Boolean(formats.jsonl),
    }
    const selectedFormats = EXPORT_FORMAT_KEYS.filter((key) => normalized[key])
    return { ...normalized, selectedFormats }
  }

  normalizeSessionIds(sessionIds = []) {
    return Array.from(new Set(
      (Array.isArray(sessionIds) ? sessionIds : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ))
  }

  groupBySession(rows) {
    const grouped = new Map()
    for (const row of rows) {
      const sid = String(row.sessionId || '').trim()
      if (!grouped.has(sid)) grouped.set(sid, [])
      grouped.get(sid).push(row)
    }
    return grouped
  }

  buildMarkdown({ sessionIds, chats, summaries, profile, charNameById, generatedAt, includeScopes }) {
    const lines = []
    lines.push('# 木鱼桌宠数据导出')
    lines.push('')
    lines.push(`- 导出时间: ${toLocal(generatedAt)} (${toIso(generatedAt)})`)
    lines.push(`- 会话数量: ${sessionIds.length}`)
    if (includeScopes.chats) lines.push(`- 对话条数: ${chats.length}`)
    if (includeScopes.summaries) lines.push(`- 阶段记忆摘要（中期）条数: ${summaries.length}`)
    lines.push('')

    if (includeScopes.profile) {
      lines.push('## 用户档案快照')
      lines.push('- 说明：本区即“长期记忆”，来源于 user_profile 稳定字段。')
      const profileEntries = Object.entries(profile || {}).filter(([, value]) => String(value || '').trim())
      if (profileEntries.length === 0) {
        lines.push('- （空）')
      } else {
        profileEntries.forEach(([key, value]) => {
          lines.push(`- ${key}: ${String(value || '').trim()}`)
        })
      }
      lines.push('')
    }

    if (!includeScopes.chats && !includeScopes.summaries) {
      return lines.join('\n')
    }

    const chatBySession = this.groupBySession(chats)
    const summaryBySession = this.groupBySession(summaries)
    if (sessionIds.length === 0) {
      lines.push('## 会话')
      lines.push('- （无会话数据）')
      lines.push('')
      return lines.join('\n')
    }

    sessionIds.forEach((sessionId) => {
      const { sid, charId, charName } = getSessionMeta(sessionId, charNameById)

      lines.push(`## 会话: ${sid}`)
      if (charId) {
        lines.push(`- 角色: ${charName} (${charId})`)
      }
      lines.push('')

      if (includeScopes.chats) {
        const sessionChats = chatBySession.get(sid) || []
        lines.push('### 对话记录')
        if (sessionChats.length === 0) {
          lines.push('- （空）')
        } else {
          sessionChats.forEach((item) => {
            lines.push(`- [${toLocal(item.ts)}] ${item.role}: ${item.content}`)
          })
        }
        lines.push('')
      }

      if (includeScopes.summaries) {
        const sessionSummaries = summaryBySession.get(sid) || []
        lines.push('### 阶段记忆摘要（中期）')
        lines.push('- 说明：该区为对话阶段性沉淀，不等同于长期档案。')
        if (sessionSummaries.length === 0) {
          lines.push('- （空）')
        } else {
          sessionSummaries.forEach((item, idx) => {
            lines.push(`${idx + 1}. [${toLocal(item.ts)}] ${item.summary}`)
          })
        }
        lines.push('')
      }
    })

    return lines.join('\n')
  }

  buildJsonl({ sessionIds, chats, summaries, profile, charNameById, generatedAt, includeScopes }) {
    const rows = []

    if (includeScopes.profile) {
      rows.push({
        type: 'profile_snapshot',
        session_id: '__global__',
        role: '',
        content: JSON.stringify(profile || {}),
        ts: generatedAt,
        iso_time: toIso(generatedAt),
        char_id: '',
        char_name: '',
      })
    }

    const allowedSessions = new Set(sessionIds)

    if (includeScopes.chats) {
      chats.forEach((item) => {
        const { sid, charId, charName } = getSessionMeta(item.sessionId, charNameById)
        if (!allowedSessions.has(sid)) return
        rows.push({
          type: 'chat',
          session_id: sid,
          role: item.role,
          content: item.content,
          ts: item.ts,
          iso_time: toIso(item.ts),
          char_id: charId,
          char_name: charName,
        })
      })
    }

    if (includeScopes.summaries) {
      summaries.forEach((item) => {
        const { sid, charId, charName } = getSessionMeta(item.sessionId, charNameById)
        if (!allowedSessions.has(sid)) return
        const structured = parseJsonObject(item.structuredJson)
        rows.push({
          type: 'summary',
          session_id: sid,
          role: 'system',
          content: item.summary,
          structured,
          ts: item.ts,
          iso_time: toIso(item.ts),
          char_id: charId,
          char_name: charName,
        })
      })
    }

    if (rows.length === 0) return ''
    return rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  }

  buildJson({ sessionIds, chats, summaries, profile, charNameById, generatedAt, includeScopes }) {
    const chatBySession = this.groupBySession(chats)
    const summaryBySession = this.groupBySession(summaries)

    const result = {
      meta: {
        generated_at: generatedAt,
        generated_at_iso: toIso(generatedAt),
        session_count: sessionIds.length,
        ...(includeScopes.chats ? { chat_count: chats.length } : {}),
        ...(includeScopes.summaries ? { summary_count: summaries.length } : {}),
      },
    }

    if (includeScopes.profile) {
      result.meta.memory_definition = {
        ...(result.meta.memory_definition || {}),
        long_term: 'user_profile（稳定档案字段）',
      }
      result.profile = profile || {}
    }

    if (includeScopes.summaries) {
      result.meta.memory_definition = {
        ...(result.meta.memory_definition || {}),
        staged_summary: 'memory_summaries（阶段记忆摘要/中期）',
      }
    }

    if (includeScopes.chats || includeScopes.summaries) {
      result.sessions = sessionIds.map((sessionId) => {
        const { sid, charId, charName } = getSessionMeta(sessionId, charNameById)
        const session = {
          session_id: sid,
          char_id: charId,
          char_name: charName,
        }
        if (includeScopes.chats) {
          session.chats = (chatBySession.get(sid) || []).map((item) => ({
            id: item.id,
            role: item.role,
            content: item.content,
            ts: item.ts,
            iso_time: toIso(item.ts),
          }))
        }
        if (includeScopes.summaries) {
          session.summaries = (summaryBySession.get(sid) || []).map((item) => ({
            id: item.id,
            summary_text: item.summary,
            structured: parseJsonObject(item.structuredJson),
            from_msg_id: item.fromMsgId,
            to_msg_id: item.toMsgId,
            ts: item.ts,
            iso_time: toIso(item.ts),
          }))
        }
        return session
      })
    }

    return result
  }

  writeExportFiles({ targetDir, baseName, markdown, json, jsonl, formats }) {
    let markdownPath = ''
    let jsonPath = ''
    let jsonlPath = ''
    const written = []

    try {
      if (formats.markdown) {
        markdownPath = path.join(targetDir, `${baseName}.md`)
        fs.writeFileSync(markdownPath, markdown, 'utf8')
        written.push(markdownPath)
      }
      if (formats.json) {
        jsonPath = path.join(targetDir, `${baseName}.json`)
        fs.writeFileSync(jsonPath, json, 'utf8')
        written.push(jsonPath)
      }
      if (formats.jsonl) {
        jsonlPath = path.join(targetDir, `${baseName}.jsonl`)
        fs.writeFileSync(jsonlPath, jsonl, 'utf8')
        written.push(jsonlPath)
      }
    } catch (err) {
      log.error('[export]', err)
      written.forEach((fp) => {
        try { fs.unlinkSync(fp) } catch {}
      })
      throw err
    }

    return { markdownPath, jsonPath, jsonlPath }
  }

  buildExportItem({
    targetDir,
    sessionIds,
    baseNameHint = '',
    includeScopes,
    formats,
  }) {
    const normalizedSessionIds = this.normalizeSessionIds(sessionIds)
    const allChats = this.db.getChatMessagesBySessionIds(normalizedSessionIds)
    const allSummaries = this.db.getMemorySummariesBySessionIds(normalizedSessionIds)
    const allProfile = this.db.getUserProfile()
    const chats = includeScopes.chats ? allChats : []
    const summaries = includeScopes.summaries ? allSummaries : []
    const profile = includeScopes.profile ? allProfile : null
    const characters = this.db.listCharacters()
    const charNameById = new Map(characters.map((item) => [item.id, item.name]))

    const generatedAt = Date.now()
    const timestamp = formatTimestampForFile(generatedAt)
    const suffix = sanitizeFilePart(baseNameHint)
    const baseName = suffix
      ? `muyu-export-${suffix}-${timestamp}`
      : `muyu-export-${timestamp}`

    const markdown = formats.markdown
      ? this.buildMarkdown({
        sessionIds: normalizedSessionIds,
        chats,
        summaries,
        profile,
        charNameById,
        generatedAt,
        includeScopes,
      })
      : ''

    const jsonl = formats.jsonl
      ? this.buildJsonl({
        sessionIds: normalizedSessionIds,
        chats,
        summaries,
        profile,
        charNameById,
        generatedAt,
        includeScopes,
      })
      : ''

    const json = formats.json
      ? `${JSON.stringify(this.buildJson({
        sessionIds: normalizedSessionIds,
        chats,
        summaries,
        profile,
        charNameById,
        generatedAt,
        includeScopes,
      }), null, 2)}\n`
      : ''

    const { markdownPath, jsonPath, jsonlPath } = this.writeExportFiles({
      targetDir,
      baseName,
      markdown,
      json,
      jsonl,
      formats,
    })

    const session = normalizedSessionIds[0] || ''
    const { charId, charName } = getSessionMeta(session, charNameById)

    return {
      baseName,
      markdownPath,
      jsonPath,
      jsonlPath,
      sessionIds: normalizedSessionIds,
      sessionId: session,
      charId,
      charName,
      sessionCount: normalizedSessionIds.length,
      chatCount: chats.length,
      summaryCount: summaries.length,
    }
  }

  resolveRoleSessionIdsForSplit() {
    const defaultSessionId = String(this.db.DEFAULT_SESSION_ID || '').trim()
    const existingSessionIds = this.normalizeSessionIds(this.db.listAllSessionIds())
    const roleSessionByChar = this.db.listCharacters().map((item) => `pet_${item.id}`)
    const roleSessionByExisting = existingSessionIds.filter((sid) => sid.startsWith('pet_'))

    return this.normalizeSessionIds(roleSessionByChar.concat(roleSessionByExisting))
      .filter((sid) => sid !== defaultSessionId)
  }

  buildResultMeta(exportType, items = [], selectedScopes = [], selectedFormats = []) {
    const sessionCount = items.reduce((acc, item) => acc + (Number(item.sessionCount) || 0), 0)
    const chatCount = items.reduce((acc, item) => acc + (Number(item.chatCount) || 0), 0)
    const summaryCount = items.reduce((acc, item) => acc + (Number(item.summaryCount) || 0), 0)
    const fileCount = items.reduce((acc, item) => (
      acc
      + (item.markdownPath ? 1 : 0)
      + (item.jsonPath ? 1 : 0)
      + (item.jsonlPath ? 1 : 0)
    ), 0)

    const first = items[0] || {}
    return {
      exportType,
      items,
      fileCount,
      sessionCount,
      chatCount,
      summaryCount,
      baseName: first.baseName || '',
      markdownPath: first.markdownPath || '',
      jsonPath: first.jsonPath || '',
      jsonlPath: first.jsonlPath || '',
      selectedScopes,
      selectedFormats,
    }
  }

  exportToDirectory({
    mode = 'all',
    allStrategy = 'merged',
    roleSessionId = '',
    includeScopes,
    formats,
    dirPath,
  }) {
    const targetDir = String(dirPath || '').trim()
    if (!targetDir) {
      throw new Error('导出目录不能为空')
    }
    fs.mkdirSync(targetDir, { recursive: true })
    const normalizedScopes = this.normalizeIncludeScopes(includeScopes)
    const normalizedFormats = this.normalizeFormats(formats)

    if (normalizedScopes.selectedScopes.length === 0) {
      throw new Error('请至少选择一项导出内容')
    }
    if (normalizedFormats.selectedFormats.length === 0) {
      throw new Error('请至少选择一种导出格式')
    }

    const safeMode = String(mode || 'all').trim()
    if (safeMode === 'role') {
      const sid = String(roleSessionId || '').trim()
      if (!sid) throw new Error('请选择要导出的角色会话')
      const item = this.buildExportItem({
        targetDir,
        sessionIds: [sid],
        baseNameHint: inferCharIdFromSessionId(sid) || sid,
        includeScopes: normalizedScopes,
        formats: normalizedFormats,
      })
      return this.buildResultMeta('role', [item], normalizedScopes.selectedScopes, normalizedFormats.selectedFormats)
    }

    // 产品规则：导出全部固定按角色拆分，allStrategy 仅保留兼容参数。
    const roleSessionIds = this.resolveRoleSessionIdsForSplit()
    const items = roleSessionIds.map((sid) => this.buildExportItem({
      targetDir,
      sessionIds: [sid],
      baseNameHint: inferCharIdFromSessionId(sid) || sid,
      includeScopes: normalizedScopes,
      formats: normalizedFormats,
    }))
    return this.buildResultMeta('all_split_by_role', items, normalizedScopes.selectedScopes, normalizedFormats.selectedFormats)
  }
}

module.exports = ExportService
