// sandbox: true 模式下 preload 不能 require 本地文件，直接内联 channel 常量
const { contextBridge, ipcRenderer } = require('electron')
const isE2E = process.env.E2E === '1'

function onChannel(channel, callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Window / shell
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  showPetQuickMenu: (payload) => ipcRenderer.send('pet-show-quick-menu', payload || {}),
  startPetDrag: (screenX, screenY, visibleTopInsetPx) => ipcRenderer.send('pet-drag-start', { screenX, screenY, visibleTopInsetPx }),
  movePetDrag: (screenX, screenY) => ipcRenderer.send('pet-drag-move', { screenX, screenY }),
  endPetDrag: () => ipcRenderer.send('pet-drag-end'),
  openChatWindow: (payload) => ipcRenderer.invoke('chat-window-open', payload || {}),
  hideChatWindow: () => ipcRenderer.invoke('chat-window-hide'),
  getChatWindowState: () => ipcRenderer.invoke('chat-window-get-state'),
  setChatWindowOffset: (payload) => ipcRenderer.invoke('chat-window-set-offset', payload || {}),
  pinChatWindowToPet: (payload) => ipcRenderer.invoke('chat-window-pin-to-pet', payload || {}),
  openSettings: () => ipcRenderer.send('open-settings'),
  openMemoryWindow: (payload) => ipcRenderer.invoke('memory-window-open', payload || {}),

  // App state
  getState: () => ipcRenderer.invoke('db-get-state'),
  saveCount: (count) => ipcRenderer.send('db-save-count', count),
  setCurrentChar: (charId) => ipcRenderer.send('db-set-char', charId),
  getReachedMilestones: () => ipcRenderer.invoke('db-get-reached-milestones'),
  saveReachedMilestone: (n) => ipcRenderer.send('db-save-reached-milestone', n),

  // Characters
  listCharacters: () => ipcRenderer.invoke('db-list-characters'),
  upsertCharacter: (payload) => ipcRenderer.invoke('db-upsert-character', payload),
  toggleCharacterActive: (id, isActive) => ipcRenderer.invoke('db-toggle-character-active', { id, isActive }),
  reorderCharacters: (ids) => ipcRenderer.invoke('db-reorder-characters', ids),

  // Assets
  importAsset: (type, characterId) => ipcRenderer.invoke('asset-import-file', { type, characterId }),

  // Config + profile
  getAppConfig: () => ipcRenderer.invoke('app-get-config'),
  setAppConfig: (payload) => ipcRenderer.invoke('app-set-config', payload),
  getPetUiPrefs: () => ipcRenderer.invoke('pet-get-ui-prefs'),
  setPetUiPrefs: (payload) => ipcRenderer.invoke('pet-set-ui-prefs', payload || {}),
  resizePetWindow: (scale, options = {}) => ipcRenderer.invoke('pet-resize-window', { scale, persist: options.persist }),
  adjustPetScale: (delta) => ipcRenderer.invoke('pet-scale-adjust', { delta }),
  resetPetScale: () => ipcRenderer.invoke('pet-scale-reset'),
  expandHudWidth: (w) => ipcRenderer.send('pet-hud-expand', w),
  shrinkHudWidth: () => ipcRenderer.send('pet-hud-shrink'),
  getProfile: () => ipcRenderer.invoke('profile-get'),
  setProfile: (payload) => ipcRenderer.invoke('profile-set', payload),
  getProfilePins: () => ipcRenderer.invoke('profile-pins-get'),
  setProfilePins: (keys) => ipcRenderer.invoke('profile-pins-set', keys || []),
  listPromptCatalog: () => ipcRenderer.invoke('prompts-list'),

  // Chat + LLM + memory
  getChatRecent: (limit = 20, sessionId = 'pet_baihu') => ipcRenderer.invoke('chat-get-recent', { limit, sessionId }),
  startLlmStream: (prompt, sessionId = 'pet_baihu', charId = '') => ipcRenderer.invoke('llm-stream-chat', { prompt, sessionId, charId }),
  cancelLlm: (requestId) => ipcRenderer.invoke('llm-cancel', { requestId }),
  testLlmConnection: (payload) => ipcRenderer.invoke('llm-test-connection', payload || {}),
  transcribeVoice: (payload) => ipcRenderer.invoke('voice-transcribe', payload || {}),
  synthesizeVoice: (payload) => ipcRenderer.invoke('voice-synthesize', payload || {}),
  testVoiceConnection: (payload) => ipcRenderer.invoke('voice-test-connection', payload || {}),
  startVoiceStream: (payload) => ipcRenderer.invoke('voice-stream-start', payload || {}),
  pushVoiceStreamChunk: (payload) => ipcRenderer.invoke('voice-stream-chunk', payload || {}),
  stopVoiceStream: (payload) => ipcRenderer.invoke('voice-stream-stop', payload || {}),
  cancelVoiceStream: (payload) => ipcRenderer.invoke('voice-stream-cancel', payload || {}),
  exportDocs: (payload) => ipcRenderer.invoke('export-docs', payload || {}),
  listMemories: (payload) => ipcRenderer.invoke('memory-list', payload),
  deleteMemory: (id) => ipcRenderer.invoke('memory-delete', id),
  getPendingMemoryConflict: () => ipcRenderer.invoke('memory-conflict-pending-get'),
  getPendingMemoryConflictCount: () => ipcRenderer.invoke('memory-conflict-count-get'),
  resolveMemoryConflict: (payload) => ipcRenderer.invoke('memory-conflict-resolve', payload || {}),

  // Events
  onForceSave: (callback) => onChannel('force-save', callback),
  onCharactersUpdated: (callback) => onChannel('characters-updated', callback),
  onPetMenuAction: (callback) => onChannel('pet-menu-action', callback),
  onLlmDelta: (callback) => onChannel('llm-stream-delta', callback),
  onLlmDone: (callback) => onChannel('llm-stream-done', callback),
  onLlmError: (callback) => onChannel('llm-stream-error', callback),
  onVoiceStreamPartial: (callback) => onChannel('voice-stream-partial', callback),
  onVoiceStreamFinal: (callback) => onChannel('voice-stream-final', callback),
  onVoiceStreamError: (callback) => onChannel('voice-stream-error', callback),
  onChatReload: (callback) => onChannel('chat-reload', callback),
  onMemoryConflictRefresh: (callback) => onChannel('memory-conflict-refresh', callback),
})

if (isE2E) {
  contextBridge.exposeInMainWorld('e2eAPI', {
    isEnabled: true,
    getRuntimeState: () => ipcRenderer.invoke('e2e-get-runtime-state'),
    switchCharacter: (charId) => ipcRenderer.invoke('e2e-switch-char', { charId }),
    setMainWindowPosition: (x, y) => ipcRenderer.invoke('e2e-set-main-window-position', { x, y }),
    resizePetScale: (scale) => ipcRenderer.invoke('e2e-resize-pet-scale', { scale }),
    setChatWindowSize: (width, height) => ipcRenderer.invoke('e2e-set-chat-window-size', { width, height }),
    openChatWindow: (payload) => ipcRenderer.invoke('e2e-open-chat', payload || {}),
    hideChatWindow: () => ipcRenderer.invoke('e2e-hide-chat'),
    hideAllWindows: () => ipcRenderer.invoke('e2e-hide-all-windows'),
    showMainWindow: () => ipcRenderer.invoke('e2e-show-main-window'),
  })
}
