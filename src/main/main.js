const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, dialog } = require('electron')
const path = require('path')
const IPC = require('../shared/ipc-channels')
const log = require('./logger')
const db = require('./db')
const assetService = require('./services/asset-service')
const LlmService = require('./services/llm-service')
const MemoryService = require('./services/memory-service')
const ExportService = require('./services/export-service')
const VoiceService = require('./services/voice-service')
const { daysDiff, toLocalMMDD } = require('./utils/time')
const { listReadonlyPrompts } = require('./prompts/prompt-catalog')

const isDev = !app.isPackaged

process.on('uncaughtException', (err) => {
  log.error('[uncaughtException]', err)
})

process.on('unhandledRejection', (reason) => {
  log.error('[unhandledRejection]', reason instanceof Error ? reason : String(reason))
})
const isE2E = process.env.E2E === '1'
const useDistRenderer = !isDev || process.env.E2E_RENDERER === 'dist'

const gotLock = isE2E ? true : app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

if (isE2E && process.env.E2E_USER_DATA_DIR) {
  app.setPath('userData', process.env.E2E_USER_DATA_DIR)
}

const llmService = new LlmService(db)
const memoryService = new MemoryService(db, llmService)
const exportService = new ExportService(db)
const voiceService = new VoiceService(db)

let mainWindow = null
let settingsWindow = null
let chatWindow = null
let memoryWindow = null
let tray = null
let isQuittingFlow = false
let isMainWindowIgnoringMouse = true
let petDragState = null
let lastPetDragTopInsetPx = 0
let chatMovePersistTimer = null
let chatResizePersistTimer = null
let chatProgrammaticMoveUntil = 0

const PET_BASE_WIDTH = 240
const PET_BASE_HEIGHT = 340
const PET_SCALE_STEP = 0.1
const PET_DRAG_MIN_VISIBLE_HEIGHT = 48
const PET_DRAG_POINTER_TOP_MARGIN = 24
const CHAT_WINDOW_DEFAULT_WIDTH = 384
const CHAT_WINDOW_DEFAULT_HEIGHT = 560
const CHAT_WINDOW_MIN_WIDTH = 340
const CHAT_WINDOW_MIN_HEIGHT = 480
const CHAT_WINDOW_MAX_WIDTH = 520
const CHAT_WINDOW_MAX_HEIGHT = 760
const CHAT_GAP = 12
const CHAT_DEFAULT_SIDE = 'right'
const CHAT_DEFAULT_OFFSET_X = 20
const CHAT_DEFAULT_OFFSET_Y = -10
const DEFAULT_SESSION_ID = db.DEFAULT_SESSION_ID || 'pet_baihu'

function getRendererEntry() {
  return path.join(__dirname, '../../dist/renderer/index.html')
}

function buildViewQuery(view = 'game', extraQuery = {}) {
  const query = {}
  if (view !== 'game') query.view = view
  Object.entries(extraQuery || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    query[key] = String(value)
  })
  return query
}

function getRendererUrl(view = 'game', extraQuery = {}) {
  const params = new URLSearchParams(buildViewQuery(view, extraQuery))
  const query = params.toString()
  return query ? `http://localhost:5173/?${query}` : 'http://localhost:5173/'
}

function loadRendererWindow(win, view = 'game', extraQuery = {}) {
  const queryObj = buildViewQuery(view, extraQuery)
  if (useDistRenderer) {
    if (Object.keys(queryObj).length === 0) {
      return win.loadFile(getRendererEntry())
    }
    return win.loadFile(getRendererEntry(), { query: queryObj })
  }
  return win.loadURL(getRendererUrl(view, extraQuery))
}

function clampScale(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return db.DEFAULT_PET_SCALE
  return Math.max(db.MIN_PET_SCALE, Math.min(db.MAX_PET_SCALE, Number(n.toFixed(2))))
}

function getPetWindowSize(scale) {
  const clamped = clampScale(scale)
  return {
    width: Math.round(PET_BASE_WIDTH * clamped),
    height: Math.round(PET_BASE_HEIGHT * clamped),
    scale: clamped,
  }
}

function setMainWindowIgnoreMouse(ignore) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const next = Boolean(ignore)
  isMainWindowIgnoringMouse = next
  mainWindow.setIgnoreMouseEvents(next, { forward: true })
}

function isWindowAvailable(win) {
  return Boolean(win && !win.isDestroyed())
}

function showWindow(win, options = {}) {
  if (!isWindowAvailable(win)) return false
  const { focus = true } = options
  win.show()
  if (focus) win.focus()
  return true
}

function hideWindow(win) {
  if (!isWindowAvailable(win)) return false
  win.hide()
  return true
}

function isWindowVisible(win) {
  return Boolean(isWindowAvailable(win) && win.isVisible())
}

function registerIpcListenerEntries(entries = []) {
  entries.forEach(([channel, listener]) => {
    ipcMain.on(channel, listener)
  })
}

function registerIpcHandleEntries(entries = []) {
  entries.forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler)
  })
}

function resizeMainWindow(scale, { persist = true } = {}) {
  const next = getPetWindowSize(scale)
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (persist) db.setPetUiPrefs({ scale: next.scale })
    return next
  }

  const bounds = mainWindow.getBounds()
  const centerX = bounds.x + Math.round(bounds.width / 2)
  const centerY = bounds.y + Math.round(bounds.height / 2)
  const unclamped = {
    width: next.width,
    height: next.height,
    x: centerX - Math.round(next.width / 2),
    y: centerY - Math.round(next.height / 2),
  }
  const clamped = clampMainWindowBoundsToDisplay(unclamped)
  mainWindow.setBounds(clamped)

  if (isWindowVisible(chatWindow)) {
    positionChatWindow({ charId: getCurrentCharId() })
  }

  if (persist) db.setPetUiPrefs({ scale: next.scale })
  return next
}

