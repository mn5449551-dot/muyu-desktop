import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
import '../styles/settings.css'

const PET_SCALE_STEP = 0.01

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

  const [profile, setProfile] = useState({ name: '', occupation: '', traits: '', notes: '' })
  const [savedProfile, setSavedProfile] = useState({ name: '', occupation: '', traits: '', notes: '' })

  const [status, setStatus] = useState('')
  const [petScale, setPetScale] = useState(1)
  const [exportingDocs, setExportingDocs] = useState(false)
  const [loading, setLoading] = useState(true)
  const [proactiveEnabled, setProactiveEnabled] = useState(false)
  const [memories, setMemories] = useState([])
  const [memSessionId, setMemSessionId] = useState('')
  const [promptCatalog, setPromptCatalog] = useState([])

  const resetConnectionState = () => {
    setConnectionState({ kind: 'idle', message: '' })
    setVoiceConnectionState({ kind: 'idle', message: '' })
  }
  const setErrorStatus = useCallback((prefix, error) => {
    setStatus(`${prefix}: ${getErrorMessage(error)}`)
  }, [])

  const updateConfigField = (patch) => {
    setConfig((prev) => ({ ...prev, ...patch }))
    resetConnectionState()
    setLlmSaveState({ kind: 'idle', message: '' })
    setVoiceSaveState({ kind: 'idle', message: '' })
  }

  const loadAll = useCallback(async (preferredId = null) => {
    const [rows, appConfig, userProfile, petUiPrefs, prompts] = await Promise.all([
      window.electronAPI.listCharacters(),
      window.electronAPI.getAppConfig(),
      window.electronAPI.getProfile(),
      window.electronAPI.getPetUiPrefs(),
      window.electronAPI.listPromptCatalog().catch(() => []),
    ])

    const merged = mergeCharacters(rows)
    setCharacters(merged)

    const keepId = preferredId || selectedId
    const fallback = merged.find((item) => item.id === keepId) || merged[0] || null
    setSelectedId(fallback ? fallback.id : '')

    const normalizedConfig = buildSettingsConfig(appConfig)
    setConfig(normalizedConfig)
    setSavedConfig(normalizedConfig)
    setPromptCatalog(Array.isArray(prompts) ? prompts : [])

    setApiKeyDirty(false)
    setVoiceAccessKeyDirty(false)
    resetConnectionState()
    setLlmSaveState({ kind: 'idle', message: '' })
    setVoiceSaveState({ kind: 'idle', message: '' })
    setProfile(userProfile)
    setSavedProfile(userProfile)
    setPetScale(clampPetScale(petUiPrefs?.scale))

    const memoryFallback = merged.find((item) => item.isActive) || fallback
    const initSessionId = memoryFallback ? `pet_${memoryFallback.id}` : ''
    setMemSessionId(initSessionId)

    try {
      const proactive = await window.electronAPI.getProactiveEnabled()
      setProactiveEnabled(Boolean(proactive))
    } catch (error) {
      setProactiveEnabled(false)
      setStatus(`主动发话配置读取失败，已按关闭处理：${getErrorMessage(error)}`)
    }

    try {
      if (initSessionId) {
        const mems = await window.electronAPI.listMemories(initSessionId)
        setMemories(mems)
      } else {
        setMemories([])
      }
    } catch (error) {
      setMemories([])
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
      setProfile(next)
      setSavedProfile(next)
      setStatus('用户档案已保存')
    } catch (error) {
      setErrorStatus('档案保存失败', error)
    }
  }

  const buildExportSuccessMessage = (result) => {
    if (result?.exportType === 'all_split_by_role') {
      return `导出完成：按角色分开导出 ${result.items?.length || 0} 份（md/json/jsonl；对话 ${result.chatCount || 0}，摘要 ${result.summaryCount || 0}）`
    }
    if (result?.exportType === 'role') {
      const item = Array.isArray(result.items) ? result.items[0] : null
      const roleLabel = String(item?.charName || item?.charId || item?.sessionId || '当前角色')
      return `导出完成：${roleLabel}（md/json/jsonl；对话 ${result.chatCount || 0}，摘要 ${result.summaryCount || 0}）`
    }
    return `导出完成：${result?.baseName || 'muyu-export'}（md/json/jsonl；会话 ${result?.sessionCount || 0}，对话 ${result?.chatCount || 0}，摘要 ${result?.summaryCount || 0}）`
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

  const exportAllMemories = async () => {
    const splitByRole = window.confirm('导出所有内容：点击“确定”按角色分开导出；点击“取消”合并导出。')
    return exportDocs({
      mode: 'all',
      allStrategy: splitByRole ? 'split_by_role' : 'merged',
    })
  }

  const exportSelectedRoleMemories = async () => {
    if (!selectedMemoryRoleId) {
      setStatus('请先在“查看角色记忆”中选择角色，再导出对应角色内容')
      return
    }
    return exportDocs({
      mode: 'role',
      roleSessionId: `pet_${selectedMemoryRoleId}`,
    })
  }

  const loadMemories = async (sessionId) => {
    const sid = String(sessionId || '').trim()
    if (!sid) {
      setMemories([])
      return
    }
    try {
      const mems = await window.electronAPI.listMemories(sid)
      setMemories(mems)
    } catch (error) {
      setErrorStatus('读取记忆失败', error)
    }
  }

  const handleDeleteMemory = async (id) => {
    if (!window.confirm('确认删除这条记忆吗？删除后将不再用于对话，且无法恢复。')) return
    try {
      await window.electronAPI.deleteMemory(id)
      setMemories((prev) => prev.filter((m) => m.id !== id))
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
          <p className="settings-subtitle">角色卡片化管理与提示词精细配置</p>
        </div>
        {status && <div className="settings-status">{status}</div>}
      </header>

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

      <div className="settings-layout">
        <section className="settings-panel settings-panel--roles">
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

        <section className="settings-panel">
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
              min={PET_SCALE_MIN}
              max={PET_SCALE_MAX}
              step={PET_SCALE_STEP}
              value={petScale}
              onChange={(event) => previewPetScale(event.target.value)}
              onMouseUp={() => commitPetScale(petScale)}
              onTouchEnd={() => commitPetScale(petScale)}
              onBlur={() => commitPetScale(petScale)}
            />

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

        <section className="settings-panel">
          <div className="panel-head">
            <div className="panel-head--row">
              <h2>AI 配置（常用）</h2>
              <span className={`panel-dirty${llmDirty ? ' is-dirty' : ''}`}>{llmDirty ? '有未保存更改' : '已保存'}</span>
            </div>
            <p>先填 API URL、模型 ID、API Key，再测试连通并保存。</p>
          </div>

          {!config.encryptionAvailable && <div className="warn">当前系统不支持 safeStorage，无法保存 API Key。</div>}

          <div className="form-grid">
            <label>API URL<input value={config.baseUrl} onChange={(event) => updateConfigField({ baseUrl: event.target.value })} /></label>
            <label>模型 ID<input value={config.model} onChange={(event) => updateConfigField({ model: event.target.value })} /></label>
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
          </div>
          {connectionState.kind !== 'idle' && (
            <span className={`connection-status connection-status--${connectionState.kind}`}>
              {connectionState.message}
            </span>
          )}
          {llmSaveState.kind !== 'idle' && (
            <div className={`section-status section-status--${llmSaveState.kind}`}>{llmSaveState.message}</div>
          )}

          <details className="advanced-group" data-testid="settings-llm-advanced">
            <summary>高级 AI 配置</summary>
            <p className="section-desc">
              当前为固定流程：输入安全校验，角色主模型整条生成，输出安全校验；若不通过则整条重生 1 次，仍不通过走固定兜底，再分段流式展示并语音播报。
            </p>
            <div className="form-grid">
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
            </div>
            <div className="readonly-prompts">
              <p className="section-desc">高级提示词当前为只读展示（MVP）：用户仅可编辑角色提示词。</p>
              {promptCatalog.length === 0 ? (
                <p className="empty-hint">暂无可展示的高级提示词</p>
              ) : (
                <div className="readonly-prompt-list">
                  {promptCatalog.map((item) => (
                    <details key={item.id} className="readonly-prompt-item">
                      <summary>
                        <span>{item.title}</span>
                        <span className="readonly-prompt-meta">{item.scope} · 只读</span>
                      </summary>
                      <p className="section-desc">{item.description}</p>
                      <textarea rows={5} value={String(item.content || '')} readOnly />
                    </details>
                  ))}
                </div>
              )}
            </div>
            <div className="button-row">
              <button className="btn btn--danger" onClick={clearApiKey}>清空 API Key</button>
            </div>
          </details>
        </section>

        <section className="settings-panel">
          <div className="panel-head">
            <div className="panel-head--row">
              <h2>语音配置（常用）</h2>
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
              ASR 资源 ID（{isStreamAsr ? `默认流式：${DEFAULT_ASR_STREAM_RESOURCE_ID}` : `默认文件：${DEFAULT_ASR_FILE_RESOURCE_ID}`}）
              <input
                value={config.voiceAsrResourceId}
                onChange={(event) => updateConfigField({
                  voiceAsrResourceId: normalizeAsrResourceIdByMode(asrMode, event.target.value),
                })}
              />
            </label>
            <label>TTS 资源 ID<input value={config.voiceTtsResourceId} onChange={(event) => updateConfigField({ voiceTtsResourceId: event.target.value })} /></label>
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
          </div>
          {voiceConnectionState.kind !== 'idle' && (
            <span className={`connection-status connection-status--${voiceConnectionState.kind}`}>
              {voiceConnectionState.message}
            </span>
          )}
          {voiceSaveState.kind !== 'idle' && (
            <div className={`section-status section-status--${voiceSaveState.kind}`}>{voiceSaveState.message}</div>
          )}

          <details className="advanced-group" data-testid="settings-voice-advanced">
            <summary>高级语音配置</summary>
            <div className="form-grid">
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
            </div>
            <div className="button-row">
              <button className="btn btn--danger" onClick={clearVoiceAccessKey}>清空语音 Token</button>
            </div>
          </details>
        </section>

        <section className="settings-panel">
          <div className="panel-head">
            <h2>记忆</h2>
            <p>记忆会自动沉淀。你可以在这里维护用户档案、导出记忆、查看角色记忆。</p>
          </div>

          <div className="memory-subsection">
            <div className="panel-head--row">
              <h3>用户档案</h3>
              <span className={`panel-dirty${profileDirty ? ' is-dirty' : ''}`}>{profileDirty ? '有未保存更改' : '已保存'}</span>
            </div>
            <div className="form-grid">
              <label>姓名<input value={profile.name || ''} onChange={(event) => setProfile((prev) => ({ ...prev, name: event.target.value }))} /></label>
              <label>职业<input value={profile.occupation || ''} onChange={(event) => setProfile((prev) => ({ ...prev, occupation: event.target.value }))} /></label>
              <label>个性标签<input value={profile.traits || ''} onChange={(event) => setProfile((prev) => ({ ...prev, traits: event.target.value }))} /></label>
            </div>
            <label>
              备注
              <textarea rows={4} value={profile.notes || ''} onChange={(event) => setProfile((prev) => ({ ...prev, notes: event.target.value }))} />
            </label>
            <div className="button-row">
              <button className="btn btn--primary" onClick={saveProfile} disabled={!profileDirty}>保存档案</button>
            </div>
            <label className="switch-row">
              <span>主动发话</span>
              <input
                type="checkbox"
                checked={proactiveEnabled}
                onChange={async (e) => {
                  const next = e.target.checked
                  try {
                    await window.electronAPI.setProactiveEnabled(next)
                    setProactiveEnabled(next)
                  } catch (error) {
                    setErrorStatus('主动发话设置失败', error)
                  }
                }}
              />
              <span className="field-hint">开启后宠物会在你缺席或生日时主动问候</span>
            </label>
          </div>

          <div className="memory-subsection">
            <h3>导出记忆</h3>
            <p className="section-desc">
              支持导出所有内容或导出当前选中角色。每份导出包含 Markdown 与 JSON（同时保留 JSONL 兼容文件）。
              导出中的“长期记忆”指用户档案，“阶段记忆摘要（中期）”来自会话摘要。
            </p>
            <div className="button-row">
              <button className="btn" onClick={exportAllMemories} disabled={exportingDocs}>
                {exportingDocs ? '导出中...' : '导出所有内容'}
              </button>
              <button className="btn" onClick={exportSelectedRoleMemories} disabled={exportingDocs || !selectedMemoryRoleId}>
                {exportingDocs ? '导出中...' : '导出当前选中角色'}
              </button>
            </div>
            <p className="field-hint">按角色分开导出时不包含默认会话。</p>
          </div>

          <div className="memory-subsection">
            <h3>查看角色记忆</h3>
            {memoryRoles.length === 0 ? (
              <p className="empty-hint">暂无可查看的启用角色</p>
            ) : (
              <div className="memory-role-tabs">
                {memoryRoles.map((role) => (
                  <button
                    key={role.id}
                    className={`memory-role-tab${selectedMemoryRoleId === role.id ? ' is-active' : ''}`}
                    onClick={() => {
                      const sid = `pet_${role.id}`
                      setMemSessionId(sid)
                      loadMemories(sid)
                    }}
                  >
                    {role.name}
                  </button>
                ))}
              </div>
            )}

            {memories.length === 0 ? (
              <p className="empty-hint">暂无记忆记录</p>
            ) : (
              <div className="memory-list">
                {memories.map((m) => (
                  <div key={m.id} className="memory-item">
                    <span className="memory-ts">
                      {new Date(m.ts).toLocaleDateString('zh-CN')}
                    </span>
                    <p className="memory-text">{m.summary}</p>
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
