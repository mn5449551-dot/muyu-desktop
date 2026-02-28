import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mergeCharacters } from '../../utils/characters'
import RoleCardGrid from './RoleCardGrid'
import RoleEditorModal from './RoleEditorModal'
import {
  DEFAULT_ASR_FILE_RESOURCE_ID,
  DEFAULT_ASR_MODE,
  DEFAULT_ASR_STREAM_RESOURCE_ID,
  DEFAULT_ASR_STREAM_URL,
  PET_SCALE_MAX,
  PET_SCALE_MIN,
  buildLlmConfigSavePayload,
  buildVoiceConfigSavePayload,
  buildLlmTestPayload,
  buildSettingsConfig,
  buildVoiceTestPayload,
  clampPetScale,
  normalizeAsrMode,
  normalizeAsrResourceIdByMode,
  parseRareAudioPool,
  toCharacterForm,
} from './settings-config-utils'
import {
  MEMORY_STRUCTURED_KEYS,
  parseMemoryListResponse,
  parseStructuredMemory,
} from './memory-view-utils'
import '../styles/settings.css'

const PET_SCALE_STEP = 0.01
const RECENT_MEMORY_LIMIT = 5
const MEMORY_ROLE_ALL = '__all__'
const EXPORT_SCOPE_KEYS = ['chats', 'summaries', 'profile']
const EXPORT_SCOPE_LABELS = {
  chats: '聊天历史',
  summaries: '阶段摘要',
  profile: '用户档案',
}
const EXPORT_FORMAT_KEYS = ['markdown', 'json', 'jsonl']
const EXPORT_FORMAT_LABELS = {
  markdown: 'Markdown',
  json: 'JSON',
  jsonl: 'JSONL',
}

function clampUiScalePosition(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 50
  return Math.max(0, Math.min(100, n))
}

function scaleToUiScalePosition(scale) {
  const s = clampPetScale(scale)
  if (s <= 1) {
    return ((s - PET_SCALE_MIN) / (1 - PET_SCALE_MIN)) * 50
  }
  return 50 + ((s - 1) / (PET_SCALE_MAX - 1)) * 50
}

function uiScalePositionToScale(position) {
  const p = clampUiScalePosition(position)
  if (p <= 50) {
    return clampPetScale(PET_SCALE_MIN + (p / 50) * (1 - PET_SCALE_MIN))
  }
  return clampPetScale(1 + ((p - 50) / 50) * (PET_SCALE_MAX - 1))
}

function isDraftEqual(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {})
}

function getErrorMessage(error) {
  return error?.message || String(error)
}

function pickLlmConfig(config = {}) {
  return {
    baseUrl: String(config.baseUrl || '').trim(),
    model: String(config.model || '').trim(),
    temperature: Number(config.temperature),
    maxContext: Number(config.maxContext),
    apiKeyConfigured: Boolean(config.apiKeyConfigured),
  }
}

function pickVoiceConfig(config = {}) {
  const asrMode = normalizeAsrMode(config.voiceAsrMode, config.voiceAsrResourceId)
  return {
    voiceRegion: String(config.voiceRegion || '').trim(),
    voiceAppId: String(config.voiceAppId || '').trim(),
    voiceAsrMode: asrMode,
    voiceAsrResourceId: normalizeAsrResourceIdByMode(asrMode, config.voiceAsrResourceId),
    voiceAsrStreamUrl: String(config.voiceAsrStreamUrl || '').trim() || DEFAULT_ASR_STREAM_URL,
    voiceAsrUploadEndpoint: String(config.voiceAsrUploadEndpoint || '').trim(),
    voiceTtsResourceId: String(config.voiceTtsResourceId || '').trim(),
    voiceTtsFormat: String(config.voiceTtsFormat || '').trim().toLowerCase(),
    voiceTtsSampleRate: Number(config.voiceTtsSampleRate),
    voiceAccessKeyConfigured: Boolean(config.voiceAccessKeyConfigured),
  }
}