function adjustPetScale(delta, { persist = true } = {}) {
  const prefs = db.getPetUiPrefs()
  const current = clampScale(prefs.scale)
  return resizeMainWindow(current + Number(delta || 0), { persist })
}

function clampChatWindowSize(width, height) {
  const rawWidth = Number(width)
  const rawHeight = Number(height)
  const nextWidth = Number.isFinite(rawWidth) ? Math.round(rawWidth) : CHAT_WINDOW_DEFAULT_WIDTH
  const nextHeight = Number.isFinite(rawHeight) ? Math.round(rawHeight) : CHAT_WINDOW_DEFAULT_HEIGHT
  return {
    width: Math.max(CHAT_WINDOW_MIN_WIDTH, Math.min(CHAT_WINDOW_MAX_WIDTH, nextWidth)),
    height: Math.max(CHAT_WINDOW_MIN_HEIGHT, Math.min(CHAT_WINDOW_MAX_HEIGHT, nextHeight)),
  }
}

function getChatWindowSize() {
  const prefs = db.getChatWindowPrefs()
  return clampChatWindowSize(prefs?.width, prefs?.height)
}

function createMainWindow() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { x, y } = primaryDisplay.bounds
  const { width: ww, height: wh } = primaryDisplay.workAreaSize

  const uiPrefs = db.getPetUiPrefs()
  const size = getPetWindowSize(uiPrefs.scale)
  const W = size.width
  const H = size.height

  mainWindow = new BrowserWindow({
    width: W,
    height: H,
    x: x + Math.round((ww - W) / 2),
    y: y + Math.round((wh - H) / 2),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (isDev && !useDistRenderer) {
    mainWindow.loadURL(getRendererUrl('game'))
    if (process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    loadRendererWindow(mainWindow, 'game')
  }

  log.info('main window created')

  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => checkProactiveGreeting(), 1500)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    isMainWindowIgnoringMouse = true
  })
  setMainWindowIgnoreMouse(true)
}

function createSettingsWindow() {
  if (isWindowAvailable(settingsWindow)) {
    showWindow(settingsWindow)
    return settingsWindow
  }

  settingsWindow = new BrowserWindow({
    width: 920,
    height: 700,
    minWidth: 860,
    minHeight: 620,
    show: false,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#f6f3ea',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  loadRendererWindow(settingsWindow, 'settings')

  log.info('settings window created')

  settingsWindow.once('ready-to-show', () => {
    showWindow(settingsWindow, { focus: false })
  })
  settingsWindow.on('closed', () => { settingsWindow = null })

  return settingsWindow
}

function normalizeMemoryWindowQuery(payload = {}) {
  const query = {}
  const sessionId = String(payload?.sessionId || '').trim()
  const keyword = String(payload?.keyword || '').trim()
  const range = String(payload?.range || '').trim()
  if (sessionId) query.sessionId = sessionId
  if (keyword) query.keyword = keyword
  if (range && range !== 'all') query.range = range
  return query
}

function createMemoryWindow(payload = {}) {
  const query = normalizeMemoryWindowQuery(payload)
  if (isWindowAvailable(memoryWindow)) {
    loadRendererWindow(memoryWindow, 'memory', query)
    showWindow(memoryWindow)
    return memoryWindow
  }

  memoryWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 860,
    minHeight: 620,
    show: false,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#f6f3ea',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  loadRendererWindow(memoryWindow, 'memory', query)
  log.info('memory window created')

  memoryWindow.once('ready-to-show', () => {
    showWindow(memoryWindow, { focus: false })
  })
  memoryWindow.on('closed', () => { memoryWindow = null })

  return memoryWindow
}

function getCurrentCharId() {
  const state = db.getState()
  return String(state.currentCharId || 'muyu')
}

function getChatDockPrefs(charId) {
  const row = db.getCharacterById(charId)
  return {
    side: row?.chatSide === 'left' ? 'left' : CHAT_DEFAULT_SIDE,
    offsetX: Number.isFinite(row?.chatOffsetX) ? row.chatOffsetX : CHAT_DEFAULT_OFFSET_X,
    offsetY: Number.isFinite(row?.chatOffsetY) ? row.chatOffsetY : CHAT_DEFAULT_OFFSET_Y,
  }
}

function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    return chatWindow
  }

  const chatSize = getChatWindowSize()

  chatWindow = new BrowserWindow({
    width: chatSize.width,
    height: chatSize.height,
    minWidth: CHAT_WINDOW_MIN_WIDTH,
    minHeight: CHAT_WINDOW_MIN_HEIGHT,
    maxWidth: CHAT_WINDOW_MAX_WIDTH,
    maxHeight: CHAT_WINDOW_MAX_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  log.info('chat window created')

  loadRendererWindow(chatWindow, 'chat')

  chatWindow.on('close', (event) => {
    if (isQuittingFlow) return
    event.preventDefault()
    if (chatWindow) chatWindow.hide()
  })

  chatWindow.on('closed', () => {
    chatWindow = null
    chatProgrammaticMoveUntil = 0
    if (chatMovePersistTimer) clearTimeout(chatMovePersistTimer)
    chatMovePersistTimer = null
    if (chatResizePersistTimer) clearTimeout(chatResizePersistTimer)
    chatResizePersistTimer = null
  })

  chatWindow.on('moved', () => {
    if (!chatWindow || chatWindow.isDestroyed() || !mainWindow) return
    if (Date.now() < chatProgrammaticMoveUntil) return
    const charId = getCurrentCharId()
    const bounds = chatWindow.getBounds()
    const petBounds = mainWindow.getBounds()
    const side = bounds.x + Math.round(bounds.width / 2) >= petBounds.x + Math.round(petBounds.width / 2)
      ? 'right'
      : 'left'
    const baseX = side === 'left'
      ? petBounds.x - bounds.width - CHAT_GAP
      : petBounds.x + petBounds.width + CHAT_GAP
    const baseY = petBounds.y + Math.round((petBounds.height - bounds.height) / 2)
    const offsetX = bounds.x - baseX
    const offsetY = bounds.y - baseY

    if (chatMovePersistTimer) clearTimeout(chatMovePersistTimer)
    chatMovePersistTimer = setTimeout(() => {
      db.setCharacterChatWindowPrefs(charId, { side, offsetX, offsetY })
    }, 120)
  })

  chatWindow.on('resized', () => {
    if (!chatWindow || chatWindow.isDestroyed()) return
    const bounds = chatWindow.getBounds()
    const nextSize = clampChatWindowSize(bounds.width, bounds.height)
    if (chatResizePersistTimer) clearTimeout(chatResizePersistTimer)
    chatResizePersistTimer = setTimeout(() => {
      db.setChatWindowPrefs(nextSize)
    }, 100)
    if (chatWindow.isVisible()) {
      positionChatWindow({ charId: getCurrentCharId() })
    }
  })

  return chatWindow
}

function getDisplayWorkAreaForBounds(bounds) {
  const center = {
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2),
  }
  return screen.getDisplayNearestPoint(center).workArea
}

function clampMainWindowBoundsToDisplay(bounds) {
  const display = getDisplayWorkAreaForBounds(bounds)
  const maxX = display.x + display.width - bounds.width
  const maxY = display.y + display.height - bounds.height
  return {
    ...bounds,
    x: Math.max(display.x, Math.min(maxX, bounds.x)),
    y: Math.max(display.y, Math.min(maxY, bounds.y)),
  }
}

function getPetDragClampMeta(bounds) {
  const center = {
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2),
  }
  const disp = screen.getDisplayNearestPoint(center)
  const display = disp.workArea
  const maxX = display.x + display.width - bounds.width
  const maxY = display.y + display.height - bounds.height
  // Allow full transparent headroom to move above work area top.
  const allowedTopOverflow = Math.max(0, bounds.height - PET_DRAG_MIN_VISIBLE_HEIGHT)
  const minY = display.y - allowedTopOverflow
  return { display, maxX, maxY, minY }
}

