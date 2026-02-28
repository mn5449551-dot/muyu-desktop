export const MEMORY_STRUCTURED_KEYS = Object.freeze([
  'facts',
  'preferences',
  'goals',
  'constraints',
  'todos',
  'risks',
])

export function parseStructuredMemory(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  const raw = String(value || '').trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function parseMemoryListResponse(response) {
  if (Array.isArray(response)) {
    return {
      items: response,
      total: response.length,
      limit: response.length,
      offset: 0,
      hasMore: false,
    }
  }

  return {
    items: Array.isArray(response?.items) ? response.items : [],
    total: Number(response?.total || 0),
    limit: Number(response?.limit || 0),
    offset: Number(response?.offset || 0),
    hasMore: Boolean(response?.hasMore),
  }
}