export default function SettingsView() {
  const [characters, setCharacters] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [editorOpen, setEditorOpen] = useState(false)
  const [editorDraft, setEditorDraft] = useState(null)
  const [editorOriginal, setEditorOriginal] = useState(null)
  const [savingRole, setSavingRole] = useState(false)

  const [config, setConfig] = useState({
    baseUrl: '',
    model: '',
    temperature: 0.7,
    maxContext: 20,
    apiKey: '',
    apiKeyConfigured: false,
    encryptionAvailable: false,
    voiceRegion: 'cn-beijing',
    voiceAppId: '',
    voiceAccessKey: '',
    voiceAccessKeyConfigured: false,
    voiceAsrMode: DEFAULT_ASR_MODE,
    voiceAsrResourceId: '',
    voiceAsrStreamUrl: DEFAULT_ASR_STREAM_URL,
    voiceAsrUploadEndpoint: '',
    voiceTtsResourceId: '',
    voiceTtsFormat: 'mp3',
    voiceTtsSampleRate: 24000,
    voiceEncryptionAvailable: false,
  })
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const [voiceAccessKeyDirty, setVoiceAccessKeyDirty] = useState(false)
  const [savedConfig, setSavedConfig] = useState(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionState, setConnectionState] = useState({ kind: 'idle', message: '' })
  const [testingVoiceConnection, setTestingVoiceConnection] = useState(false)
  const [voiceConnectionState, setVoiceConnectionState] = useState({ kind: 'idle', message: '' })
  const [savingLlmConfig, setSavingLlmConfig] = useState(false)
  const [savingVoiceConfig, setSavingVoiceConfig] = useState(false)
  const [llmSaveState, setLlmSaveState] = useState({ kind: 'idle', message: '' })
  const [voiceSaveState, setVoiceSaveState] = useState({ kind: 'idle', message: '' })

  const [profile, setProfile] = useState({
    name: '',
    occupation: '',
    birthday: '',
    birthday_year: '',
    traits: '',
    notes: '',
  })
  const [savedProfile, setSavedProfile] = useState({
    name: '',
    occupation: '',
    birthday: '',
    birthday_year: '',
    traits: '',
    notes: '',
  })

  const [status, setStatus] = useState('')
  const [petScale, setPetScale] = useState(1)
  const [exportingDocs, setExportingDocs] = useState(false)
  const [exportScopes, setExportScopes] = useState({
    all: true,
    chats: true,
    summaries: true,
    profile: true,
  })
  const [exportFormats, setExportFormats] = useState({
    markdown: true,
    json: false,
    jsonl: false,
  })
  const [exportOptionsExpanded, setExportOptionsExpanded] = useState(false)
  const [exportRoleId, setExportRoleId] = useState(MEMORY_ROLE_ALL)
  const [loading, setLoading] = useState(true)
  const [recentMemories, setRecentMemories] = useState([])
  const [recentMemoryTotal, setRecentMemoryTotal] = useState(0)
  const [memSessionId, setMemSessionId] = useState('')
  const [activeSection, setActiveSection] = useState('quickstart')

  const quickStartRef = useRef(null)
  const rolesRef = useRef(null)
  const memoryRef = useRef(null)

  const resetConnectionState = () => {
    setConnectionState({ kind: 'idle', message: '' })
    setVoiceConnectionState({ kind: 'idle', message: '' })
  }

  const setErrorStatus = useCallback((prefix, error) => {
    setStatus(`${prefix}: ${getErrorMessage(error)}`)
  }, [])

  const jumpToSection = useCallback((sectionKey) => {
    setActiveSection(sectionKey)
    const map = {
      quickstart: quickStartRef.current,
      roles: rolesRef.current,
      memory: memoryRef.current,
    }
    const node = map[sectionKey]
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const updateConfigField = (patch) => {
    setConfig((prev) => ({ ...prev, ...patch }))
    resetConnectionState()
    setLlmSaveState({ kind: 'idle', message: '' })
    setVoiceSaveState({ kind: 'idle', message: '' })
  }

  const loadAll = useCallback(async (preferredId = null) => {
    const [rows, appConfig, userProfile, petUiPrefs] = await Promise.all([
      window.electronAPI.listCharacters(),
      window.electronAPI.getAppConfig(),
      window.electronAPI.getProfile(),
      window.electronAPI.getPetUiPrefs(),
    ])

    const merged = mergeCharacters(rows)
    setCharacters(merged)

    const keepId = preferredId || selectedId
    const fallback = merged.find((item) => item.id === keepId) || merged[0] || null
    setSelectedId(fallback ? fallback.id : '')

    const normalizedConfig = buildSettingsConfig(appConfig)
    setConfig(normalizedConfig)
    setSavedConfig(normalizedConfig)

    setApiKeyDirty(false)
    setVoiceAccessKeyDirty(false)
    resetConnectionState()
    setLlmSaveState({ kind: 'idle', message: '' })
    setVoiceSaveState({ kind: 'idle', message: '' })

    const normalizedProfile = {
      name: String(userProfile?.name || ''),
      occupation: String(userProfile?.occupation || ''),
      birthday: String(userProfile?.birthday || ''),
      birthday_year: String(userProfile?.birthday_year || ''),
      traits: String(userProfile?.traits || ''),
      notes: String(userProfile?.notes || ''),
    }
    setProfile(normalizedProfile)
    setSavedProfile(normalizedProfile)
    setPetScale(clampPetScale(petUiPrefs?.scale))

    const memoryFallback = merged.find((item) => item.isActive) || fallback
    const initSessionId = memoryFallback ? `pet_${memoryFallback.id}` : ''
    setMemSessionId(initSessionId)
    setExportRoleId(memoryFallback ? memoryFallback.id : MEMORY_ROLE_ALL)

    try {
      if (initSessionId) {
        const response = await window.electronAPI.listMemories({
          sessionId: initSessionId,
          limit: RECENT_MEMORY_LIMIT,
          offset: 0,
        })
        const parsed = parseMemoryListResponse(response)
        setRecentMemories(parsed.items.map((item) => ({
          ...item,
          structured: parseStructuredMemory(item?.structured || item?.structuredJson),
        })))
        setRecentMemoryTotal(parsed.total)
      } else {
        setRecentMemories([])
        setRecentMemoryTotal(0)
      }
    } catch (error) {
      setRecentMemories([])
      setRecentMemoryTotal(0)
      setStatus(`记忆列表读取失败：${getErrorMessage(error)}`)
    }
  }, [selectedId])

  useEffect(() => {
    loadAll().finally(() => setLoading(false))

    const unsub = window.electronAPI.onCharactersUpdated((rows) => {
      const merged = mergeCharacters(rows)
      setCharacters(merged)
      if (!selectedId && merged[0]) {
        setSelectedId(merged[0].id)
      }
    })

    return () => unsub()
  }, [loadAll, selectedId])

  const filteredCharacters = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    if (!keyword) return characters

    return characters.filter((item) => {
      const text = `${item.name} ${item.id}`.toLowerCase()
      return text.includes(keyword)
    })
  }, [characters, searchQuery])

  const memoryRoles = useMemo(() => {
    return characters.filter((item) => item.isActive)
  }, [characters])

  const selectedMemoryRoleId = useMemo(() => {
    const sid = String(memSessionId || '').trim()
    return sid.startsWith('pet_') ? sid.slice(4) : ''
  }, [memSessionId])

  const selectedMemoryRole = useMemo(() => {
    return memoryRoles.find((item) => item.id === selectedMemoryRoleId) || null
  }, [memoryRoles, selectedMemoryRoleId])

  const selectedExportRole = useMemo(() => {
    if (exportRoleId === MEMORY_ROLE_ALL) return null
    return memoryRoles.find((item) => item.id === exportRoleId) || null
  }, [memoryRoles, exportRoleId])

  const selectedScopeCount = useMemo(() => {
    return EXPORT_SCOPE_KEYS.filter((key) => Boolean(exportScopes[key])).length
  }, [exportScopes])

  const selectedFormatCount = useMemo(() => {
    return EXPORT_FORMAT_KEYS.filter((key) => Boolean(exportFormats[key])).length
  }, [exportFormats])

  const editorDirty = useMemo(() => {
    return !isDraftEqual(editorDraft, editorOriginal)
  }, [editorDraft, editorOriginal])

  const llmDirty = useMemo(() => {
    if (apiKeyDirty) return true
    if (!savedConfig) return false
    return !isDraftEqual(pickLlmConfig(config), pickLlmConfig(savedConfig))
  }, [apiKeyDirty, config, savedConfig])

  const voiceDirty = useMemo(() => {
    if (voiceAccessKeyDirty) return true
    if (!savedConfig) return false
    return !isDraftEqual(pickVoiceConfig(config), pickVoiceConfig(savedConfig))
  }, [config, savedConfig, voiceAccessKeyDirty])

  const profileDirty = useMemo(() => {
    return !isDraftEqual(profile, savedProfile)
  }, [profile, savedProfile])

  const openEditor = (id) => {
    const target = characters.find((item) => item.id === id)
    if (!target) return

    const draft = toCharacterForm(target, characters.length)
    setSelectedId(id)
    setEditorOriginal(draft)
    setEditorDraft(draft)
    setEditorOpen(true)
  }

  const closeEditor = () => {
    if (editorDirty) {
      const shouldDiscard = window.confirm('当前有未保存修改，确认放弃吗？')
      if (!shouldDiscard) return
    }

    setEditorOpen(false)
    setEditorDraft(null)
    setEditorOriginal(null)
  }

  const updateEditorField = (key, value) => {
    setEditorDraft((prev) => ({ ...prev, [key]: value }))
  }

  const importForField = async (fieldName, type) => {
    try {
      const roleId = editorDraft?.id || selectedId || 'custom'
      const result = await window.electronAPI.importAsset(type, roleId)
      if (!result) return
      updateEditorField(fieldName, result.fileUrl)
      setStatus(`已导入 ${result.fileName}`)
    } catch (error) {
      setErrorStatus('导入失败', error)
    }
  }

  const saveEditor = async () => {
    if (!editorDraft) return

    const prompt = String(editorDraft.chatSystemPrompt || '').trim()
    if (prompt.length < 20 || prompt.length > 1200) {
      setStatus('角色系统提示词长度需在 20 到 1200 字之间')
      return
    }

    try {
      setSavingRole(true)
      const rareAudioPool = parseRareAudioPool(editorDraft.rareAudioPoolText)

      const payload = {
        id: editorDraft.id,
        name: editorDraft.name,
        animationType: editorDraft.animationType,
        sortOrder: Number(editorDraft.sortOrder),
        isActive: Boolean(editorDraft.isActive),
        idleImg: editorDraft.idleImg,
        hitImg: editorDraft.hitImg,
        mainAudio: editorDraft.mainAudio,
        rareAudio: editorDraft.rareAudio,
        rareAudioPool,
        chatSystemPrompt: prompt,
        floatTextColor: editorDraft.floatTextColor,
        voiceType: editorDraft.voiceType,
        voiceEmotion: editorDraft.voiceEmotion,
        isCustom: editorDraft.isCustom,
      }

      await window.electronAPI.upsertCharacter(payload)
      await loadAll(payload.id)
      setStatus('角色已保存')
      setEditorOpen(false)
      setEditorDraft(null)
      setEditorOriginal(null)
    } catch (error) {
      setErrorStatus('保存角色失败', error)
    } finally {
      setSavingRole(false)
    }
  }

  const saveLlmConfig = async () => {
    try {
      setSavingLlmConfig(true)
      const payload = buildLlmConfigSavePayload(config, { apiKeyDirty })
      const nextConfig = await window.electronAPI.setAppConfig(payload)
      const nextSettings = buildSettingsConfig(nextConfig)

      setConfig((prev) => ({
        ...prev,
        baseUrl: nextSettings.baseUrl,
        model: nextSettings.model,
        temperature: nextSettings.temperature,
        maxContext: nextSettings.maxContext,
        apiKey: '',
        apiKeyConfigured: nextSettings.apiKeyConfigured,
        encryptionAvailable: nextSettings.encryptionAvailable,
      }))
      setSavedConfig((prev) => ({
        ...(prev || {}),
        ...pickLlmConfig(nextSettings),
      }))
      setApiKeyDirty(false)
      setConnectionState({ kind: 'idle', message: '' })
      setLlmSaveState({ kind: 'success', message: 'AI 配置已保存' })
    } catch (error) {
      setLlmSaveState({ kind: 'error', message: `保存失败：${getErrorMessage(error)}` })
    } finally {
      setSavingLlmConfig(false)
    }
  }

  const saveVoiceConfig = async () => {
    try {
      setSavingVoiceConfig(true)
      const payload = buildVoiceConfigSavePayload(config, { voiceAccessKeyDirty })
      const nextConfig = await window.electronAPI.setAppConfig(payload)
      const nextSettings = buildSettingsConfig(nextConfig)

      setConfig((prev) => ({
        ...prev,
        voiceRegion: nextSettings.voiceRegion,
        voiceAppId: nextSettings.voiceAppId,
        voiceAsrMode: nextSettings.voiceAsrMode,
        voiceAsrResourceId: nextSettings.voiceAsrResourceId,
        voiceAsrStreamUrl: nextSettings.voiceAsrStreamUrl,
        voiceAsrUploadEndpoint: nextSettings.voiceAsrUploadEndpoint,
        voiceTtsResourceId: nextSettings.voiceTtsResourceId,
        voiceTtsFormat: nextSettings.voiceTtsFormat,
        voiceTtsSampleRate: nextSettings.voiceTtsSampleRate,
        voiceAccessKey: '',
        voiceAccessKeyConfigured: nextSettings.voiceAccessKeyConfigured,
        voiceEncryptionAvailable: nextSettings.voiceEncryptionAvailable,
      }))
      setSavedConfig((prev) => ({
        ...(prev || {}),
        ...pickVoiceConfig(nextSettings),
      }))
      setVoiceAccessKeyDirty(false)
      setVoiceConnectionState({ kind: 'idle', message: '' })
      setVoiceSaveState({ kind: 'success', message: '语音配置已保存' })
    } catch (error) {
      setVoiceSaveState({ kind: 'error', message: `保存失败：${getErrorMessage(error)}` })
    } finally {
      setSavingVoiceConfig(false)
    }
  }

  const clearApiKey = async () => {
    try {
      const nextConfig = await window.electronAPI.setAppConfig({ llm: { apiKey: '' } })
      const nextSettings = buildSettingsConfig(nextConfig)
      setConfig((prev) => ({ ...prev, apiKey: '', apiKeyConfigured: nextSettings.apiKeyConfigured }))
      setSavedConfig((prev) => ({
        ...(prev || {}),
        apiKeyConfigured: nextSettings.apiKeyConfigured,
      }))
      setApiKeyDirty(false)
      resetConnectionState()
      setLlmSaveState({ kind: 'success', message: 'API Key 已清空' })
    } catch (error) {
      setLlmSaveState({ kind: 'error', message: `清空失败：${getErrorMessage(error)}` })
    }
  }

  const clearVoiceAccessKey = async () => {
    try {
      const nextConfig = await window.electronAPI.setAppConfig({ voice: { accessKey: '' } })
      const nextSettings = buildSettingsConfig(nextConfig)
      setConfig((prev) => ({
        ...prev,
        voiceAccessKey: '',
        voiceAccessKeyConfigured: nextSettings.voiceAccessKeyConfigured,
      }))
      setSavedConfig((prev) => ({
        ...(prev || {}),
        voiceAccessKeyConfigured: nextSettings.voiceAccessKeyConfigured,
      }))
      setVoiceAccessKeyDirty(false)
      setVoiceConnectionState({ kind: 'idle', message: '' })
      setVoiceSaveState({ kind: 'success', message: '语音 Access Token 已清空' })
    } catch (error) {
      setVoiceSaveState({ kind: 'error', message: `清空语音 Token 失败：${getErrorMessage(error)}` })
    }
  }

  const saveProfile = async () => {
    try {
      const next = await window.electronAPI.setProfile(profile)
      const normalizedProfile = {
        name: String(next?.name || ''),
        occupation: String(next?.occupation || ''),
        birthday: String(next?.birthday || ''),
        birthday_year: String(next?.birthday_year || ''),
        traits: String(next?.traits || ''),
        notes: String(next?.notes || ''),
      }
      setProfile(normalizedProfile)
      setSavedProfile(normalizedProfile)
      setStatus('用户档案已保存')
    } catch (error) {
      setErrorStatus('档案保存失败', error)
    }
  }

  const buildExportSuccessMessage = (result) => {
    const selectedFormats = Array.isArray(result?.selectedFormats) && result.selectedFormats.length > 0
      ? result.selectedFormats.map((key) => EXPORT_FORMAT_LABELS[key] || key).join('/')
      : 'Markdown/JSON/JSONL'
    const selectedScopes = Array.isArray(result?.selectedScopes) && result.selectedScopes.length > 0
      ? result.selectedScopes.map((key) => EXPORT_SCOPE_LABELS[key] || key).join('、')
      : '聊天历史、阶段摘要、用户档案'
    if (result?.exportType === 'all_split_by_role') {
      return `导出完成：按角色导出 ${result.items?.length || 0} 份（范围：${selectedScopes}；格式：${selectedFormats}）`
    }
    if (result?.exportType === 'role') {
      const item = Array.isArray(result.items) ? result.items[0] : null
      const roleLabel = String(item?.charName || item?.charId || item?.sessionId || '当前角色')
      return `导出完成：${roleLabel}（范围：${selectedScopes}；格式：${selectedFormats}）`
    }
    return `导出完成：${result?.baseName || 'muyu-export'}（范围：${selectedScopes}；格式：${selectedFormats}）`
  }

  const exportDocs = async (payload) => {
    try {
      setExportingDocs(true)
      const result = await window.electronAPI.exportDocs(payload || {})
      if (result?.canceled) {
        setStatus('已取消导出')
        return
      }
      setStatus(buildExportSuccessMessage(result))
    } catch (error) {
      setErrorStatus('导出失败', error)
    } finally {
      setExportingDocs(false)
    }
  }

  const exportByRoleSelection = async () => {
    if (selectedScopeCount === 0) {
      setStatus('请至少选择一项导出内容')
      return
    }
    if (selectedFormatCount === 0) {
      setStatus('请至少选择一种导出格式')
      return
    }
    const basePayload = {
      includeScopes: {
        chats: Boolean(exportScopes.chats),
        summaries: Boolean(exportScopes.summaries),
        profile: Boolean(exportScopes.profile),
      },
      formats: {
        markdown: Boolean(exportFormats.markdown),
        json: Boolean(exportFormats.json),
        jsonl: Boolean(exportFormats.jsonl),
      },
    }

    if (!selectedExportRole) {
      return exportDocs({
        mode: 'all',
        ...basePayload,
      })
    }

    return exportDocs({
      mode: 'role',
      roleSessionId: `pet_${selectedExportRole.id}`,
      ...basePayload,
    })
  }

  const toggleExportScope = (key) => {
    setExportScopes((prev) => {
      if (key === 'all') {
        const nextVal = !prev.all
        return {
          all: nextVal,
          chats: nextVal,
          summaries: nextVal,
          profile: nextVal,
        }
      }
      const next = { ...prev, [key]: !prev[key] }
      next.all = EXPORT_SCOPE_KEYS.every((k) => next[k])
      return next
    })
  }

  const toggleExportFormat = (key) => {
    setExportFormats((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const loadMemories = async (sessionId) => {
    const sid = String(sessionId || '').trim()
    if (!sid) {
      setRecentMemories([])
      setRecentMemoryTotal(0)
      return
    }
    try {
      const response = await window.electronAPI.listMemories({
        sessionId: sid,
        limit: RECENT_MEMORY_LIMIT,
        offset: 0,
      })
      const parsed = parseMemoryListResponse(response)
      setRecentMemories(parsed.items.map((item) => ({
        ...item,
        structured: parseStructuredMemory(item?.structured || item?.structuredJson),
      })))
      setRecentMemoryTotal(parsed.total)
    } catch (error) {
      setErrorStatus('读取记忆失败', error)
    }
  }

  const switchMemoryRole = (roleId) => {
    setExportRoleId(roleId)
    if (roleId === MEMORY_ROLE_ALL) {
      setMemSessionId('')
      setRecentMemories([])
      setRecentMemoryTotal(0)
      return
    }
    const sid = `pet_${roleId}`
    setMemSessionId(sid)
    loadMemories(sid)
  }

  useEffect(() => {
    if (exportRoleId === MEMORY_ROLE_ALL) return
    const exists = memoryRoles.some((item) => item.id === exportRoleId)
    if (exists) return
    const fallbackId = memoryRoles[0]?.id || MEMORY_ROLE_ALL
    switchMemoryRole(fallbackId)
  }, [exportRoleId, memoryRoles])

  const handleDeleteMemory = async (id) => {
    if (!window.confirm('确认删除这条记忆吗？删除后将不再用于对话，且无法恢复。')) return
    try {
      await window.electronAPI.deleteMemory(id)
      await loadMemories(memSessionId)
      setStatus('记忆已删除')
    } catch (error) {
      setErrorStatus('删除记忆失败', error)
    }
  }

  const testConnection = async () => {
    try {
      setTestingConnection(true)
      setConnectionState({ kind: 'testing', message: '测试中...' })

      const typedKey = String(config.apiKey || '').trim()
      const hasSavedKey = Boolean(config.apiKeyConfigured)
      if (apiKeyDirty && !typedKey) {
        throw new Error('当前输入的 API Key 为空。请填写后再测，或先保存已配置 Key。')
      }
      if (!apiKeyDirty && !hasSavedKey) {
        throw new Error('当前没有可用 API Key。请先填写并保存，或输入临时 Key 后测试。')
      }

      const payload = buildLlmTestPayload(config, { apiKeyDirty, typedKey })
      const result = await window.electronAPI.testLlmConnection(payload)
      const keySource = apiKeyDirty ? '临时 Key' : '已保存 Key'
      setConnectionState({
        kind: 'success',
        message: `已连通 · ${result.mode} · ${result.latencyMs}ms · ${keySource}`,
      })
    } catch (error) {
      setConnectionState({
        kind: 'error',
        message: `连通失败：${getErrorMessage(error)}`,
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const testVoiceConnection = async () => {
    try {
      setTestingVoiceConnection(true)
      setVoiceConnectionState({ kind: 'testing', message: '测试中...' })

      const typedToken = String(config.voiceAccessKey || '').trim()
      const hasSavedToken = Boolean(config.voiceAccessKeyConfigured)
      if (voiceAccessKeyDirty && !typedToken) {
        throw new Error('当前输入的语音 Access Token 为空。请填写后再测，或先保存已配置 Token。')
      }
      if (!voiceAccessKeyDirty && !hasSavedToken) {
        throw new Error('当前没有可用语音 Access Token。请先填写并保存，或输入临时 Token 后测试。')
      }
      if (!String(config.voiceAppId || '').trim()) {
        throw new Error('请先填写语音 AppID')
      }
      if (!String(config.voiceTtsResourceId || '').trim()) {
        throw new Error('请先填写 TTS 资源 ID')
      }

      const payload = buildVoiceTestPayload(config, { voiceAccessKeyDirty, typedToken })
      const result = await window.electronAPI.testVoiceConnection(payload)
      const keySource = voiceAccessKeyDirty ? '临时 Token' : '已保存 Token'
      setVoiceConnectionState({
        kind: 'success',
        message: `语音连通成功 · ${result.mode} · ${result.latencyMs}ms · ${keySource}`,
      })
    } catch (error) {
      setVoiceConnectionState({
        kind: 'error',
        message: `语音连通失败：${getErrorMessage(error)}`,
      })
    } finally {
      setTestingVoiceConnection(false)
    }
  }

  const previewPetScale = async (nextScale) => {
    const next = clampPetScale(nextScale)
    setPetScale(next)
    try {
      await window.electronAPI.resizePetWindow(next, { persist: false })
    } catch (error) {
      setErrorStatus('桌宠预览缩放失败', error)
    }
  }

  const commitPetScale = async (nextScale = petScale) => {
    const next = clampPetScale(nextScale)
    try {
      const prefs = await window.electronAPI.setPetUiPrefs({ scale: next })
      const saved = clampPetScale(prefs?.scale)
      setPetScale(saved)
      setStatus(`桌宠大小已设置为 ${Math.round(saved * 100)}%`)
    } catch (error) {
      setErrorStatus('桌宠大小保存失败', error)
    }
  }

  const resetPetScale = async () => {
    try {
      const result = await window.electronAPI.resetPetScale()
      const next = clampPetScale(result?.scale || 1)
      setPetScale(next)
      setStatus('桌宠大小已重置为 100%')
    } catch (error) {
      setErrorStatus('重置桌宠大小失败', error)
    }
  }

  const canShrink = petScale > PET_SCALE_MIN + 0.001
  const canGrow = petScale < PET_SCALE_MAX - 0.001
  const petScaleUiPosition = useMemo(() => {
    return clampUiScalePosition(scaleToUiScalePosition(petScale))
  }, [petScale])
  const asrMode = normalizeAsrMode(config.voiceAsrMode, config.voiceAsrResourceId)
  const isStreamAsr = asrMode === 'stream'
  const activeRoleCount = characters.filter((item) => item.isActive).length
  const currentRole = characters.find((item) => item.id === selectedId)
  const llmReady = Boolean(config.apiKeyConfigured || (apiKeyDirty && String(config.apiKey || '').trim()))
  const voiceReady = Boolean(
    config.voiceAccessKeyConfigured || (voiceAccessKeyDirty && String(config.voiceAccessKey || '').trim())
  )
  const dirtyCount = [llmDirty, voiceDirty, profileDirty, editorDirty].filter(Boolean).length

  if (loading) {
    return <div className="settings-root settings-loading">加载设置中...</div>
  }

  return (
    <div className="settings-root">
      <header className="settings-topbar">
        <div>
          <h1>设置面板</h1>
          <p className="settings-subtitle">基础优先，按任务完成配置与记忆管理</p>
        </div>
        {status && <div className="settings-status">{status}</div>}
      </header>

      <nav className="settings-nav-tabs" aria-label="设置分区导航">
        <button
          type="button"
          className={`settings-nav-tab${activeSection === 'quickstart' ? ' is-active' : ''}`}
          onClick={() => jumpToSection('quickstart')}
        >
          快速开始
        </button>
        <button
          type="button"
          className={`settings-nav-tab${activeSection === 'roles' ? ' is-active' : ''}`}
          onClick={() => jumpToSection('roles')}
        >
          角色管理
        </button>
        <button
          type="button"
          className={`settings-nav-tab${activeSection === 'memory' ? ' is-active' : ''}`}
          onClick={() => jumpToSection('memory')}
        >
          记忆中心
        </button>
      </nav>

      <div className="settings-layout">
        <section className="settings-panel" ref={quickStartRef}>
          <div className="panel-head">
            <h2>快速开始</h2>
            <p>先完成基础可用项，再进入角色和记忆管理。</p>
          </div>

          <section className="settings-priority-grid">
            <article className={`priority-card${dirtyCount > 0 ? ' is-warn' : ' is-ready'}`}>
              <strong>待处理</strong>
              <p>{dirtyCount > 0 ? `${dirtyCount} 个分区有未保存更改` : '当前没有未保存更改'}</p>
            </article>
            <article className={`priority-card${llmReady ? ' is-ready' : ' is-warn'}`}>
              <strong>AI 连通前提</strong>
              <p>{llmReady ? 'API Key 已就绪，可直接测试连通' : '请先填写并保存 API Key'}</p>
            </article>
            <article className={`priority-card${voiceReady ? ' is-ready' : ' is-warn'}`}>
              <strong>语音连通前提</strong>
              <p>{voiceReady ? '语音 Token 已就绪，可测试 ASR / TTS' : '请先填写并保存语音 Token'}</p>
            </article>
            <article className="priority-card">
              <strong>角色状态</strong>
              <p>已启用 {activeRoleCount} 个角色，当前角色：{currentRole?.name || '-'}</p>
            </article>
          </section>

          <div className="settings-divider" />

          <div className="panel-head">
            <div className="panel-head--row">
              <h2>AI 配置</h2>
              <span className={`panel-dirty${llmDirty ? ' is-dirty' : ''}`}>{llmDirty ? '有未保存更改' : '已保存'}</span>
            </div>
            <p>先填 API URL、模型 ID、API Key，再测试连通并保存。</p>
          </div>

          {!config.encryptionAvailable && <div className="warn">当前系统不支持 safeStorage，无法保存 API Key。</div>}

          <div className="form-grid">
            <label>API URL<input value={config.baseUrl} onChange={(event) => updateConfigField({ baseUrl: event.target.value })} /></label>
            <label>模型 ID<input value={config.model} onChange={(event) => updateConfigField({ model: event.target.value })} /></label>
            <label>
              Temperature
              <input
                type="number"
                step="0.1"
                value={config.temperature}
                onChange={(event) => updateConfigField({ temperature: event.target.value })}
              />
            </label>
            <label>
              上下文条数
              <input
                type="number"
                value={config.maxContext}
                onChange={(event) => updateConfigField({ maxContext: event.target.value })}
              />
            </label>
            <label>
              API Key ({config.apiKeyConfigured ? '已配置' : '未配置'})
              <input
                type="password"
                value={apiKeyDirty ? config.apiKey : (config.apiKeyConfigured ? '••••••••' : '')}
                placeholder={config.apiKeyConfigured ? '点击重新输入' : '请输入 API Key'}
                onFocus={() => {
                  if (!apiKeyDirty && config.apiKeyConfigured) {
                    setApiKeyDirty(true)
                    updateConfigField({ apiKey: '' })
                  }
                }}
                onChange={(event) => {
                  setApiKeyDirty(true)
                  updateConfigField({ apiKey: event.target.value })
                }}
              />
            </label>
          </div>

          <div className="button-row">
            <button className="btn btn--primary" onClick={saveLlmConfig} disabled={savingLlmConfig || !llmDirty}>
              {savingLlmConfig ? '保存中...' : '保存 AI 配置'}
            </button>
            <button className="btn" onClick={testConnection} disabled={testingConnection}>
              {testingConnection ? '测试中...' : '测试连通'}
            </button>
            <button className="btn btn--danger" onClick={clearApiKey}>清空 API Key</button>
          </div>
          {connectionState.kind !== 'idle' && (
            <span className={`connection-status connection-status--${connectionState.kind}`}>
              {connectionState.message}
            </span>
          )}
          {llmSaveState.kind !== 'idle' && (
            <div className={`section-status section-status--${llmSaveState.kind}`}>{llmSaveState.message}</div>
          )}

          <div className="settings-divider" />

          <div className="panel-head">
            <div className="panel-head--row">
              <h2>语音配置</h2>
              <span className={`panel-dirty${voiceDirty ? ' is-dirty' : ''}`}>{voiceDirty ? '有未保存更改' : '已保存'}</span>
            </div>
            <p>点按开始录音、再点结束。语音播放开关可在聊天窗口右上角控制。</p>
          </div>

          {!config.voiceEncryptionAvailable && (
            <div className="warn">当前系统不支持 safeStorage，无法保存语音 Access Token。</div>
          )}

          <div className="form-grid">
            <label>Region<input value={config.voiceRegion} onChange={(event) => updateConfigField({ voiceRegion: event.target.value })} /></label>
            <label>语音 AppID<input value={config.voiceAppId} onChange={(event) => updateConfigField({ voiceAppId: event.target.value })} /></label>
            <label>
              ASR 模式
              <select
                value={asrMode}
                onChange={(event) => {
                  const nextMode = normalizeAsrMode(event.target.value, config.voiceAsrResourceId)
                  updateConfigField({
                    voiceAsrMode: nextMode,
                    voiceAsrResourceId: normalizeAsrResourceIdByMode(nextMode, config.voiceAsrResourceId),
                    voiceAsrStreamUrl: String(config.voiceAsrStreamUrl || '').trim() || DEFAULT_ASR_STREAM_URL,
                  })
                }}
              >
                <option value="stream">流式识别（推荐，无需上传接口）</option>
                <option value="file">文件识别（需可访问 URL/上传接口）</option>
              </select>
            </label>
            <label>
              ASR 资源 ID（{isStreamAsr ? `默认流式：${DEFAULT_ASR_STREAM_RESOURCE_ID}` : `默认文件：${DEFAULT_ASR_FILE_RESOURCE_ID}`})
              <input
                value={config.voiceAsrResourceId}
                onChange={(event) => updateConfigField({
                  voiceAsrResourceId: normalizeAsrResourceIdByMode(asrMode, event.target.value),
                })}
              />
            </label>
            <label>TTS 资源 ID<input value={config.voiceTtsResourceId} onChange={(event) => updateConfigField({ voiceTtsResourceId: event.target.value })} /></label>
            {isStreamAsr ? (
              <label>
                ASR WebSocket URL
                <input
                  value={config.voiceAsrStreamUrl}
                  onChange={(event) => updateConfigField({ voiceAsrStreamUrl: event.target.value })}
                  placeholder={DEFAULT_ASR_STREAM_URL}
                />
              </label>
            ) : (
              <label>
                ASR 上传接口（可选）
                <input
                  value={config.voiceAsrUploadEndpoint}
                  onChange={(event) => updateConfigField({ voiceAsrUploadEndpoint: event.target.value })}
                  placeholder="https://your-uploader.example/upload"
                />
              </label>
            )}
            <label>
              TTS 格式
              <select
                value={config.voiceTtsFormat}
                onChange={(event) => updateConfigField({ voiceTtsFormat: event.target.value })}
              >
                <option value="mp3">mp3</option>
                <option value="wav">wav</option>
                <option value="ogg">ogg</option>
                <option value="pcm">pcm</option>
              </select>
            </label>
            <label>
              TTS 采样率
              <input
                type="number"
                min={8000}
                step={1000}
                value={config.voiceTtsSampleRate}
                onChange={(event) => updateConfigField({ voiceTtsSampleRate: event.target.value })}
              />
            </label>
            <label>
              语音 Access Token ({config.voiceAccessKeyConfigured ? '已配置' : '未配置'})
              <input
                type="password"
                value={voiceAccessKeyDirty ? config.voiceAccessKey : (config.voiceAccessKeyConfigured ? '••••••••' : '')}
                placeholder={config.voiceAccessKeyConfigured ? '点击重新输入' : '请输入语音 Access Token'}
                onFocus={() => {
                  if (!voiceAccessKeyDirty && config.voiceAccessKeyConfigured) {
                    setVoiceAccessKeyDirty(true)
                    updateConfigField({ voiceAccessKey: '' })
                  }
                }}
                onChange={(event) => {
                  setVoiceAccessKeyDirty(true)
                  updateConfigField({ voiceAccessKey: event.target.value })
                }}
              />
            </label>
          </div>

          <div className="button-row">
            <button className="btn btn--primary" onClick={saveVoiceConfig} disabled={savingVoiceConfig || !voiceDirty}>
              {savingVoiceConfig ? '保存中...' : '保存语音配置'}
            </button>
            <button className="btn" onClick={testVoiceConnection} disabled={testingVoiceConnection}>
              {testingVoiceConnection ? '测试中...' : '测试语音连通'}
            </button>
            <button className="btn btn--danger" onClick={clearVoiceAccessKey}>清空语音 Token</button>
          </div>
          {voiceConnectionState.kind !== 'idle' && (
            <span className={`connection-status connection-status--${voiceConnectionState.kind}`}>
              {voiceConnectionState.message}
            </span>
          )}
          {voiceSaveState.kind !== 'idle' && (
            <div className={`section-status section-status--${voiceSaveState.kind}`}>{voiceSaveState.message}</div>
          )}

          <div className="settings-divider" />

          <div className="panel-head">
            <h2>桌宠大小</h2>
            <p>拖动滑杆可连续缩放，键盘也支持 Cmd/Ctrl + +/- 与 Cmd/Ctrl + 0。</p>
          </div>

          <div className="pet-scale-box">
            <div className="pet-scale-head">
              <strong>{Math.round(petScale * 100)}%</strong>
              <span>{PET_SCALE_MIN.toFixed(1)}x - {PET_SCALE_MAX.toFixed(1)}x</span>
            </div>

            <input
              className="pet-scale-slider"
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={petScaleUiPosition}
              onChange={(event) => previewPetScale(uiScalePositionToScale(event.target.value))}
              onMouseUp={(event) => commitPetScale(uiScalePositionToScale(event.currentTarget.value))}
              onTouchEnd={(event) => commitPetScale(uiScalePositionToScale(event.currentTarget.value))}
              onBlur={(event) => commitPetScale(uiScalePositionToScale(event.currentTarget.value))}
            />
            <div className="pet-scale-marks" aria-hidden="true">
              <span>60%</span>
              <span className="is-center">100%</span>
              <span>180%</span>
            </div>

            <div className="button-row">
              <button
                className="btn"
                disabled={!canShrink}
                title={canShrink ? '缩小 5%' : `已到最小 ${Math.round(PET_SCALE_MIN * 100)}%`}
                onClick={() => commitPetScale(petScale - 0.05)}
              >
                缩小 5%
              </button>
              <button className="btn btn--secondary" onClick={resetPetScale}>重置 100%</button>
              <button
                className="btn"
                disabled={!canGrow}
                title={canGrow ? '放大 5%' : `已到最大 ${Math.round(PET_SCALE_MAX * 100)}%`}
                onClick={() => commitPetScale(petScale + 0.05)}
              >
                放大 5%
              </button>
            </div>
          </div>
        </section>

        <section className="settings-panel settings-panel--roles" ref={rolesRef}>
          <div className="panel-head">
            <h2>角色管理</h2>
            <p>以卡片方式浏览角色与提示词，点击卡片后进入编辑。已启用 {activeRoleCount} 个角色。</p>
          </div>
          <RoleCardGrid
            roles={filteredCharacters}
            selectedId={selectedId}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onEdit={openEditor}
          />
        </section>

        <section className="settings-panel" ref={memoryRef}>
          <div className="panel-head">
            <h2>记忆中心</h2>
            <p>长期记忆是用户档案；阶段记忆摘要（中期）是会话沉淀结果。</p>
          </div>

          <div className="memory-subsection">
            <div className="panel-head--row">
              <h3>长期记忆（用户档案）</h3>
              <span className={`panel-dirty${profileDirty ? ' is-dirty' : ''}`}>{profileDirty ? '有未保存更改' : '已保存'}</span>
            </div>
            <div className="form-grid">
              <label>姓名<input value={profile.name || ''} onChange={(event) => setProfile((prev) => ({ ...prev, name: event.target.value }))} /></label>
              <label>职业<input value={profile.occupation || ''} onChange={(event) => setProfile((prev) => ({ ...prev, occupation: event.target.value }))} /></label>
              <label>生日（MM-DD）<input value={profile.birthday || ''} onChange={(event) => setProfile((prev) => ({ ...prev, birthday: event.target.value }))} /></label>
              <label>出生年份<input value={profile.birthday_year || ''} onChange={(event) => setProfile((prev) => ({ ...prev, birthday_year: event.target.value }))} /></label>
              <label>个性标签<input value={profile.traits || ''} onChange={(event) => setProfile((prev) => ({ ...prev, traits: event.target.value }))} /></label>
            </div>
            <label>
              备注
              <textarea rows={4} value={profile.notes || ''} onChange={(event) => setProfile((prev) => ({ ...prev, notes: event.target.value }))} />
            </label>
            <div className="button-row">
              <button className="btn btn--primary" onClick={saveProfile} disabled={!profileDirty}>保存档案</button>
            </div>
            <p className="field-hint">主动发话默认开启：宠物会在你缺席或生日时主动问候。</p>
          </div>

          <div className="memory-subsection">
            <h3>导出与查看</h3>
            <div className="memory-simple-controls">
              <button
                className="btn"
                type="button"
                data-testid="memory-export-toggle"
                onClick={() => setExportOptionsExpanded((prev) => !prev)}
              >
                {exportOptionsExpanded ? '收起选项' : '展开选择'}
              </button>
              <select
                id="memory-role-select"
                data-testid="memory-role-select"
                value={exportRoleId}
                onChange={(event) => switchMemoryRole(event.target.value)}
                disabled={memoryRoles.length === 0}
              >
                <option value={MEMORY_ROLE_ALL}>全部</option>
                {memoryRoles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
              <button
                className="btn btn--primary"
                data-testid="memory-export-run"
                onClick={exportByRoleSelection}
                disabled={exportingDocs || selectedScopeCount === 0 || selectedFormatCount === 0}
              >
                {exportingDocs ? '导出中...' : '导出'}
              </button>
            </div>
            <p className="field-hint" data-testid="memory-export-target">
              当前导出对象：{selectedExportRole ? selectedExportRole.name : '全部角色'}
            </p>
            <p className="field-hint">默认仅展示基础操作，展开后可配置导出范围与格式。</p>
            {exportOptionsExpanded && (
              <div className="memory-option-block">
                <div className="memory-option-group" data-testid="memory-export-scope-group">
                  <strong>导出内容</strong>
                  <label className="memory-option-item" data-testid="memory-scope-all">
                    <input type="checkbox" checked={exportScopes.all} onChange={() => toggleExportScope('all')} />
                    全部
                  </label>
                  <label className="memory-option-item" data-testid="memory-scope-chats">
                    <input type="checkbox" checked={exportScopes.chats} onChange={() => toggleExportScope('chats')} />
                    聊天历史
                  </label>
                  <label className="memory-option-item" data-testid="memory-scope-summaries">
                    <input type="checkbox" checked={exportScopes.summaries} onChange={() => toggleExportScope('summaries')} />
                    阶段摘要
                  </label>
                  <label className="memory-option-item" data-testid="memory-scope-profile">
                    <input type="checkbox" checked={exportScopes.profile} onChange={() => toggleExportScope('profile')} />
                    用户档案
                  </label>
                </div>
                <div className="memory-option-group" data-testid="memory-export-format-group">
                  <strong>导出格式</strong>
                  <label className="memory-option-item" data-testid="memory-format-markdown">
                    <input
                      type="checkbox"
                      checked={exportFormats.markdown}
                      onChange={() => toggleExportFormat('markdown')}
                    />
                    Markdown
                  </label>
                  <label className="memory-option-item" data-testid="memory-format-json">
                    <input
                      type="checkbox"
                      checked={exportFormats.json}
                      onChange={() => toggleExportFormat('json')}
                    />
                    JSON
                  </label>
                  <label className="memory-option-item" data-testid="memory-format-jsonl">
                    <input
                      type="checkbox"
                      checked={exportFormats.jsonl}
                      onChange={() => toggleExportFormat('jsonl')}
                    />
                    JSONL
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="memory-subsection">
            <div className="panel-head--row">
              <h3>阶段记忆摘要（中期）预览</h3>
              <button
                className="btn"
                onClick={() => window.electronAPI.openMemoryWindow({
                  sessionId: selectedExportRole ? `pet_${selectedExportRole.id}` : '',
                })}
              >
                查看全部
              </button>
            </div>
            <p className="field-hint">这里只展示最近 {RECENT_MEMORY_LIMIT} 条，完整记录请点右上角“查看全部”。</p>

            {exportRoleId === MEMORY_ROLE_ALL ? (
              <p className="empty-hint">当前为“全部”视图，预览仅支持单角色。请在上方下拉选择具体角色。</p>
            ) : !selectedMemoryRole ? (
              <p className="empty-hint">暂无可查看的启用角色</p>
            ) : recentMemories.length === 0 ? (
              <p className="empty-hint">暂无记忆记录</p>
            ) : (
              <div className="memory-list">
                {recentMemories.map((m) => (
                  <div key={m.id} className="memory-item">
                    <span className="memory-ts">
                      {new Date(m.ts).toLocaleString('zh-CN')}
                    </span>
                    <p className="memory-text">{m.summary}</p>
                    {m.structured && (
                      <div className="memory-structured">
                        {MEMORY_STRUCTURED_KEYS.map((key) => {
                          const list = Array.isArray(m.structured?.[key]) ? m.structured[key].filter(Boolean) : []
                          if (list.length === 0) return null
                          return (
                            <div key={key} className="memory-structured-row">
                              <strong>{key}</strong>
                              <span>{list.join(' / ')}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    <button
                      className="btn btn--danger btn--sm"
                      onClick={() => handleDeleteMemory(m.id)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="memory-recent-footer">
              <span className="field-hint">当前仅展示最近 {RECENT_MEMORY_LIMIT} 条（共 {recentMemoryTotal} 条）</span>
            </div>
          </div>
        </section>

      </div>

      <RoleEditorModal
        open={editorOpen}
        draft={editorDraft}
        isDirty={editorDirty}
        isSaving={savingRole}
        onClose={closeEditor}
        onSave={saveEditor}
        onFieldChange={updateEditorField}
        onImportField={importForField}
      />
    </div>
  )
}