function clampPetDragBoundsToDisplay(bounds) {
  const { display, maxX, maxY, minY } = getPetDragClampMeta(bounds)
  return {
    ...bounds,
    x: Math.max(display.x, Math.min(maxX, bounds.x)),
    y: Math.max(minY, Math.min(maxY, bounds.y)),
  }
}

function clampChatBoundsToDisplay(bounds, display) {
  const maxX = display.x + display.width - bounds.width
  const maxY = display.y + display.height - bounds.height
  return {
    ...bounds,
    x: Math.max(display.x, Math.min(maxX, bounds.x)),
    y: Math.max(display.y, Math.min(maxY, bounds.y)),
  }
}

function computeChatBounds({ side, offsetX, offsetY }) {
  if (!mainWindow || mainWindow.isDestroyed()) return null

  const petBounds = mainWindow.getBounds()
  const fallbackSize = getChatWindowSize()
  const width = chatWindow && !chatWindow.isDestroyed() ? chatWindow.getBounds().width : fallbackSize.width
  const height = chatWindow && !chatWindow.isDestroyed() ? chatWindow.getBounds().height : fallbackSize.height
  const display = getDisplayWorkAreaForBounds(petBounds)

  let nextSide = side === 'left' ? 'left' : CHAT_DEFAULT_SIDE
  const baseY = petBounds.y + Math.round((petBounds.height - height) / 2)
  const leftX = petBounds.x - width - CHAT_GAP + offsetX
  const rightX = petBounds.x + petBounds.width + CHAT_GAP + offsetX
  let x = nextSide === 'left' ? leftX : rightX
  let y = baseY + offsetY

  if (nextSide === 'right' && x + width > display.x + display.width) {
    nextSide = 'left'
    x = leftX
  } else if (nextSide === 'left' && x < display.x) {
    nextSide = 'right'
    x = rightX
  }

  return clampChatBoundsToDisplay({ x, y, width, height, side: nextSide }, display)
}

function positionChatWindow({ charId = getCurrentCharId(), shouldShow = false, preferSide } = {}) {
  if (!mainWindow || !chatWindow || chatWindow.isDestroyed()) return null

  const prefs = getChatDockPrefs(charId)
  const side = preferSide === 'left' || preferSide === 'right' ? preferSide : prefs.side
  const next = computeChatBounds({
    side,
    offsetX: prefs.offsetX,
    offsetY: prefs.offsetY,
  })

  if (!next) return null

  chatProgrammaticMoveUntil = Date.now() + 220
  chatWindow.setBounds({
    x: next.x,
    y: next.y,
    width: next.width,
    height: next.height,
  })

  if (shouldShow) {
    chatWindow.show()
    chatWindow.focus()
  }

  return {
    visible: chatWindow.isVisible(),
    charId,
    side: next.side,
    offsetX: prefs.offsetX,
    offsetY: prefs.offsetY,
    bounds: chatWindow.getBounds(),
  }
}

