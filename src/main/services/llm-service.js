const crypto = require('crypto')
const log = require('../logger')
const { PROMPT_IDS, getPromptText, renderPrompt } = require('../prompts/prompt-catalog')
const { classifyLlmError, buildErrorPayload } = require('./error-classifier')

const RETRYABLE_MODE_STATUS = new Set([400, 404, 405, 415, 422])
const FALLBACK_SESSION_ID = 'pet_baihu'
const MAX_RELEVANT_SUMMARIES = 3
const CHUNK_RELEASE_SIZE = 28

const MEMORY_INJECTION_POLICY_PROMPT = getPromptText(
  PROMPT_IDS.MEMORY_INJECTION_POLICY,
  `你在回复时必须遵守以下记忆使用优先级：
1) 用户当前输入（本轮）；
2) 最近对话上下文；
3) 用户档案（稳定信息）；
4) 关系状态；
5) 阶段记忆摘要（中期）。

执行规则：
- 若历史记忆与当前表达冲突，以当前表达为准。
- 记忆仅用于提升理解，不要生硬复读。
- 未被明确证实的信息，不得当作事实陈述。
- 对敏感或高风险话题，优先给温和、可执行、低风险建议。`
)

const RISK_INTENT_PATTERNS = [
  /怎么|如何|教我|帮我|写一份|给我一套|生成|组织|发动|策划|煽动|鼓动|号召|宣传|带节奏/i,
]

const RACE_HATE_TOPIC_PATTERNS = [
  /种族歧视|民族歧视|族群歧视|仇视.*种族|仇视.*民族|排斥.*种族|排斥.*民族|侮辱.*种族|侮辱.*民族/i,
]

const SOVEREIGNTY_ATTACK_TOPIC_PATTERNS = [
  /国家主权|分裂国家|主权完整|领土完整|主权争议|台独|港独|疆独|颠覆国家政权|分裂主义/i,
]

const OUTPUT_UNSAFE_PATTERNS = [
  /煽动.*种族歧视|鼓动.*种族歧视|组织.*种族歧视|宣传.*种族歧视/i,
  /煽动.*分裂国家|鼓动.*分裂国家|组织.*分裂国家|宣传.*分裂国家|支持.*台独|支持.*港独|支持.*疆独/i,
]

const SENTENCE_END_CHARS = new Set(['。', '！', '？', '!', '?', '；', ';', '\n'])
const SAFE_FALLBACK_TEXT = '这个话题我不能这样回答，但我可以帮你换个安全、可执行的方向。'
const SAFE_REGEN_SYSTEM_PROMPT = '请基于角色设定重写一版完整回复。要求：不得包含种族歧视煽动、国家主权攻击煽动等高风险表达；语气自然、简短、可执行。'
const SUMMARY_STRUCTURED_OUTPUT_PROMPT = `你是记忆结构化提取器。必须输出严格 JSON 对象，不要输出任何额外文字、markdown、解释。
字段要求：
- summary_text: string，1-120字，概括本轮要沉淀的关键信息
- facts: string[]，最多8条
- preferences: string[]，最多8条
- goals: string[]，最多8条
- constraints: string[]，最多8条
- todos: string[]，最多8条
- risks: string[]，最多8条
- confidence: number，0~1
若无内容请输出空数组，禁止编造。`
const SUMMARY_REPAIR_PROMPT = `你是 JSON 修复器。请把给定内容修复为合法 JSON 对象，并严格符合指定字段：
summary_text, facts, preferences, goals, constraints, todos, risks, confidence。
禁止输出 JSON 以外内容。`
const PROFILE_REPAIR_PROMPT = `你是 JSON 修复器。请把给定内容修复为合法 JSON 对象，并严格符合字段：
name, occupation, birthday, birthday_year, traits, notes_append。
禁止输出 JSON 以外内容。`

function extractKeywords(text, max = 8) {
  const words = String(text || '')
    .toLowerCase()
    .match(/[\u4e00-\u9fa5a-z0-9]{2,}/g) || []
  const filtered = words.filter((item) => !/^(今天|现在|这个|那个|就是|然后|我们|你们|他们|哈哈|好的|可以)$/.test(item))
  return Array.from(new Set(filtered)).slice(0, max)
}

function computeRelevanceScore(text, keywords = []) {
  if (!keywords.length) return 0
  const source = String(text || '').toLowerCase()
  return keywords.reduce((acc, keyword) => (
    acc + (source.includes(keyword) ? 1 : 0)
  ), 0)
}

