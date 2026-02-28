import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { mergeCharacters } from '../../utils/characters'
import {
  MEMORY_STRUCTURED_KEYS,
  parseMemoryListResponse,
  parseStructuredMemory,
} from './memory-view-utils'
import '../styles/memory-window.css'

const PAGE_SIZE = 20
const RANGE_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
]

function getSearchParam(name, fallback = '') {
  const search = new URLSearchParams(window.location.search)
  const value = String(search.get(name) || '').trim()
  return value || fallback
}

function resolveMemoryRangeCutoff(range) {
  const now = Date.now()
  if (range === '7d') return now - 7 * 24 * 60 * 60 * 1000
  if (range === '30d') return now - 30 * 24 * 60 * 60 * 1000
  if (range === '90d') return now - 90 * 24 * 60 * 60 * 1000
  return 0
}

function getErrorMessage(error) {
  return error?.message || String(error)
}

export default function MemoryWindowView() {
  const initialSessionId = useMemo(() => getSearchParam('sessionId', ''), [])
  const initialKeyword = useMemo(() => getSearchParam('keyword', ''), [])
  const initialRangeRaw = useMemo(() => getSearchParam('range', 'all'), [])
  const initialRange = useMemo(() => {
    return RANGE_OPTIONS.some((item) => item.value === initialRangeRaw) ? initialRangeRaw : 'all'
  }, [initialRangeRaw])

  const [memoryRoles, setMemoryRoles] = useState([])
  const [memSessionId, setMemSessionId] = useState(initialSessionId)
  const [memorySearch, setMemorySearch] = useState(initialKeyword)
  const [memoryRange, setMemoryRange] = useState(initialRange)
  const [memories, setMemories] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')

  const selectedRoleId = useMemo(() => {
    const sid = String(memSessionId || '').trim()
    return sid.startsWith('pet_') ? sid.slice(4) : ''
  }, [memSessionId])

  const totalPages = useMemo(() => {
    if (!total) return 1
    return Math.max(1, Math.ceil(total / PAGE_SIZE))
  }, [total])

  const loadMemories = useCallback(async ({
    sessionId,
    page: targetPage = 1,
    keyword = '',
    range = 'all',
  }) => {
    const sid = String(sessionId || '').trim()
    if (!sid) {
      setMemories([])
      setTotal(0)
      setPage(1)
      setLoading(false)
      return
    }

    const nextPage = Math.max(1, Number.parseInt(String(targetPage || 1), 10) || 1)
    const offset = (nextPage - 1) * PAGE_SIZE
    const fromTs = resolveMemoryRangeCutoff(range)

    try {
      const response = await window.electronAPI.listMemories({
        sessionId: sid,
        limit: PAGE_SIZE,
        offset,
        keyword: String(keyword || '').trim(),
        fromTs: fromTs > 0 ? fromTs : undefined,
      })
      const parsed = parseMemoryListResponse(response)
      const items = parsed.items.map((item) => ({
        ...item,
        structured: parseStructuredMemory(item?.structured || item?.structuredJson),
      }))
      setMemories(items)
      setTotal(parsed.total)
      setPage(nextPage)
      setStatus('')
    } catch (error) {
      setStatus(`读取完整记忆失败：${getErrorMessage(error)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const requestMemories = useCallback((overrides = {}) => {
    setLoading(true)
    return loadMemories({
      sessionId: memSessionId,
      page,
      keyword: memorySearch,
      range: memoryRange,
      ...overrides,
    })
  }, [loadMemories, memSessionId, memoryRange, memorySearch, page])

  useEffect(() => {
    let canceled = false
    async function init() {
      try {
        const rows = await window.electronAPI.listCharacters()
        if (canceled) return
        const roles = mergeCharacters(rows).filter((item) => item.isActive)
        setMemoryRoles(roles)

        const preferredRole = roles.find((item) => `pet_${item.id}` === initialSessionId)
        const nextSessionId = preferredRole
          ? `pet_${preferredRole.id}`
          : (roles[0] ? `pet_${roles[0].id}` : '')

        setMemSessionId(nextSessionId)
        if (nextSessionId) {
          await loadMemories({
            sessionId: nextSessionId,
            page: 1,
            keyword: initialKeyword,
            range: initialRange,
          })
        } else {
          setLoading(false)
        }
      } catch (error) {
        if (canceled) return
        setLoading(false)
        setStatus(`初始化失败：${getErrorMessage(error)}`)
      }
    }
    init()
    return () => {
      canceled = true
    }
  }, [initialKeyword, initialRange, initialSessionId, loadMemories])

  const applyFilter = () => {
    requestMemories({ page: 1 })
  }

  const handleDeleteMemory = async (id) => {
    if (!window.confirm('确认删除这条记忆吗？删除后将不再用于对话，且无法恢复。')) return
    try {
      await window.electronAPI.deleteMemory(id)
      const nextTotal = Math.max(0, total - 1)
      const nextTotalPages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE))
      const nextPage = Math.min(page, nextTotalPages)
      await requestMemories({
        page: nextPage,
      })
      setStatus('记忆已删除')
    } catch (error) {
      setStatus(`删除记忆失败：${getErrorMessage(error)}`)
    }
  }

  return (
    <div className="memory-window-root">
      <header className="memory-window-head">
        <div>
          <h1>完整记忆列表</h1>
          <p>按角色查看中期记忆摘要，支持筛选、分页与删除。</p>
        </div>
        <button className="memory-btn" onClick={() => window.close()}>关闭窗口</button>
      </header>

      {status && <div className="memory-status">{status}</div>}

      <section className="memory-panel">
        {memoryRoles.length === 0 ? (
          <p className="memory-empty">暂无可查看的启用角色</p>
        ) : (
          <div className="memory-role-tabs">
            {memoryRoles.map((role) => (
              <button
                key={role.id}
                className={`memory-role-tab${selectedRoleId === role.id ? ' is-active' : ''}`}
                onClick={() => {
                  const sid = `pet_${role.id}`
                  setMemSessionId(sid)
                  requestMemories({
                    sessionId: sid,
                    page: 1,
                  })
                }}
              >
                {role.name}
              </button>
            ))}
          </div>
        )}

        <div className="memory-filter-row">
          <input
            className="memory-search"
            placeholder="搜索摘要关键词"
            value={memorySearch}
            onChange={(event) => setMemorySearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                applyFilter()
              }
            }}
          />
          <select value={memoryRange} onChange={(event) => setMemoryRange(event.target.value)}>
            {RANGE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <button className="memory-btn" onClick={applyFilter} disabled={!memSessionId}>应用筛选</button>
        </div>

        {loading ? (
          <p className="memory-empty">加载中...</p>
        ) : memories.length === 0 ? (
          <p className="memory-empty">暂无符合条件的记录</p>
        ) : (
          <div className="memory-list">
            {memories.map((item) => (
              <article key={item.id} className="memory-item">
                <span className="memory-ts">{new Date(item.ts).toLocaleString('zh-CN')}</span>
                <p className="memory-text">{item.summary}</p>
                {item.structured && (
                  <div className="memory-structured">
                    {MEMORY_STRUCTURED_KEYS.map((key) => {
                      const list = Array.isArray(item.structured?.[key]) ? item.structured[key].filter(Boolean) : []
                      if (list.length === 0) return null
                      return (
                        <div key={`${item.id}_${key}`} className="memory-structured-row">
                          <strong>{key}</strong>
                          <span>{list.join(' / ')}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                <button
                  className="memory-btn memory-btn--danger"
                  onClick={() => handleDeleteMemory(item.id)}
                >
                  删除
                </button>
              </article>
            ))}
          </div>
        )}

        <footer className="memory-pagination">
          <button
            className="memory-btn"
            onClick={() => {
              requestMemories({ page: page - 1 })
            }}
            disabled={page <= 1 || !memSessionId || loading}
          >
            上一页
          </button>
          <span className="memory-page-hint">第 {page}/{totalPages} 页 · 共 {total} 条</span>
          <button
            className="memory-btn"
            onClick={() => {
              requestMemories({ page: page + 1 })
            }}
            disabled={page >= totalPages || !memSessionId || loading}
          >
            下一页
          </button>
        </footer>
      </section>
    </div>
  )
}