function openChatWindow({ charId = getCurrentCharId(), preferSide } = {}) {
  const targetCharId = String(charId || getCurrentCharId())
  const win = createChatWindow()

  const apply = () => {
    positionChatWindow({ charId: targetCharId, shouldShow: true, preferSide })
    sendToAllWindows(IPC.PET_MENU_ACTION, { type: 'chat-open', charId: targetCharId })
  }

  if (win.webContents.isLoadingMainFrame()) {
    win.once('ready-to-show', apply)
  } else {
    apply()
  }

  return {
    visible: true,
    charId: targetCharId,
  }
}

function hideChatWindow() {
  hideWindow(chatWindow)
  return { visible: false }
}

function hideAllWindows() {
  const windows = [mainWindow, chatWindow, settingsWindow, memoryWindow]
  windows.forEach((win) => hideWindow(win))
  return { visible: false }
}

function showMainWindow() {
  if (!isWindowAvailable(mainWindow)) {
    createMainWindow()
  }
  showWindow(mainWindow)
  return { visible: Boolean(isWindowAvailable(mainWindow) && mainWindow.isVisible()) }
}

function toggleMainWindowVisibility() {
  if (isWindowAvailable(mainWindow) && mainWindow.isVisible()) {
    return hideAllWindows()
  }
  return showMainWindow()
}

function createTray() {
  let icon
  try {
    const iconPath = path.join(__dirname, '../../assets/tray-icon.png')
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) throw new Error('icon empty')
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('木鱼桌宠')

  const menuTemplate = [
    {
      label: '显示/隐藏',
      click: () => toggleMainWindowVisibility(),
    },
    {
      label: '设置',
      click: () => createSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]

  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate))
  if (process.platform === 'darwin') {
    tray.on('double-click', () => {
      toggleMainWindowVisibility()
    })
  } else {
    tray.on('click', () => {
      toggleMainWindowVisibility()
    })
  }
}

function sendToAllWindows(channel, payload) {
  ;[mainWindow, settingsWindow, chatWindow, memoryWindow].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  })
}

function startPetDrag(screenX, screenY, visibleTopInsetPx) {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const x = Number(screenX)
  const y = Number(screenY)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return

  const bounds = mainWindow.getBounds()
  const maxOverflow = Math.max(0, bounds.height - PET_DRAG_MIN_VISIBLE_HEIGHT)
  const pointerOffsetY = Math.round(y - bounds.y)
  const pointerBasedOverflow = pointerOffsetY - PET_DRAG_POINTER_TOP_MARGIN
  const rawInset = Number(visibleTopInsetPx)
  const visibleTopInset = Number.isFinite(rawInset) ? Math.round(rawInset) : 0
  const topInset = Math.max(0, Math.min(maxOverflow, Math.max(visibleTopInset, pointerBasedOverflow)))
  lastPetDragTopInsetPx = topInset
  petDragState = {
    offsetX: x - bounds.x,
    offsetY: y - bounds.y,
    lastX: bounds.x,
    lastY: bounds.y,
    visibleTopInsetPx: topInset,
  }
}

function movePetDrag(screenX, screenY) {
  if (!mainWindow || mainWindow.isDestroyed() || !petDragState) return

  const x = Number(screenX)
  const y = Number(screenY)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return

  const bounds = mainWindow.getBounds()
  const unclamped = {
    x: Math.round(x - petDragState.offsetX),
    y: Math.round(y - petDragState.offsetY),
    width: bounds.width,
    height: bounds.height,
  }
  const clamped = clampPetDragBoundsToDisplay(unclamped)
  const nextX = clamped.x
  const nextY = clamped.y
  if (nextX === petDragState.lastX && nextY === petDragState.lastY) return

  mainWindow.setPosition(nextX, nextY)
  petDragState.lastX = nextX
  petDragState.lastY = nextY
  if (isWindowVisible(chatWindow)) {
    positionChatWindow({ charId: getCurrentCharId() })
  }
}

function endPetDrag() {
  petDragState = null
}

function switchCharacterEverywhere(charId) {
  const nextId = String(charId || '').trim()
  if (!nextId) return null
  const target = db.getCharacterById(nextId)
  if (!target || !target.isActive) return null

  db.setCurrentChar(nextId)
  sendToAllWindows(IPC.PET_MENU_ACTION, { type: 'switch-char', charId: nextId })
  if (isWindowVisible(chatWindow)) {
    positionChatWindow({ charId: nextId })
  }

  return target
}