function normalizeSessionId(input, fallback = FALLBACK_SESSION_ID) {
  const value = String(input || '').trim()
  return value || fallback
}

function parseJsonLoosely(rawText) {
  const text = String(rawText || '').trim()
  if (!text) return null

  try {
    const direct = JSON.parse(text)
    return direct && typeof direct === 'object' ? direct : null
  } catch {
    // continue
  }

  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    try {
      const parsed = JSON.parse(String(fencedMatch[1] || '').trim())
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      // continue
    }
  }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      // continue
    }
  }

  return null
}

function normalizeShortText(value, maxLen = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) : text
}

function normalizeStringList(input, maxItems = 8, maxLen = 48) {
  if (!Array.isArray(input)) return []
  const dedup = Array.from(new Set(
    input
      .map((item) => normalizeShortText(item, maxLen))
      .filter(Boolean)
  ))
  return dedup.slice(0, maxItems)
}

function normalizeConfidence(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  if (n < 0) return 0
  if (n > 1) return 1
  return Number(n.toFixed(2))
}

function normalizeStructuredSummary(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const summaryText = normalizeShortText(input.summary_text || input.summary || input.text, 120)
  const facts = normalizeStringList(input.facts)
  const preferences = normalizeStringList(input.preferences)
  const goals = normalizeStringList(input.goals)
  const constraints = normalizeStringList(input.constraints)
  const todos = normalizeStringList(input.todos)
  const risks = normalizeStringList(input.risks)
  const confidence = normalizeConfidence(input.confidence)

  const hasContent = Boolean(
    summaryText
    || facts.length
    || preferences.length
    || goals.length
    || constraints.length
    || todos.length
    || risks.length
  )
  if (!hasContent) return null

  return {
    summary_text: summaryText,
    facts,
    preferences,
    goals,
    constraints,
    todos,
    risks,
    confidence,
  }
}

function normalizeProfileExtraction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null

  const name = normalizeShortText(input.name, 60) || null
  const occupation = normalizeShortText(input.occupation, 80) || null
  const birthdayRaw = normalizeShortText(input.birthday, 10)
  const birthday = /^\d{2}-\d{2}$/.test(birthdayRaw) ? birthdayRaw : null
  const birthdayYearRaw = Number.parseInt(String(input.birthday_year ?? ''), 10)
  const birthdayYear = Number.isFinite(birthdayYearRaw) && birthdayYearRaw > 0 ? birthdayYearRaw : null
  const traits = normalizeStringList(input.traits, 16, 32)
  const notesAppend = normalizeShortText(input.notes_append, 500) || null

  return {
    name,
    occupation,
    birthday,
    birthday_year: birthdayYear,
    traits,
    notes_append: notesAppend,
  }
}

class LlmService {
  constructor(db) {
    this.db = db
    this.activeRequests = new Map()
  }

  async tryRequestByModes({ credentials, fallbackMessage, execute }) {
    const modes = this.resolveModeCandidates(credentials.baseUrl)
    let lastError = null

    for (let i = 0; i < modes.length; i += 1) {
      const mode = modes[i]
      try {
        return await execute(mode)
      } catch (error) {
        lastError = error
        const canRetry = i < modes.length - 1 && this.shouldRetryWithAnotherMode(error)
        if (!canRetry) break
      }
    }

    if (lastError) throw lastError
    throw new Error(fallbackMessage)
  }

  buildRuntimeContext(sessionId, maxContext, chatSystemPrompt, options = {}) {
    const sid = normalizeSessionId(sessionId, this.db.DEFAULT_SESSION_ID || FALLBACK_SESSION_ID)
    const profile = this.db.getUserProfile()
    const summaries = this.db.getRecentMemorySummaries(8, sid)
    const recent = this.db.getRecentChatMessages(maxContext, sid)
    const currentPrompt = String(options.currentPrompt || '').trim()
    const relevantSummaries = this.pickRelevantSummaries(summaries, currentPrompt, MAX_RELEVANT_SUMMARIES)

    const systemMessages = [
      {
        role: 'system',
        content: chatSystemPrompt,
      },
      {
        role: 'system',
        content: MEMORY_INJECTION_POLICY_PROMPT,
      },
    ]

    const profileEntries = Object.entries(profile).filter(([, value]) => String(value || '').trim())
    if (profileEntries.length > 0) {
      const profileText = profileEntries.map(([key, value]) => `${key}: ${value}`).join('\n')
      systemMessages.push({ role: 'system', content: `长期记忆（用户档案）：\n${profileText}` })
    }

    if (typeof this.db.getCharacterMemory === 'function') {
      const charMem = this.db.getCharacterMemory(sid)
      let stageText = ''
      if (charMem?.relationshipStage === 'close') {
        stageText = '是亲密的老朋友'
      } else if (charMem?.relationshipStage && charMem.relationshipStage !== 'new') {
        stageText = '已相识一段时间'
      }
      if (stageText) {
        systemMessages.push({ role: 'system', content: `与用户的关系：${stageText}` })
      }
    }

    if (relevantSummaries.length > 0) {
      const text = relevantSummaries.map((item, index) => `#${index + 1} ${item.summary}`).join('\n')
      systemMessages.push({ role: 'system', content: `中期记忆摘要（与当前问题相关）：\n${text}` })
    }

    return systemMessages.concat(recent.map((item) => ({ role: item.role, content: item.content })))
  }

