const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { app, dialog } = require('electron')
const log = require('../logger')

const MAX_BYTES = 5 * 1024 * 1024

const IMAGE_EXTENSIONS = new Set(['.webp', '.png'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav'])

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function normalizeType(type) {
  return type === 'audio' ? 'audio' : 'image'
}

function getFilters(type) {
  if (type === 'audio') {
    return [{ name: 'Audio', extensions: ['mp3', 'wav'] }]
  }
  return [{ name: 'Image', extensions: ['webp', 'png'] }]
}

function validateFile(type, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const allowed = type === 'audio' ? AUDIO_EXTENSIONS : IMAGE_EXTENSIONS
  if (!allowed.has(ext)) {
    throw new Error(type === 'audio' ? '仅支持 mp3/wav 音频' : '仅支持 webp/png 图片')
  }

  const stats = fs.statSync(filePath)
  if (stats.size > MAX_BYTES) {
    throw new Error('文件过大，单文件不能超过 5MB')
  }

  return ext
}

async function importAsset(type, characterId = 'custom') {
  const normalizedType = normalizeType(type)
  const result = await dialog.showOpenDialog({
    title: normalizedType === 'audio' ? '选择音频文件' : '选择图片文件',
    properties: ['openFile'],
    filters: getFilters(normalizedType),
  })

  if (result.canceled || !result.filePaths[0]) return null

  const sourcePath = result.filePaths[0]
  let extension
  try {
    extension = validateFile(normalizedType, sourcePath)
  } catch (err) {
    log.error('[asset-import]', err)
    throw err
  }

  const subDir = normalizedType === 'audio' ? 'audio' : 'images'
  const baseDir = path.join(app.getPath('userData'), 'assets', subDir)
  ensureDir(baseDir)

  const safeId = String(characterId || 'custom').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()
  const fileName = `char_${safeId}_${Date.now()}${extension}`
  const destination = path.join(baseDir, fileName)

  try {
    fs.copyFileSync(sourcePath, destination)
  } catch (err) {
    log.error('[asset-import]', err)
    throw err
  }

  return {
    filePath: destination,
    fileUrl: pathToFileURL(destination).href,
    fileName,
    size: fs.statSync(destination).size,
    type: normalizedType,
  }
}

module.exports = { importAsset }