function popupPetQuickMenu(payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const state = db.getState()
  const chars = db.listCharacters().filter((item) => item.isActive)
  const currentId = state.currentCharId
  const prefs = db.getPetUiPrefs()
  const scale = prefs.scale
  const minScale = db.MIN_PET_SCALE
  const maxScale = db.MAX_PET_SCALE
  const canShrink = scale > minScale + 0.001
  const canGrow = scale < maxScale - 0.001

  const charSubmenu = chars.length > 0
    ? chars.map((item) => ({
      label: item.name,
      type: 'radio',
      checked: item.id === currentId,
      click: () => {
        switchCharacterEverywhere(item.id)
      },
    }))
    : [{ label: '暂无可用角色', enabled: false }]

  const menu = Menu.buildFromTemplate([
    {
      label: '聊天',
      click: () => openChatWindow({ charId: currentId }),
    },
    {
      label: '切换角色',
      submenu: charSubmenu,
    },
    {
      label: '设置',
      click: () => createSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: canShrink ? '缩小' : `缩小（最小 ${Math.round(minScale * 100)}%）`,
      enabled: canShrink,
      click: () => adjustPetScale(-PET_SCALE_STEP),
    },
    {
      label: '重置(100%)',
      enabled: Math.abs(scale - 1) > 0.001,
      click: () => resizeMainWindow(1),
    },
    {
      label: canGrow ? '放大' : `放大（最大 ${Math.round(maxScale * 100)}%）`,
      enabled: canGrow,
      click: () => adjustPetScale(PET_SCALE_STEP),
    },
    { type: 'separator' },
    {
      label: '隐藏',
      click: () => hideAllWindows(),
    },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ])

  const x = Number.isFinite(payload.x) ? Number(payload.x) : undefined
  const y = Number.isFinite(payload.y) ? Number(payload.y) : undefined
  setMainWindowIgnoreMouse(false)
  menu.popup({
    window: mainWindow,
    x,
    y,
    callback: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send(IPC.PET_MENU_ACTION, { type: 'quick-menu-closed' })
    },
  })
}

function getRuntimeState() {
  const state = db.getState()
  const prefs = db.getPetUiPrefs()
  const chars = db.listCharacters()
  const mainBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null
  const display = mainBounds ? getDisplayWorkAreaForBounds(mainBounds) : null

  return {
    app: {
      isDev,
      isE2E,
      useDistRenderer,
    },
    state,
    petScale: prefs.scale,
    petDragTopInsetPx: Number(lastPetDragTopInsetPx || 0),
    characters: chars.map((item) => ({
      id: item.id,
      name: item.name,
      isActive: item.isActive,
      sortOrder: item.sortOrder,
    })),
    windows: {
      main: mainWindow && !mainWindow.isDestroyed()
        ? {
          visible: mainWindow.isVisible(),
          bounds: mainBounds,
          display,
          ignoreMouse: isMainWindowIgnoringMouse,
        }
        : null,
      chat: chatWindow && !chatWindow.isDestroyed()
        ? { visible: chatWindow.isVisible(), bounds: chatWindow.getBounds() }
        : null,
      settings: settingsWindow && !settingsWindow.isDestroyed()
        ? { visible: settingsWindow.isVisible(), bounds: settingsWindow.getBounds() }
        : null,
      memory: memoryWindow && !memoryWindow.isDestroyed()
        ? { visible: memoryWindow.isVisible(), bounds: memoryWindow.getBounds() }
        : null,
    },
  }
}

function getDialogOwnerWindow() {
  if (isWindowAvailable(memoryWindow)) return memoryWindow
  if (isWindowAvailable(settingsWindow)) return settingsWindow
  if (isWindowAvailable(mainWindow)) return mainWindow
  return null
}

async function chooseExportDirectory() {
  const options = {
    title: '选择导出目录',
    buttonLabel: '导出到此目录',
    properties: ['openDirectory', 'createDirectory'],
  }
  const ownerWindow = getDialogOwnerWindow()
  if (ownerWindow) return dialog.showOpenDialog(ownerWindow, options)
  return dialog.showOpenDialog(options)
}

function registerMainWindowIpcHandlers() {
  registerIpcListenerEntries([
    [IPC.SET_IGNORE_MOUSE, (_event, ignore) => setMainWindowIgnoreMouse(ignore)],
    [IPC.PET_DRAG_START, (_event, payload) => startPetDrag(payload?.screenX, payload?.screenY, payload?.visibleTopInsetPx)],
    [IPC.PET_DRAG_MOVE, (_event, payload) => movePetDrag(payload?.screenX, payload?.screenY)],
    [IPC.PET_DRAG_END, () => endPetDrag()],
    [IPC.SHOW_CONTEXT_MENU, () => {
      const menu = Menu.buildFromTemplate([
        { label: '设置', click: () => createSettingsWindow() },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ])
      if (mainWindow) menu.popup({ window: mainWindow })
    }],
    [IPC.PET_SHOW_QUICK_MENU, (_event, payload) => popupPetQuickMenu(payload || {})],
    [IPC.OPEN_SETTINGS, () => createSettingsWindow()],
  ])

  registerIpcHandleEntries([
    [IPC.OPEN_MEMORY_WINDOW, (_event, payload) => {
      createMemoryWindow(payload || {})
      return { ok: true }
    }],
  ])
}

