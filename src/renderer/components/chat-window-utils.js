function getSessionIdByCharId(charId) {
  return `pet_${String(charId || 'default')}`
}

function isMissingApiKeyError(message) {
  const text = String(message || '').toLowerCase()
  return text.includes('api key') || text.includes('apikey')
}

function parseStatusCode(value) {
  const n = Number(value)
  if (Number.isInteger(n) && n >= 100 && n <= 599) return n
  const text = String(value || '')
  const match = text.match(/\b([1-5]\d{2})\b/)
  return match ? Number(match[1]) : null
}

function resolveErrorKind({ message = '', kind = '', status = null }) {
  const normalizedKind = String(kind || '').trim().toLowerCase()
  if (normalizedKind === 'missing_key' || normalizedKind === 'auth' || normalizedKind === 'timeout' || normalizedKind === 'endpoint' || normalizedKind === 'network') {
    return normalizedKind
  }

  const text = String(message || '').toLowerCase()
  if (isMissingApiKeyError(text)) return 'missing_key'
  if (status === 401 || status === 403 || /unauthorized|invalid.*key|auth|权限|鉴权/.test(text)) return 'auth'
  if (/timeout|timed out|超时/.test(text)) return 'timeout'
  if ([404, 405, 415, 422].includes(status) || /not found|endpoint|路由|路径|completions|responses/.test(text)) return 'endpoint'
  if (/fetch failed|network|econn|enotfound|dns|socket|断网|网络/.test(text)) return 'network'
  return 'unknown'
}

function getRoleErrorMessage(charId, kind, detail = '') {
  const id = String(charId || '').trim()

  if (kind === 'missingKey') {
    const map = {
      baihu: '喵呜？本白虎没拿到钥匙，先收爪。',
      muyu: '咚——木鱼还没领到钥匙，先静音。',
      hamster_orange: '吱！仓鼠把钥匙滚丢了。',
      hamster_gray: '检测到 API Key 缺失。',
      frog: '呱，钥匙没带到场。',
      capybara: '先慢一点，钥匙还没放进来。',
      qinglong: '结论：缺少调用钥匙。',
      zhuque: '啾！火力钥匙未就位。',
      xuanwu: '当前风险：关键配置缺失。',
    }
    return map[id] || '钥匙还没配置，我先待机。'
  }

  const reason = String(detail || '未知错误').trim()
  const map = {
    baihu: `本白虎刚要吼就卡壳了：${reason}`,
    muyu: `木鱼这边回声中断：${reason}`,
    hamster_orange: `仓鼠频道打滑了：${reason}`,
    hamster_gray: `请求链路异常：${reason}`,
    frog: `呱，这一跳没跳过去：${reason}`,
    capybara: `先别慌，这边有点堵：${reason}`,
    qinglong: `异常已识别，原因：${reason}`,
    zhuque: `火花刚冒就熄了：${reason}`,
    xuanwu: `系统反馈异常：${reason}`,
  }
  return map[id] || reason
}

function buildVoiceErrorMessage(charId, message) {
  let reason = String(message || '语音服务异常')
  // Strip nested Electron IPC wrappers like:
  // "Error invoking remote method 'x': Error: Error invoking remote method 'y': Error: ..."
  for (let i = 0; i < 6; i += 1) {
    const next = reason
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '')
      .trim()
    if (next === reason) break
    reason = next
  }
  reason = reason.replace(/\s+/g, ' ').trim() || '语音服务异常'
  if (reason.length > 140) {
    reason = `${reason.slice(0, 140)}...`
  }
  const id = String(charId || '').trim()
  const map = {
    baihu: `本白虎嗓子卡住了：${reason}`,
    muyu: `木鱼这边收声失败：${reason}`,
    hamster_orange: `仓鼠语音频道掉线：${reason}`,
    hamster_gray: `语音链路异常：${reason}`,
    frog: `呱，语音这一跳没过去：${reason}`,
    capybara: `语音慢半拍了：${reason}`,
    qinglong: `语音异常，原因：${reason}`,
    zhuque: `语音火花熄了：${reason}`,
    xuanwu: `语音系统异常：${reason}`,
  }
  return map[id] || `语音功能暂不可用：${reason}`
}

function isAsrNoTextError(message) {
  const text = String(message || '').toLowerCase()
  return /未返回可识别文本|未识别到有效文本|录音内容|说得更清楚|语音过短|empty|no text/.test(text)
}

