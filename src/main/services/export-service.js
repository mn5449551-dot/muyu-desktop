const fs = require('fs')
const path = require('path')
const log = require('../logger')

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

class ExportService {
  constructor(db) {
    this.db = db
  }

  resolveSessionIds(scope) {
    if (scope === 'default') return ['default']

    if (scope === 'current') {
      const state = this.db.getState()
      const currentCharId = String(state?.currentCharId || '').trim()
      const safeId = currentCharId || 'muyu'
      return [`pet_${safeId}`]
    }

    return this.db.listAllSessionIds()
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

  buildMarkdown({ sessionIds, chats, summaries, profile, charNameById, generatedAt }) {
    const lines = []
    lines.push('# 木鱼桌宠数据导出')
    lines.push('')
    lines.push(`- 导出时间: ${toLocal(generatedAt)} (${toIso(generatedAt)})`)
    lines.push(`- 会话数量: ${sessionIds.length}`)
    lines.push(`- 对话条数: ${chats.length}`)
    lines.push(`- 记忆摘要条数: ${summaries.length}`)
    lines.push('')

    lines.push('## 用户档案快照')
    const profileEntries = Object.entries(profile || {}).filter(([, value]) => String(value || '').trim())
    if (profileEntries.length === 0) {
      lines.push('- （空）')
    } else {
      profileEntries.forEach(([key, value]) => {
        lines.push(`- ${key}: ${String(value || '').trim()}`)
      })
    }
    lines.push('')

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

      const sessionSummaries = summaryBySession.get(sid) || []
      lines.push('### 长期记忆摘要')
      if (sessionSummaries.length === 0) {
        lines.push('- （空）')
      } else {
        sessionSummaries.forEach((item, idx) => {
          lines.push(`${idx + 1}. [${toLocal(item.ts)}] ${item.summary}`)
        })
      }
      lines.push('')
    })

    return lines.join('\n')
  }

  buildJsonl({ sessionIds, chats, summaries, profile, charNameById, generatedAt }) {
    const rows = []

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

    const allowedSessions = new Set(sessionIds)

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

    summaries.forEach((item) => {
      const { sid, charId, charName } = getSessionMeta(item.sessionId, charNameById)
      if (!allowedSessions.has(sid)) return
      rows.push({
        type: 'summary',
        session_id: sid,
        role: 'system',
        content: item.summary,
        ts: item.ts,
        iso_time: toIso(item.ts),
        char_id: charId,
        char_name: charName,
      })
    })

    return rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  }

  exportToDirectory({ scope = 'all', dirPath }) {
    const targetDir = String(dirPath || '').trim()
    if (!targetDir) {
      throw new Error('导出目录不能为空')
    }

    fs.mkdirSync(targetDir, { recursive: true })

    const sessionIds = this.resolveSessionIds(scope)
    const chats = this.db.getChatMessagesBySessionIds(sessionIds)
    const summaries = this.db.getMemorySummariesBySessionIds(sessionIds)
    const profile = this.db.getUserProfile()
    const characters = this.db.listCharacters()
    const charNameById = new Map(characters.map((item) => [item.id, item.name]))

    const generatedAt = Date.now()
    const timestamp = formatTimestampForFile(generatedAt)
    const baseName = `muyu-export-${timestamp}`

    const markdown = this.buildMarkdown({
      sessionIds,
      chats,
      summaries,
      profile,
      charNameById,
      generatedAt,
    })

    const jsonl = this.buildJsonl({
      sessionIds,
      chats,
      summaries,
      profile,
      charNameById,
      generatedAt,
    })

    const markdownPath = path.join(targetDir, `${baseName}.md`)
    const jsonlPath = path.join(targetDir, `${baseName}.jsonl`)

    const written = []
    try {
      fs.writeFileSync(markdownPath, markdown, 'utf8')
      written.push(markdownPath)
      fs.writeFileSync(jsonlPath, jsonl, 'utf8')
      written.push(jsonlPath)
    } catch (err) {
      log.error('[export]', err)
      written.forEach((fp) => {
        try { fs.unlinkSync(fp) } catch {}
      })
      throw err
    }

    return {
      baseName,
      markdownPath,
      jsonlPath,
      scope,
      sessionCount: sessionIds.length,
      chatCount: chats.length,
      summaryCount: summaries.length,
    }
  }
}

module.exports = ExportService
