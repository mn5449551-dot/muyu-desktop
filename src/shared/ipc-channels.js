// Shared IPC channel names — imported by both main process (CJS) and renderer (ESM via Vite)
const IPC = Object.freeze({
  SET_IGNORE_MOUSE: 'set-ignore-mouse',
  SHOW_CONTEXT_MENU: 'show-context-menu',
  PET_SHOW_QUICK_MENU: 'pet-show-quick-menu',
  PET_DRAG_START: 'pet-drag-start',
  PET_DRAG_MOVE: 'pet-drag-move',
  PET_DRAG_END: 'pet-drag-end',
  CHAT_WINDOW_OPEN: 'chat-window-open',
  CHAT_WINDOW_HIDE: 'chat-window-hide',
  CHAT_WINDOW_GET_STATE: 'chat-window-get-state',
  CHAT_WINDOW_SET_OFFSET: 'chat-window-set-offset',
  CHAT_WINDOW_PIN_TO_PET: 'chat-window-pin-to-pet',
  OPEN_SETTINGS: 'open-settings',
  E2E_GET_RUNTIME_STATE: 'e2e-get-runtime-state',
  E2E_SWITCH_CHAR: 'e2e-switch-char',
  E2E_SET_MAIN_WINDOW_POSITION: 'e2e-set-main-window-position',
  E2E_RESIZE_PET_SCALE: 'e2e-resize-pet-scale',
  E2E_SET_CHAT_WINDOW_SIZE: 'e2e-set-chat-window-size',
  E2E_OPEN_CHAT: 'e2e-open-chat',
  E2E_HIDE_CHAT: 'e2e-hide-chat',
  E2E_HIDE_ALL_WINDOWS: 'e2e-hide-all-windows',
  E2E_SHOW_MAIN_WINDOW: 'e2e-show-main-window',

  // App state
  DB_GET_STATE: 'db-get-state',
  DB_SAVE_COUNT: 'db-save-count',
  DB_SET_CHAR: 'db-set-char',

  // Characters
  DB_LIST_CHARACTERS: 'db-list-characters',
  DB_UPSERT_CHARACTER: 'db-upsert-character',
  DB_TOGGLE_CHARACTER_ACTIVE: 'db-toggle-character-active',
  DB_REORDER_CHARACTERS: 'db-reorder-characters',

  // Assets
  ASSET_IMPORT_FILE: 'asset-import-file',

  // Config / profile
  APP_GET_CONFIG: 'app-get-config',
  APP_SET_CONFIG: 'app-set-config',
  PET_GET_UI_PREFS: 'pet-get-ui-prefs',
  PET_SET_UI_PREFS: 'pet-set-ui-prefs',
  PET_RESIZE_WINDOW: 'pet-resize-window',
  PET_SCALE_ADJUST: 'pet-scale-adjust',
  PET_SCALE_RESET: 'pet-scale-reset',
  PROFILE_GET: 'profile-get',
  PROFILE_SET: 'profile-set',

  // Chat / LLM / memory
  CHAT_GET_RECENT: 'chat-get-recent',
  LLM_STREAM_CHAT: 'llm-stream-chat',
  LLM_CANCEL: 'llm-cancel',
  LLM_TEST_CONNECTION: 'llm-test-connection',
  VOICE_TRANSCRIBE: 'voice-transcribe',
  VOICE_SYNTHESIZE: 'voice-synthesize',
  VOICE_TEST_CONNECTION: 'voice-test-connection',
  VOICE_STREAM_START: 'voice-stream-start',
  VOICE_STREAM_CHUNK: 'voice-stream-chunk',
  VOICE_STREAM_STOP: 'voice-stream-stop',
  VOICE_STREAM_CANCEL: 'voice-stream-cancel',
  VOICE_STREAM_PARTIAL: 'voice-stream-partial',
  VOICE_STREAM_FINAL: 'voice-stream-final',
  VOICE_STREAM_ERROR: 'voice-stream-error',
  EXPORT_DOCS: 'export-docs',
  MEMORY_RUN_SUMMARY: 'memory-run-summary',

  // Events (main -> renderer)
  FORCE_SAVE: 'force-save',
  CHARACTERS_UPDATED: 'characters-updated',
  PET_MENU_ACTION: 'pet-menu-action',
  LLM_STREAM_DELTA: 'llm-stream-delta',
  LLM_STREAM_DONE: 'llm-stream-done',
  LLM_STREAM_ERROR: 'llm-stream-error',
})

module.exports = IPC
