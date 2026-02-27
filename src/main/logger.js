const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const isDev = !app.isPackaged

let _stream = null
let _currentDate = ''
let _logDir = ''
let _minLevel = isDev ? LEVELS.debug : LEVELS.info

if (process.env.LOG_LEVEL && LEVELS[process.env.LOG_LEVEL] !== undefined) {
  _minLevel = LEVELS[process.env.LOG_LEVEL]
}

function getLogDir() {
  if (!_logDir) {
    _logDir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(_logDir, { recursive: true })
  }
  return _logDir
}

function todayStr() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function ensureStream() {
  const today = todayStr()
  if (_stream && _currentDate === today) return _stream

  if (_stream) {
    try { _stream.end() } catch {}
  }

  const filePath = path.join(getLogDir(), `muyu-${today}.log`)
  _stream = fs.createWriteStream(filePath, { flags: 'a' })
  _currentDate = today
  return _stream
}

function formatMessage(level, args) {
  const ts = new Date().toISOString()
  const tag = level.toUpperCase()
  const parts = args.map((arg) => {
    if (arg instanceof Error) return `${arg.message}\n${arg.stack || ''}`
    if (typeof arg === 'object') {
      try { return JSON.stringify(arg) } catch { return String(arg) }
    }
    return String(arg)
  })
  return `[${ts}] [${tag}] ${parts.join(' ')}\n`
}

function writeLog(level, args) {
  if (LEVELS[level] < _minLevel) return

  const line = formatMessage(level, args)

  try {
    const stream = ensureStream()
    stream.write(line)
  } catch {}

  const consoleFn = level === 'error' ? console.error
    : level === 'warn' ? console.warn
      : level === 'debug' ? console.debug
        : console.log
  consoleFn(line.trimEnd())
}

function cleanOldLogs() {
  try {
    const dir = getLogDir()
    const cutoff = Date.now() - MAX_AGE_MS
    const files = fs.readdirSync(dir)
    files.forEach((name) => {
      if (!name.startsWith('muyu-') || !name.endsWith('.log')) return
      const filePath = path.join(dir, name)
      try {
        const stat = fs.statSync(filePath)
        if (stat.mtimeMs < cutoff) fs.unlinkSync(filePath)
      } catch {}
    })
  } catch {}
}

function shutdown() {
  if (!_stream) return
  try {
    _stream.end()
  } catch {}
  _stream = null
}

// Run cleanup on module load
cleanOldLogs()

module.exports = {
  debug: (...args) => writeLog('debug', args),
  info: (...args) => writeLog('info', args),
  warn: (...args) => writeLog('warn', args),
  error: (...args) => writeLog('error', args),
  shutdown,
}