function registerE2EIpcHandlers() {
  registerIpcHandleEntries([
    [IPC.E2E_GET_RUNTIME_STATE, () => getRuntimeState()],
    [IPC.E2E_SWITCH_CHAR, (_event, payload) => {
      const row = switchCharacterEverywhere(payload?.charId)
      return {
        ok: Boolean(row),
        charId: row?.id || null,
      }
    }],
    [IPC.E2E_SET_MAIN_WINDOW_POSITION, (_event, payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) return { ok: false }
      const x = Number(payload?.x)
      const y = Number(payload?.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false }
      mainWindow.setPosition(Math.round(x), Math.round(y))
      if (isWindowVisible(chatWindow)) {
        positionChatWindow({ charId: getCurrentCharId() })
      }
      return { ok: true, bounds: mainWindow.getBounds() }
    }],
    [IPC.E2E_RESIZE_PET_SCALE, (_event, payload) => {
      const result = resizeMainWindow(payload?.scale)
      return { ok: true, ...result }
    }],
    [IPC.E2E_SET_CHAT_WINDOW_SIZE, (_event, payload) => {
      const win = createChatWindow()
      const width = Number(payload?.width)
      const height = Number(payload?.height)
      if (!Number.isFinite(width) || !Number.isFinite(height)) return { ok: false }
      const nextSize = clampChatWindowSize(width, height)
      win.setSize(nextSize.width, nextSize.height)
      db.setChatWindowPrefs(nextSize)
      if (isWindowVisible(chatWindow)) {
        positionChatWindow({ charId: getCurrentCharId() })
      }
      return { ok: true, ...nextSize, bounds: win.getBounds() }
    }],
    [IPC.E2E_OPEN_CHAT, (_event, payload) => openChatWindow(payload || {})],
    [IPC.E2E_HIDE_CHAT, () => hideChatWindow()],
    [IPC.E2E_HIDE_ALL_WINDOWS, () => hideAllWindows()],
    [IPC.E2E_SHOW_MAIN_WINDOW, () => showMainWindow()],
  ])
}

function registerChatWindowIpcHandlers() {
  registerIpcHandleEntries([
    [IPC.CHAT_WINDOW_OPEN, (_event, payload) => openChatWindow(payload || {})],
    [IPC.CHAT_WINDOW_HIDE, () => hideChatWindow()],
    [IPC.CHAT_WINDOW_GET_STATE, () => {
      if (!chatWindow || chatWindow.isDestroyed()) {
        return { visible: false, charId: getCurrentCharId() }
      }
      const charId = getCurrentCharId()
      const prefs = getChatDockPrefs(charId)
      return {
        visible: chatWindow.isVisible(),
        charId,
        side: prefs.side,
        offsetX: prefs.offsetX,
        offsetY: prefs.offsetY,
        bounds: chatWindow.getBounds(),
      }
    }],
    [IPC.CHAT_WINDOW_SET_OFFSET, (_event, payload) => {
      const charId = String(payload?.charId || getCurrentCharId())
      const side = payload?.side === 'left' ? 'left' : 'right'
      const offsetX = Number(payload?.offsetX)
      const offsetY = Number(payload?.offsetY)
      const next = db.setCharacterChatWindowPrefs(charId, { side, offsetX, offsetY })
      if (isWindowVisible(chatWindow)) {
        positionChatWindow({ charId })
      }
      return next
    }],
    [IPC.CHAT_WINDOW_PIN_TO_PET, (_event, payload) => {
      const charId = String(payload?.charId || getCurrentCharId())
      return positionChatWindow({ charId, shouldShow: false, preferSide: payload?.preferSide })
    }],
  ])
}

function registerCharacterIpcHandlers() {
  registerIpcListenerEntries([
    [IPC.DB_SAVE_COUNT, (_event, count) => db.saveCount(count)],
    [IPC.DB_SET_CHAR, (_event, charId) => db.setCurrentChar(charId)],
    [IPC.DB_SAVE_REACHED_MILESTONE, (_e, n) => db.saveReachedMilestone(n)],
  ])

  registerIpcHandleEntries([
    [IPC.DB_GET_STATE, () => db.getState()],
    [IPC.DB_GET_REACHED_MILESTONES, () => db.getReachedMilestones()],
    [IPC.DB_LIST_CHARACTERS, () => db.listCharacters()],
    [IPC.DB_UPSERT_CHARACTER, (_event, payload) => {
      const row = db.upsertCharacter(payload || {})
      sendToAllWindows(IPC.CHARACTERS_UPDATED, db.listCharacters())
      return row
    }],
    [IPC.DB_TOGGLE_CHARACTER_ACTIVE, (_event, payload) => {
      if (!payload?.id) throw new Error('缺少角色 ID')
      db.toggleCharacterActive(payload.id, payload.isActive)
      const list = db.listCharacters()
      sendToAllWindows(IPC.CHARACTERS_UPDATED, list)
      return list
    }],
    [IPC.DB_REORDER_CHARACTERS, (_event, ids) => {
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('缺少角色 ID 列表')
      db.reorderCharacters(ids)
      const list = db.listCharacters()
      sendToAllWindows(IPC.CHARACTERS_UPDATED, list)
      return list
    }],
  ])
}

