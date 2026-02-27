const fs = require('fs')
const path = require('path')

function parseApiDoc(raw) {
  const out = {
    appId: '',
    accessToken: '',
    dialogueModelId: '',
  }

  const lines = String(raw || '').split(/\r?\n/)
  lines.forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][\w-]*)\s*[:：]\s*(.*?)\s*$/)
    if (!match) return
    const key = String(match[1] || '').trim().toLowerCase()
    const value = String(match[2] || '').trim()
    if (!value) return

    if (key === 'appid') out.appId = value
    if (key === 'accesstoken' || key === 'access_token') out.accessToken = value
    if (key === 'duihua' || key === 'dialogue' || key === 'model') out.dialogueModelId = value
  })

  return out
}

function loadLiveVoiceConfig(projectRoot) {
  const root = projectRoot || process.cwd()
  const docPath = path.join(root, 'docs', 'api.md')
  if (!fs.existsSync(docPath)) {
    throw new Error(`缺少实时语音配置文件: ${docPath}`)
  }

  const parsed = parseApiDoc(fs.readFileSync(docPath, 'utf8'))
  if (!parsed.appId) {
    throw new Error(`docs/api.md 缺少 AppID 字段: ${docPath}`)
  }
  if (!parsed.accessToken) {
    throw new Error(`docs/api.md 缺少 AccessToken 字段: ${docPath}`)
  }

  return parsed
}

module.exports = {
  loadLiveVoiceConfig,
}

