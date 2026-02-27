const crypto = require('crypto')
const log = require('../logger')

const RETRYABLE_MODE_STATUS = new Set([400, 404, 405, 415, 422])

class LlmService {
  constructor(db) {
    this.db = db
    this.activeRequests = new Map()
  }

  buildRuntimeContext(sessionId, maxContext, chatSystemPrompt) {
    const profile = this.db.getUserProfile()
    const summaries = this.db.getRecentMemorySummaries(5, sessionId)
    const recent = this.db.getRecentChatMessages(maxContext, sessionId)

    const systemMessages = [
      {
        role: 'system',
        content: chatSystemPrompt,
      },
    ]

    const profileEntries = Object.entries(profile).filter(([, value]) => String(value || '').trim())
    if (profileEntries.length > 0) {
      const profileText = profileEntries.map(([key, value]) => `${key}: ${value}`).join('\n')
      systemMessages.push({ role: 'system', content: `用户档案：\n${profileText}` })
    }

    if (summaries.length > 0) {
      const text = summaries.map((item, index) => `#${index + 1} ${item.summary}`).join('\n')
      systemMessages.push({ role: 'system', content: `长期记忆摘要（按时间从旧到新）：\n${text}` })
    }

    return systemMessages.concat(recent.map((item) => ({ role: item.role, content: item.content })))
  }

  buildConversationExcerpt(messages, prompt) {
    const turns = messages
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .slice(-8)
      .map((item) => `[${item.role}] ${item.content}`)
      .join('\n')

    return `用户当前输入：${prompt}\n最近对话：\n${turns || '（无）'}`
  }

  normalizeBaseUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '')
  }

  stripKnownSuffix(url) {
    return this.normalizeBaseUrl(url)
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/responses$/i, '')
  }

  resolveModeCandidates(baseUrl) {
    const normalized = this.normalizeBaseUrl(baseUrl)
    if (/\/chat\/completions$/i.test(normalized)) return ['chat', 'responses']
    return ['responses', 'chat']
  }

  buildRequestUrl(baseUrl, mode) {
    const normalized = this.normalizeBaseUrl(baseUrl)
    if (!normalized) return ''

    if (mode === 'chat') {
      if (/\/chat\/completions$/i.test(normalized)) return normalized
      const root = this.stripKnownSuffix(normalized)
      return `${root}/chat/completions`
    }

    if (/\/responses$/i.test(normalized)) return normalized
    const root = this.stripKnownSuffix(normalized)
    return `${root}/responses`
  }

  shouldRetryWithAnotherMode(error) {
    return Boolean(error && RETRYABLE_MODE_STATUS.has(error.httpStatus))
  }

  toResponsesInput(messages) {
    return (messages || []).map((item) => ({
      role: item.role,
      content: [
        {
          type: 'input_text',
          text: String(item.content || ''),
        },
      ],
    }))
  }

  buildRequestBody({ mode, credentials, messages, temperature, stream }) {
    const value = Number.isFinite(temperature) ? temperature : 0.2

    if (mode === 'chat') {
      return {
        model: credentials.model,
        temperature: value,
        stream: Boolean(stream),
        messages,
      }
    }

    return {
      model: credentials.model,
      temperature: value,
      stream: Boolean(stream),
      input: this.toResponsesInput(messages),
    }
  }

  buildHttpError(mode, status, errorText) {
    const text = String(errorText || '').slice(0, 320)
    const error = new Error(`LLM 请求失败 [${mode}] (${status}): ${text}`)
    error.httpStatus = status
    error.mode = mode
    return error
  }

  classifyStreamError(error) {
    const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : null
    const mode = String(error?.mode || '').trim().toLowerCase()
    const text = String(error?.message || error || '').toLowerCase()

    if (status === 401 || status === 403 || /unauthorized|invalid.*key|auth|权限|鉴权/.test(text)) {
      return { kind: 'auth', status, mode }
    }

    if ([404, 405, 415, 422].includes(status) || /endpoint|not found|completions|responses|路由|路径/.test(text)) {
      return { kind: 'endpoint', status, mode }
    }

    if (/timeout|timed out|超时/.test(text)) {
      return { kind: 'timeout', status, mode }
    }

    if (/fetch failed|network|econn|enotfound|dns|socket|断网|网络/.test(text)) {
      return { kind: 'network', status, mode }
    }

    return { kind: 'unknown', status, mode }
  }

  extractChatText(payload) {
    return String(payload?.choices?.[0]?.message?.content || '').trim()
  }

  extractResponsesText(payload) {
    if (!payload) return ''

    if (typeof payload.output_text === 'string') {
      return payload.output_text.trim()
    }

    if (Array.isArray(payload.output_text)) {
      return payload.output_text
        .map((item) => (typeof item === 'string' ? item : item?.text || ''))
        .join('')
        .trim()
    }

    const output = Array.isArray(payload.output) ? payload.output : []
    const collected = []
    output.forEach((item) => {
      const content = Array.isArray(item?.content) ? item.content : []
      content.forEach((part) => {
        if (part?.type === 'output_text' && typeof part?.text === 'string') {
          collected.push(part.text)
        }
      })
    })

    if (collected.length > 0) return collected.join('').trim()

    if (payload.response) {
      return this.extractResponsesText(payload.response)
    }

    return this.extractChatText(payload)
  }

  extractStreamTokenFromPayload(payload) {
    const chatToken = payload?.choices?.[0]?.delta?.content
    if (typeof chatToken === 'string' && chatToken) return chatToken

    if (payload?.type === 'response.output_text.delta' && typeof payload?.delta === 'string') {
      return payload.delta
    }

    if (typeof payload?.output_text_delta === 'string' && payload.output_text_delta) {
      return payload.output_text_delta
    }

    if (typeof payload?.delta === 'string' && payload.type && String(payload.type).includes('delta')) {
      return payload.delta
    }

    return ''
  }

  async requestNonStreamCompletionByMode({ credentials, mode, messages, temperature = 0.3, signal }) {
    const response = await fetch(this.buildRequestUrl(credentials.baseUrl, mode), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      signal,
      body: JSON.stringify(this.buildRequestBody({ mode, credentials, messages, temperature, stream: false })),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw this.buildHttpError(mode, response.status, errorText)
    }

    const payload = await response.json()
    const text = mode === 'chat'
      ? this.extractChatText(payload)
      : this.extractResponsesText(payload)

    return String(text || '').trim()
  }

  async requestNonStreamCompletion({ credentials, messages, temperature = 0.3, signal }) {
    const modes = this.resolveModeCandidates(credentials.baseUrl)
    let lastError = null

    for (let i = 0; i < modes.length; i += 1) {
      const mode = modes[i]
      try {
        return await this.requestNonStreamCompletionByMode({
          credentials,
          mode,
          messages,
          temperature,
          signal,
        })
      } catch (error) {
        lastError = error
        const canRetry = i < modes.length - 1 && this.shouldRetryWithAnotherMode(error)
        if (!canRetry) break
      }
    }

    throw new Error(`多智能体子请求失败: ${String(lastError?.message || lastError || '未知错误')}`)
  }

  async runMultiAgentPlanning({ credentials, messages, prompt, chatSystemPrompt, signal }) {
    const excerpt = this.buildConversationExcerpt(messages, prompt)

    const personaPrompt = `你是“角色风格代理”。职责：确保回复保持角色个性与语气一致。
当前角色设定：
${chatSystemPrompt}

请输出：
1) 推荐语气
2) 禁止踩雷表达
3) 一句示例开场
限制：80字以内，中文。`

    const taskPrompt = `你是“任务代理”。职责：提炼用户意图并给出最小可执行建议。
请输出：
1) 用户核心需求（1行）
2) 最佳回答结构（最多3点）
3) 一句行动建议
限制：100字以内，中文。`

    const safetyPrompt = `你是“安全代理”。职责：检查潜在风险并给安全改写意见。
请输出：
1) 风险级别（低/中/高）
2) 如有风险，给替代说法
限制：80字以内，中文。`

    const buildMessages = (systemPrompt) => ([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: excerpt },
    ])

    const [persona, task, safety] = await Promise.all([
      this.requestNonStreamCompletion({ credentials, messages: buildMessages(personaPrompt), temperature: 0.5, signal }),
      this.requestNonStreamCompletion({ credentials, messages: buildMessages(taskPrompt), temperature: 0.2, signal }),
      this.requestNonStreamCompletion({ credentials, messages: buildMessages(safetyPrompt), temperature: 0.2, signal }),
    ])

    return `【角色风格代理】\n${persona}\n\n【任务代理】\n${task}\n\n【安全代理】\n${safety}`
  }

  startStreamChat({ prompt, sessionId = 'default', charId = '', sender, onAfterDone }) {
    const text = String(prompt || '').trim()
    if (!text) throw new Error('消息不能为空')

    const credentials = this.db.getLlmCredentials()
    if (!credentials.apiKey) throw new Error('请先在设置里配置 API Key')

    this.db.addChatMessage('user', text, sessionId)

    const currentCharId = String(charId || this.db.getState().currentCharId || '').trim()
    const chatSystemPrompt = this.db.getChatSystemPrompt(currentCharId)
    const messages = this.buildRuntimeContext(sessionId, credentials.maxContext || 20, chatSystemPrompt)
    const requestId = crypto.randomUUID()
    const controller = new AbortController()

    this.activeRequests.set(requestId, controller)

    this.streamLoop({
      requestId,
      sender,
      controller,
      credentials,
      messages,
      prompt: text,
      chatSystemPrompt,
      sessionId,
      onAfterDone,
    })

    return { requestId }
  }

  async parseSsePayloads(response, onPayload) {
    if (!response.body) {
      throw new Error('LLM 返回空流')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const processBuffer = () => {
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')

        this._processSseEvent(rawEvent, onPayload)
      }
    }

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        buffer = buffer.replace(/\r\n/g, '\n')
        processBuffer()
      }

      // Flush any trailing event that ended with a single \n instead of \n\n
      const remaining = buffer.trim()
      if (remaining) {
        this._processSseEvent(remaining, onPayload)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
  }

  _processSseEvent(rawEvent, onPayload) {
    const dataLines = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())

    if (dataLines.length === 0) return
    const dataText = dataLines.join('')

    if (dataText === '[DONE]') return

    let payload
    try {
      payload = JSON.parse(dataText)
    } catch {
      log.warn('[llm-sse] malformed payload:', dataText)
      return
    }

    onPayload(payload)
  }

  async streamByMode({ requestId, sender, controller, credentials, messages, mode }) {
    const response = await fetch(this.buildRequestUrl(credentials.baseUrl, mode), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify(this.buildRequestBody({
        mode,
        credentials,
        messages,
        temperature: credentials.temperature,
        stream: true,
      })),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw this.buildHttpError(mode, response.status, errorText)
    }

    let assistantText = ''
    let completedText = ''

    await this.parseSsePayloads(response, (payload) => {
      if (payload?.type === 'response.completed') {
        completedText = this.extractResponsesText(payload?.response || payload)
      }

      const token = this.extractStreamTokenFromPayload(payload)
      if (!token) return

      assistantText += token
      sender.send('llm-stream-delta', { requestId, token })
    })

    if (!assistantText.trim() && mode === 'responses') {
      const fallbackText = completedText || await this.requestNonStreamCompletionByMode({
        credentials,
        mode,
        messages,
        temperature: credentials.temperature,
        signal: controller.signal,
      })

      if (fallbackText) {
        assistantText = fallbackText
        sender.send('llm-stream-delta', { requestId, token: fallbackText })
      }
    }

    return assistantText
  }

  async streamLoop({ requestId, sender, controller, credentials, messages, prompt, chatSystemPrompt, sessionId, onAfterDone }) {
    let assistantText = ''

    try {
      let finalMessages = messages

      if (credentials.multiAgentEnabled) {
        try {
          const agentBrief = await this.runMultiAgentPlanning({
            credentials,
            messages,
            prompt,
            chatSystemPrompt,
            signal: controller.signal,
          })
          finalMessages = messages.concat([
            {
              role: 'system',
              content: `你将作为总控助手，综合以下多智能体结论后直接回复用户，不要暴露“代理”细节。\n\n${agentBrief}`,
            },
          ])
        } catch {
          finalMessages = messages
        }
      }

      const modes = this.resolveModeCandidates(credentials.baseUrl)
      let lastError = null

      for (let i = 0; i < modes.length; i += 1) {
        const mode = modes[i]
        try {
          assistantText = await this.streamByMode({
            requestId,
            sender,
            controller,
            credentials,
            messages: finalMessages,
            mode,
          })
          lastError = null
          break
        } catch (error) {
          lastError = error
          const canRetry = i < modes.length - 1 && this.shouldRetryWithAnotherMode(error)
          if (!canRetry) break
        }
      }

      if (lastError) {
        throw lastError
      }

      if (assistantText.trim()) {
        this.db.addChatMessage('assistant', assistantText, sessionId)
      }

      sender.send('llm-stream-done', { requestId, text: assistantText })

      if (onAfterDone) {
        await onAfterDone()
      }
    } catch (error) {
      const aborted = error?.name === 'AbortError'
      if (!aborted) log.error('[llm-stream]', error)
      const typed = this.classifyStreamError(error)
      sender.send('llm-stream-error', {
        requestId,
        message: aborted ? '已取消生成' : String(error.message || error),
        aborted,
        kind: aborted ? 'aborted' : typed.kind,
        status: typed.status,
        mode: typed.mode,
      })
    } finally {
      this.activeRequests.delete(requestId)
    }
  }

  cancel(requestId) {
    const controller = this.activeRequests.get(requestId)
    if (!controller) return false
    controller.abort()
    this.activeRequests.delete(requestId)
    return true
  }

  async testConnection(overrides = {}) {
    const stored = this.db.getLlmCredentials()
    const credentials = { ...stored }

    if (overrides.baseUrl !== undefined) credentials.baseUrl = String(overrides.baseUrl || '').trim()
    if (overrides.model !== undefined) credentials.model = String(overrides.model || '').trim()
    if (overrides.temperature !== undefined) {
      const parsed = Number(overrides.temperature)
      if (Number.isFinite(parsed)) credentials.temperature = parsed
    }
    if (overrides.apiKey !== undefined) credentials.apiKey = String(overrides.apiKey || '').trim()

    if (!credentials.baseUrl) throw new Error('API URL 不能为空')
    if (!credentials.model) throw new Error('模型 ID 不能为空')
    if (!credentials.apiKey) throw new Error('请先填写 API Key')

    const messages = [
      { role: 'system', content: '你是连通测试助手。只需回复 ok。' },
      { role: 'user', content: 'ping' },
    ]

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12_000)
    const start = Date.now()

    try {
      const modes = this.resolveModeCandidates(credentials.baseUrl)
      let lastError = null

      for (let i = 0; i < modes.length; i += 1) {
        const mode = modes[i]
        try {
          const content = await this.requestNonStreamCompletionByMode({
            credentials,
            mode,
            messages,
            temperature: Number.isFinite(credentials.temperature) ? credentials.temperature : 0.2,
            signal: controller.signal,
          })

          return {
            ok: true,
            mode,
            model: credentials.model,
            latencyMs: Date.now() - start,
            message: content || 'ok',
          }
        } catch (error) {
          lastError = error
          const canRetry = i < modes.length - 1 && this.shouldRetryWithAnotherMode(error)
          if (!canRetry) break
        }
      }

      throw lastError || new Error('连通测试失败')
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('请求超时，请检查网络、API URL 或模型配置')
      }
      throw new Error(`连通测试失败: ${String(error?.message || error)}`)
    } finally {
      clearTimeout(timeout)
    }
  }

  async generateSummary(messages, sessionId = 'default') {
    if (!Array.isArray(messages) || messages.length === 0) return null

    const credentials = this.db.getLlmCredentials()
    if (!credentials.apiKey) return null

    const input = messages.map((item) => `[${item.role}] ${item.content}`).join('\n')

    const summarySystemPrompt = this.db.getMemorySummarySystemPrompt()
    const summary = await this.requestNonStreamCompletion({
      credentials,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: summarySystemPrompt,
        },
        {
          role: 'user',
          content: `会话ID: ${sessionId}\n请总结以下对话：\n${input}`,
        },
      ],
    })

    return String(summary || '').trim()
  }
}

module.exports = LlmService