function registerConfigIpcHandlers() {
  registerIpcHandleEntries([
    [IPC.ASSET_IMPORT_FILE, async (_event, payload) => {
      const type = payload?.type || 'image'
      const characterId = payload?.characterId || 'custom'
      return assetService.importAsset(type, characterId)
    }],
    [IPC.APP_GET_CONFIG, () => db.getAppConfig()],
    [IPC.APP_SET_CONFIG, (_event, payload) => db.setAppConfig(payload || {})],
    [IPC.PET_GET_UI_PREFS, () => db.getPetUiPrefs()],
    [IPC.PET_SET_UI_PREFS, (_event, payload) => {
      const prefs = db.setPetUiPrefs(payload || {})
      resizeMainWindow(prefs.scale, { persist: false })
      return prefs
    }],
    [IPC.PET_RESIZE_WINDOW, (_event, payload) => {
      const persist = payload?.persist !== false
      return resizeMainWindow(payload?.scale, { persist })
    }],
    [IPC.PET_SCALE_ADJUST, (_event, payload) => adjustPetScale(payload?.delta)],
    [IPC.PET_SCALE_RESET, () => resizeMainWindow(1)],
    [IPC.PROFILE_GET, () => db.getUserProfile()],
    [IPC.PROFILE_SET, (_event, payload) => db.setUserProfile(payload || {})],
    [IPC.PROFILE_PINS_GET, () => db.getProfilePinnedKeys()],
    [IPC.PROFILE_PINS_SET, (_event, payload) => ({
      ok: true,
      keys: db.setProfilePinnedKeys(payload),
    })],
    [IPC.PROMPTS_LIST, () => listReadonlyPrompts({
      memorySummaryPrompt: db.getMemorySummarySystemPrompt(),
    })],
  ])

  registerIpcListenerEntries([
    [IPC.PET_HUD_EXPAND, (_e, requiredWidth) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const bounds = mainWindow.getBounds()
      const w = Math.max(bounds.width, Math.ceil(requiredWidth))
      if (w <= bounds.width) return
      mainWindow.setBounds({
        x: Math.round(bounds.x - (w - bounds.width) / 2),
        y: bounds.y,
        width: w,
        height: bounds.height,
      })
    }],
    [IPC.PET_HUD_SHRINK, () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const prefs = db.getPetUiPrefs()
      const { width } = getPetWindowSize(prefs.scale)
      const bounds = mainWindow.getBounds()
      if (bounds.width <= width) return
      mainWindow.setBounds({
        x: Math.round(bounds.x + (bounds.width - width) / 2),
        y: bounds.y,
        width,
        height: bounds.height,
      })
    }],
  ])
}

function registerLlmIpcHandlers() {
  registerIpcHandleEntries([
    [IPC.CHAT_GET_RECENT, (_event, payload) => {
      const limit = payload?.limit || 20
      const sessionId = String(payload?.sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID
      return db.getRecentChatMessages(limit, sessionId)
    }],
    [IPC.LLM_STREAM_CHAT, (event, payload) => {
      const prompt = payload?.prompt || ''
      const sessionId = String(payload?.sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID
      const charId = payload?.charId || ''

      return llmService.startStreamChat({
        prompt,
        sessionId,
        charId,
        sender: event.sender,
        onAfterDone: async () => {
          try {
            await memoryService.runSummaryIfNeeded({ sessionId, threshold: 20, maxMessages: 40 })
          } catch (error) {
            log.error('[memory-summary-auto]', error)
          } finally {
            sendToAllWindows(IPC.MEMORY_CONFLICT_REFRESH, { sessionId })
          }
        },
      })
    }],
    [IPC.LLM_CANCEL, (_event, payload) => ({
      canceled: llmService.cancel(payload?.requestId),
    })],
    [IPC.LLM_TEST_CONNECTION, async (_event, payload) => llmService.testConnection(payload || {})],
  ])
}

function registerVoiceIpcHandlers() {
  registerIpcHandleEntries([
    [IPC.VOICE_TRANSCRIBE, async (_event, payload) => voiceService.transcribeAudio(payload || {})],
    [IPC.VOICE_SYNTHESIZE, async (_event, payload) => voiceService.synthesize(payload || {})],
    [IPC.VOICE_TEST_CONNECTION, async (_event, payload) => voiceService.testConnection(payload || {})],
    [IPC.VOICE_STREAM_START, async (event, payload) => {
      return voiceService.startStreamSession(payload || {}, {
        onPartial: (data) => {
          event.sender.send(IPC.VOICE_STREAM_PARTIAL, data)
        },
        onFinal: (data) => {
          event.sender.send(IPC.VOICE_STREAM_FINAL, data)
        },
        onError: (data) => {
          event.sender.send(IPC.VOICE_STREAM_ERROR, data)
        },
      })
    }],
    [IPC.VOICE_STREAM_CHUNK, async (_event, payload) => voiceService.pushStreamChunk(payload || {})],
    [IPC.VOICE_STREAM_STOP, async (_event, payload) => voiceService.stopStreamSession(payload || {})],
    [IPC.VOICE_STREAM_CANCEL, async (_event, payload) => voiceService.cancelStreamSession(payload || {})],
  ])
}

function registerExportAndMemoryIpcHandlers() {
  function parseSummaryStructured(value) {
    const raw = String(value || '').trim()
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // ignore
    }
    return null
  }

  ipcMain.handle(IPC.EXPORT_DOCS, async (_event, payload) => {
    const result = await chooseExportDirectory()
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true }
    }
    const mode = String(payload?.mode || 'all').trim() || 'all'
    const allStrategy = String(payload?.allStrategy || 'merged').trim() || 'merged'
    const roleSessionId = String(payload?.roleSessionId || '').trim()
    const includeScopes = payload?.includeScopes && typeof payload.includeScopes === 'object'
      ? payload.includeScopes
      : undefined
    const formats = payload?.formats && typeof payload.formats === 'object'
      ? payload.formats
      : undefined
    return {
      canceled: false,
      ...exportService.exportToDirectory({
        mode,
        allStrategy,
        roleSessionId,
        includeScopes,
        formats,
        dirPath: result.filePaths[0],
      }),
    }
  })

  ipcMain.handle(IPC.MEMORY_LIST, (_, payload) => {
    const isLegacy = typeof payload === 'string'
    const query = isLegacy
      ? { sessionId: payload, limit: 5, offset: 0 }
      : (payload || {})
    const sid = String(query.sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID
    const result = typeof db.queryMemorySummariesForUI === 'function'
      ? db.queryMemorySummariesForUI({
        sessionId: sid,
        limit: query.limit,
        offset: query.offset,
        keyword: query.keyword,
        fromTs: query.fromTs,
        toTs: query.toTs,
      })
      : {
        items: db.getMemorySummariesForUI(sid),
        total: 0,
        limit: 0,
        offset: 0,
        hasMore: false,
      }

    const items = Array.isArray(result.items) ? result.items.map((item) => ({
      ...item,
      sessionId: sid,
      structured: parseSummaryStructured(item.structuredJson),
    })) : []

    if (isLegacy) return items
    return {
      items,
      total: Number(result.total || items.length || 0),
      limit: Number(result.limit || 0),
      offset: Number(result.offset || 0),
      hasMore: Boolean(result.hasMore),
    }
  })

  ipcMain.handle(IPC.MEMORY_DELETE, (_, id) => {
    db.softDeleteSummary(id)
    return { ok: true }
  })

  ipcMain.handle(IPC.MEMORY_CONFLICT_PENDING_GET, () => {
    return db.getPendingProfileConflictDecision()
  })

  ipcMain.handle(IPC.MEMORY_CONFLICT_COUNT_GET, () => {
    return { count: db.getPendingProfileConflictCount() }
  })

  ipcMain.handle(IPC.MEMORY_CONFLICT_RESOLVE, (_event, payload) => {
    const result = db.resolveProfileConflictDecision(payload?.id, payload?.action)
    sendToAllWindows(IPC.MEMORY_CONFLICT_REFRESH, { reason: 'resolved', action: payload?.action || '' })
    return result
  })
}