function buildVoiceNoTextHint(charId) {
  const id = String(charId || '').trim()
  const map = {
    baihu: '本白虎这下没听清，喵一声再说一次？',
    muyu: '木鱼这次没听清，慢一点再说一遍吧。',
    hamster_orange: '仓鼠耳朵抖了一下，刚刚那句没收全，再说一次呀。',
    hamster_gray: '识别到的有效语音不足，请再说一遍。',
    frog: '呱，刚刚那句有点轻，再来一次？',
    capybara: '这次声音有点糊，我们再试一遍。',
    qinglong: '本次语音信息不足，请重新说一遍。',
    zhuque: '啾，刚刚风太大没听清，再来一句！',
    xuanwu: '检测到语音内容不足，建议重试。',
  }
  return map[id] || '这次没听清，再说一次试试。'
}

function commonPrefixLength(left, right) {
  const a = String(left || '')
  const b = String(right || '')
  const size = Math.min(a.length, b.length)
  for (let i = 0; i < size; i += 1) {
    if (a[i] !== b[i]) return i
  }
  return size
}

function formatChatError(message) {
  const raw = String(message || '').replace(/\s+/g, ' ').trim()
  const stripped = raw
    .replace(/^连通测试失败[:：]\s*/i, '')
    .replace(/^请求失败[:：]\s*/i, '')
  const text = stripped || '请求失败'
  return text.length > 200 ? `${text.slice(0, 200)}...` : text
}

function getReasonLabel(kind, { status = null, mode = '', detail = '' } = {}) {
  const statusText = status ? `(${status})` : ''
  if (kind === 'auth') return `鉴权失败${statusText}`
  if (kind === 'timeout') return '请求超时'
  if (kind === 'endpoint') return `接口配置不匹配${statusText}${mode ? `/${mode}` : ''}`
  if (kind === 'network') return '网络连接异常'
  return detail || '请求失败'
}

function getErrorExplain(kind, { status = null, mode = '', detail = '' } = {}) {
  if (kind === 'missing_key') return '未检测到可用 API Key，本次请求未发出。'
  if (kind === 'auth') return `服务端返回鉴权错误${status ? `（${status}）` : ''}，常见于 Key 无效或无模型权限。`
  if (kind === 'timeout') return '等待模型响应超时，当前请求已中断。'
  if (kind === 'endpoint') return `API URL 与调用模式${mode ? `（${mode}）` : ''}可能不匹配或端点不存在。`
  if (kind === 'network') return '应用到模型服务的网络链路异常（DNS/代理/防火墙）。'
  return `模型服务返回异常：${detail || '未知错误'}`
}

function getErrorAdvice(kind) {
  if (kind === 'missing_key') return '点右上角「设」→ AI 配置，填写 API Key 后保存。'
  if (kind === 'auth') return '核对 API Key、模型 ID，并确认账号已开通该模型权限。'
  if (kind === 'timeout') return '先重试一次；若仍超时，检查网络或稍后再试。'
  if (kind === 'endpoint') return '检查 API URL 后缀：chat 用 /chat/completions，responses 用 /responses。'
  if (kind === 'network') return '检查网络和代理设置，确认可访问模型服务域名后再试。'
  return '重试一次；若持续失败，请把报错内容发给开发者排查。'
}

function buildChatErrorMessage({ charId, payload = {} }) {
  if (payload?.aborted) {
    return {
      text: '（已停止：本次请求已取消，可重试）',
      isError: false,
      missingKey: false,
    }
  }

  const pretty = formatChatError(payload?.message || '')
  const status = parseStatusCode(payload?.status) || parseStatusCode(pretty)
  const mode = String(payload?.mode || '').trim().toLowerCase()
  const kind = resolveErrorKind({ message: pretty, kind: payload?.kind, status })
  const missingKey = kind === 'missing_key'
  const roleLine = missingKey
    ? getRoleErrorMessage(charId, 'missingKey')
    : getRoleErrorMessage(charId, 'requestFailed', getReasonLabel(kind, { status, mode, detail: pretty }))

  return {
    text: `${roleLine}\n说明：${getErrorExplain(kind, { status, mode, detail: pretty })}\n建议：${getErrorAdvice(kind)}`,
    isError: true,
    missingKey,
  }
}

export {
  buildChatErrorMessage,
  buildVoiceErrorMessage,
  buildVoiceNoTextHint,
  commonPrefixLength,
  getSessionIdByCharId,
  isAsrNoTextError,
}