  pickRelevantSummaries(summaries = [], prompt = '', limit = MAX_RELEVANT_SUMMARIES) {
    if (!Array.isArray(summaries) || summaries.length === 0) return []

    const keywords = extractKeywords(prompt)
    if (keywords.length === 0) {
      return summaries.slice(-limit)
    }

    const scored = summaries
      .map((item) => ({
        item,
        score: computeRelevanceScore(item.summary, keywords),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || (b.item.ts || 0) - (a.item.ts || 0))
      .slice(0, limit)
      .map((entry) => entry.item)
      .sort((a, b) => (a.ts || 0) - (b.ts || 0))

    if (scored.length > 0) return scored
    return summaries.slice(-limit)
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
    return this.tryRequestByModes({
      credentials,
      fallbackMessage: '非流式请求失败: 未知错误',
      execute: (mode) => this.requestNonStreamCompletionByMode({
        credentials,
        mode,
        messages,
        temperature,
        signal,
      }),
    })
  }

  detectInputRiskLevel(text) {
    const source = String(text || '').trim()
    if (!source) return 'L0'
    const hasIntent = RISK_INTENT_PATTERNS.some((pattern) => pattern.test(source))
    if (!hasIntent) return 'L0'

    const isRaceHate = RACE_HATE_TOPIC_PATTERNS.some((pattern) => pattern.test(source))
    const isSovereigntyAttack = SOVEREIGNTY_ATTACK_TOPIC_PATTERNS.some((pattern) => pattern.test(source))
    return (isRaceHate || isSovereigntyAttack) ? 'L3' : 'L0'
  }

  buildInputRefusal() {
    return getPromptText(
      PROMPT_IDS.INPUT_REFUSAL,
      '这个请求我不能直接帮你处理。我们可以换成安全、合法的方式来解决，我也可以陪你一起拆解可执行的下一步。'
    )
  }

  detectOutputRiskKind(text) {
    const source = String(text || '').trim()
    if (!source) return 'ok'
    if (OUTPUT_UNSAFE_PATTERNS.some((pattern) => pattern.test(source))) return 'unsafe'
    return 'ok'
  }

  splitReadySegments(text, force = false) {
    const source = String(text || '')
    if (!source) return { segments: [], rest: '' }

    const segments = []
    let start = 0

    for (let i = 0; i < source.length; i += 1) {
      if (!SENTENCE_END_CHARS.has(source[i])) continue
      const chunk = source.slice(start, i + 1)
      if (chunk.trim()) segments.push(chunk)
      start = i + 1
    }

    let rest = source.slice(start)
    if (!segments.length && !force && rest.length >= CHUNK_RELEASE_SIZE) {
      const chunk = rest.slice(0, CHUNK_RELEASE_SIZE)
      rest = rest.slice(CHUNK_RELEASE_SIZE)
      if (chunk.trim()) segments.push(chunk)
    }

    if (force && rest.trim()) {
      segments.push(rest)
      rest = ''
    }

    return { segments, rest }
  }

  emitTextAsDeltaStream({ sender, requestId, text }) {
    const source = String(text || '')
    if (!source.trim()) return
    const { segments } = this.splitReadySegments(source, true)
    const list = segments.length > 0 ? segments : [source]
    list.forEach((segment) => {
      sender.send('llm-stream-delta', { requestId, token: segment })
    })
  }

  checkOutputRiskForFullText(text) {
    return this.detectOutputRiskKind(text || '') !== 'ok'
  }

  async generateSafeAssistantText({
    credentials,
    messages,
    prompt,
    chatSystemPrompt,
    signal,
  }) {
    const firstText = String(await this.requestNonStreamCompletion({
      credentials,
      messages,
      temperature: credentials.temperature,
      signal,
    }) || '').trim()

    if (!this.checkOutputRiskForFullText(firstText)) {
      return firstText || SAFE_FALLBACK_TEXT
    }

    const regenMessages = messages.concat([
      { role: 'system', content: SAFE_REGEN_SYSTEM_PROMPT },
      { role: 'system', content: `角色设定：\n${chatSystemPrompt}` },
      { role: 'user', content: `用户输入：${prompt}` },
      { role: 'assistant', content: `上一版候选回复（未通过安全校验）：\n${firstText || '（空）'}` },
      { role: 'user', content: '请输出更安全的一版完整回复。' },
    ])

    const regenText = String(await this.requestNonStreamCompletion({
      credentials,
      messages: regenMessages,
      temperature: credentials.temperature,
      signal,
    }) || '').trim()

    if (!this.checkOutputRiskForFullText(regenText)) {
      return regenText || SAFE_FALLBACK_TEXT
    }

    return SAFE_FALLBACK_TEXT
  }

  startStreamChat({ prompt, sessionId = '', charId = '', sender, onAfterDone }) {
    const text = String(prompt || '').trim()
    if (!text) throw new Error('消息不能为空')
    const sid = normalizeSessionId(sessionId, this.db.DEFAULT_SESSION_ID || FALLBACK_SESSION_ID)

    const credentials = this.db.getLlmCredentials()
    if (!credentials.apiKey) throw new Error('请先在设置里配置 API Key')

    this.db.addChatMessage('user', text, sid)

    const currentCharId = String(charId || this.db.getState().currentCharId || '').trim()
    const chatSystemPrompt = this.db.getChatSystemPrompt(currentCharId)
    const requestId = crypto.randomUUID()
    const controller = new AbortController()

    this.activeRequests.set(requestId, controller)

    this.streamLoop({
      requestId,
      sender,
      controller,
      credentials,
      prompt: text,
      chatSystemPrompt,
      sessionId: sid,
      onAfterDone,
    })

    return { requestId }
  }

  async streamLoop({ requestId, sender, controller, credentials, prompt, chatSystemPrompt, sessionId, onAfterDone }) {
    let assistantText = ''

    try {
      const inputRisk = this.detectInputRiskLevel(prompt)

      if (inputRisk !== 'L0') {
        const refusal = this.buildInputRefusal()
        sender.send('llm-stream-delta', { requestId, token: refusal })
        sender.send('llm-stream-done', { requestId, text: refusal })
        this.db.addChatMessage('assistant', refusal, sessionId)
        return
      }

      const finalMessages = this.buildRuntimeContext(
        sessionId,
        credentials.maxContext || 20,
        chatSystemPrompt,
        { currentPrompt: prompt }
      )

      assistantText = await this.generateSafeAssistantText({
        credentials,
        messages: finalMessages,
        prompt,
        chatSystemPrompt,
        signal: controller.signal,
      })

      this.emitTextAsDeltaStream({
        sender,
        requestId,
        text: assistantText,
      })

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
      const classification = aborted
        ? {
          source: 'llm',
          kind: 'aborted',
          reasonCode: 'request_aborted',
          retryable: true,
          status: null,
          mode: '',
        }
        : classifyLlmError(error)
      sender.send('llm-stream-error', buildErrorPayload({
        requestId,
        message: aborted ? '已取消生成' : String(error.message || error),
        aborted,
        classification,
      }))
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
      return await this.tryRequestByModes({
        credentials,
        fallbackMessage: '连通测试失败',
        execute: async (mode) => {
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
        },
      })
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('请求超时，请检查网络、API URL 或模型配置')
      }
      throw new Error(`连通测试失败: ${String(error?.message || error)}`)
    } finally {
      clearTimeout(timeout)
    }
  }

  async generateSummary(messages, sessionId = '') {
    if (!Array.isArray(messages) || messages.length === 0) return null
    const sid = normalizeSessionId(sessionId, this.db.DEFAULT_SESSION_ID || FALLBACK_SESSION_ID)

    const credentials = this.db.getLlmCredentials()
    if (!credentials.apiKey) return null

    const input = messages.map((item) => `[${item.role}] ${item.content}`).join('\n')

    const summarySystemPrompt = this.db.getMemorySummarySystemPrompt()
    const requestText = `会话ID: ${sid}\n请总结以下对话：\n${input}`
    const firstRaw = await this.requestNonStreamCompletion({
      credentials,
      temperature: 0.2,
      messages: [
        { role: 'system', content: summarySystemPrompt },
        { role: 'system', content: SUMMARY_STRUCTURED_OUTPUT_PROMPT },
        { role: 'user', content: requestText },
      ],
    })

    let parsed = normalizeStructuredSummary(parseJsonLoosely(firstRaw))
    if (!parsed) {
      try {
        const repairedRaw = await this.requestNonStreamCompletion({
          credentials,
          temperature: 0.1,
          messages: [
            { role: 'system', content: SUMMARY_REPAIR_PROMPT },
            { role: 'user', content: String(firstRaw || '') },
          ],
        })
        parsed = normalizeStructuredSummary(parseJsonLoosely(repairedRaw))
      } catch (error) {
        log.warn('[summary-json-repair]', error?.message || String(error))
      }
    }

    if (parsed) {
      const summaryText = normalizeShortText(parsed.summary_text, 120)
        || normalizeShortText(
          []
            .concat(parsed.facts || [], parsed.preferences || [], parsed.goals || [], parsed.constraints || [], parsed.todos || [])
            .slice(0, 4)
            .join('；'),
          120
        )
      if (summaryText) {
        return {
          summaryText,
          structured: {
            ...parsed,
            summary_text: summaryText,
          },
        }
      }
    }

    const fallbackSummary = normalizeShortText(firstRaw, 120)
    if (!fallbackSummary) return null
    return {
      summaryText: fallbackSummary,
      structured: null,
    }
  }

  async generateProactiveGreeting({ sessionId, proactiveType, daysSince, chatSystemPrompt }) {
    const credentials = this.db.getLlmCredentials()
    if (!credentials.apiKey) return null

    const sid = normalizeSessionId(sessionId, this.db.DEFAULT_SESSION_ID || FALLBACK_SESSION_ID)
    const contextMessages = this.buildRuntimeContext(sid, 5, chatSystemPrompt)

    const reason = proactiveType === 'birthday'
      ? getPromptText(
        PROMPT_IDS.PROACTIVE_BIRTHDAY_REASON,
        '今天是用户的生日，请以真诚温暖的方式向用户送上生日祝福。'
      )
      : renderPrompt(
        PROMPT_IDS.PROACTIVE_ABSENCE_REASON,
        { daysSince: Number(daysSince) || 0 },
        `用户已 ${daysSince} 天没有打开应用，请主动问候，表达想念或关心，语气自然不刻意。`
      )
    contextMessages.push({ role: 'system', content: reason })
    contextMessages.push({ role: 'user', content: '（主动问候触发，无用户输入）' })

    const result = await this.requestNonStreamCompletion({
      credentials,
      temperature: 0.8,
      messages: contextMessages,
    })
    return String(result || '').trim() || null
  }

  async generateProfileExtraction(conversationText) {
    const input = String(conversationText || '').trim()
    if (!input) return null

    const credentials = this.db.getLlmCredentials()
    if (!credentials.apiKey) return null

    const prompt = renderPrompt(
      PROMPT_IDS.PROFILE_EXTRACT,
      { conversationText: input },
      `从以下对话中提取用户信息。
规则：
- 只提取对话中明确出现的内容，不推断，不猜测
- 没有的字段输出 null 或 []
- birthday 格式为 MM-DD（如 03-15），没有则 null
- birthday_year 为数字（如 1995），没有则 null

输出 JSON（不要输出其他内容）：
{
  "name": "...",
  "occupation": "...",
  "birthday": "...",
  "birthday_year": null,
  "traits": ["...", "..."],
  "notes_append": "..."
}

对话：
${input}`
    )

    const result = await this.requestNonStreamCompletion({
      credentials,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    })

    let extracted = normalizeProfileExtraction(parseJsonLoosely(result))
    if (extracted) return extracted

    let repairedRaw = ''
    try {
      repairedRaw = await this.requestNonStreamCompletion({
        credentials,
        temperature: 0.1,
        messages: [
          { role: 'system', content: PROFILE_REPAIR_PROMPT },
          { role: 'user', content: String(result || '') },
        ],
      })
    } catch (error) {
      log.warn('[profile-json-repair]', error?.message || String(error))
      return null
    }

    extracted = normalizeProfileExtraction(parseJsonLoosely(repairedRaw))
    return extracted
  }
}

module.exports = LlmService