async function checkProactiveGreeting() {
  const now = Date.now()
  if (db.getAppStateValue('proactive_enabled') !== '1') {
    db.setAppStateValue('proactive_enabled', '1')
  }

  const todayUTC = new Date(now).toISOString().slice(0, 10)

  const lastOpenAt = parseInt(db.getAppStateValue('last_open_at') || '0', 10)
  const absentDays = lastOpenAt ? daysDiff(now, lastOpenAt) : 0
  const absenceLockKey = `proactive_absence_${todayUTC}`

  let proactiveType = null
  let daysSince = 0

  if (absentDays > 3 && !db.getAppStateValue(absenceLockKey)) {
    db.setAppStateValue(absenceLockKey, '1')
    proactiveType = 'absence'
    daysSince = absentDays
  }

  if (!proactiveType) {
    const birthday = db.getUserProfileField('birthday')
    if (birthday) {
      const todayMMDD = toLocalMMDD(now)
      const birthdayLockKey = `proactive_birthday_${todayUTC}`
      if (todayMMDD === birthday && !db.getAppStateValue(birthdayLockKey)) {
        db.setAppStateValue(birthdayLockKey, '1')
        proactiveType = 'birthday'
      }
    }
  }

  db.setAppStateValue('last_open_at', String(now))

  if (!proactiveType) return

  const charId = getCurrentCharId()
  const sessionId = `pet_${charId}`
  const chatSystemPrompt = db.getChatSystemPrompt(charId)

  try {
    const greeting = await llmService.generateProactiveGreeting({
      sessionId,
      proactiveType,
      daysSince,
      chatSystemPrompt,
    })
    if (!greeting) return

    db.addChatMessage('assistant', greeting, sessionId)
    openChatWindow({ charId })

    setTimeout(() => {
      sendToAllWindows(IPC.CHAT_RELOAD, { sessionId })
    }, 500)
  } catch (err) {
    log.warn('[proactive-greeting]', err.message)
    openChatWindow({ charId })
  }
}

function registerIpcHandlers() {
  registerMainWindowIpcHandlers()
  registerE2EIpcHandlers()
  registerChatWindowIpcHandlers()
  registerCharacterIpcHandlers()
  registerConfigIpcHandlers()
  registerLlmIpcHandlers()
  registerVoiceIpcHandlers()
  registerExportAndMemoryIpcHandlers()
}

app.whenReady().then(() => {
  log.info('app ready')
  registerIpcHandlers()
  createMainWindow()
  if (!isE2E) createTray()
})

app.on('second-instance', () => {
  showMainWindow()
})

app.on('window-all-closed', () => {
  // Keep app alive in tray.
})

app.on('before-quit', (event) => {
  if (isQuittingFlow) return

  isQuittingFlow = true
  log.info('app quitting')

  if (isE2E) return

  event.preventDefault()

  if (mainWindow) {
    mainWindow.webContents.send(IPC.FORCE_SAVE)
  }

  setTimeout(() => {
    const sessionIds = new Set(db.listAllSessionIds())
    if (sessionIds.size === 0) {
      sessionIds.add(DEFAULT_SESSION_ID)
    }
    db.listCharacters()
      .filter((item) => item.isActive)
      .forEach((item) => sessionIds.add(`pet_${item.id}`))
    const sessionIdList = Array.from(sessionIds)

    Promise.allSettled(
      sessionIdList.map((sessionId) => memoryService.runSummaryIfNeeded({
        sessionId,
        threshold: 20,
        maxMessages: 40,
        isQuitting: true,
      }))
    )
      .then((results) => {
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            const sid = sessionIdList[index]
            log.error(`[memory-summary-close:${sid}]`, result.reason)
          }
        })
      })
      .finally(() => {
        log.shutdown()
        app.quit()
      })
  }, 120)
})

app.on('activate', () => {
  showMainWindow()
})
