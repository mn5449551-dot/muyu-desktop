const PROMPT_IDS = Object.freeze({
  INPUT_REFUSAL: 'input_refusal',
  MEMORY_INJECTION_POLICY: 'memory_injection_policy',
  OUTPUT_SAFETY_REWRITE: 'output_safety_rewrite',
  OUTPUT_STYLE_REWRITE: 'output_style_rewrite',
  MEMORY_SUMMARY: 'memory_summary',
  PROFILE_EXTRACT: 'profile_extract',
  PROACTIVE_BIRTHDAY_REASON: 'proactive_birthday_reason',
  PROACTIVE_ABSENCE_REASON: 'proactive_absence_reason',
})

const PROMPT_CATALOG = Object.freeze({
  [PROMPT_IDS.INPUT_REFUSAL]: {
    title: '输入安全拒答话术',
    scope: 'safety',
    editable: false,
    description: '用户输入命中高风险时返回给用户的引导文案。',
    template: '这个请求我不能直接帮你处理。我们可以换成安全、合法的方式来解决，我也可以陪你一起拆解可执行的下一步。',
  },
  [PROMPT_IDS.MEMORY_INJECTION_POLICY]: {
    title: '记忆注入策略',
    scope: 'memory',
    editable: false,
    description: '约束模型使用短中长期记忆时的优先级与冲突规则。',
    template: `你在回复时必须遵守以下记忆使用优先级：
1) 用户当前输入（本轮）；
2) 最近对话上下文；
3) 用户档案（稳定信息）；
4) 关系状态；
5) 阶段记忆摘要（中期）。

执行规则：
- 若历史记忆与当前表达冲突，以当前表达为准。
- 记忆仅用于提升理解，不要生硬复读。
- 未被明确证实的信息，不得当作事实陈述。
- 对敏感或高风险话题，优先给温和、可执行、低风险建议。`,
  },
  [PROMPT_IDS.OUTPUT_SAFETY_REWRITE]: {
    title: '输出安全改写',
    scope: 'safety',
    editable: false,
    description: '模型输出存在风险时的改写指令。',
    template: '你是输出安全修正器。请把候选回复改写为安全、温和、可执行的一句话，不提供危险/违法/自伤细节。只输出改写后的句子，不要解释。',
  },
  [PROMPT_IDS.OUTPUT_STYLE_REWRITE]: {
    title: '输出风格改写',
    scope: 'style',
    editable: false,
    description: '模型输出出现人设漂移时的改写指令。',
    template: '你是角色风格修正器。请在不改变核心意思的前提下，把候选回复改写成与角色设定一致的一句话。只输出改写后的句子，不要解释。',
  },
  [PROMPT_IDS.MEMORY_SUMMARY]: {
    title: '中期记忆提取',
    scope: 'memory',
    editable: false,
    description: '从最近对话提炼长期有价值信息的系统提示词。',
    template: '你是中期记忆提取器。请提炼长期有价值信息（事实、偏好、目标、约束、约定），禁止寒暄复述与臆测。输出要简洁可复用，避免空泛表达。',
  },
  [PROMPT_IDS.PROFILE_EXTRACT]: {
    title: '长期档案提取',
    scope: 'memory',
    editable: false,
    description: '从会话文本抽取可落地到用户档案的数据字段。',
    template: `从以下对话中提取用户信息。
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
{conversationText}`,
  },
  [PROMPT_IDS.PROACTIVE_BIRTHDAY_REASON]: {
    title: '主动发话-生日触发',
    scope: 'proactive',
    editable: false,
    description: '生日触发时附加到上下文的系统原因文案。',
    template: '今天是用户的生日，请以真诚温暖的方式向用户送上生日祝福。',
  },
  [PROMPT_IDS.PROACTIVE_ABSENCE_REASON]: {
    title: '主动发话-缺席触发',
    scope: 'proactive',
    editable: false,
    description: '缺席回归触发时附加到上下文的系统原因文案。',
    template: '用户已 {daysSince} 天没有打开应用，请主动问候，表达想念或关心，语气自然不刻意。',
  },
})

function getPromptDef(id) {
  return PROMPT_CATALOG[String(id || '').trim()] || null
}

function getPromptText(id, fallback = '') {
  const def = getPromptDef(id)
  if (!def) return String(fallback || '')
  return String(def.template || fallback || '')
}

function renderPrompt(id, vars = {}, fallback = '') {
  const template = getPromptText(id, fallback)
  if (!template) return ''
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : ''
  ))
}

function listReadonlyPrompts({ memorySummaryPrompt = '' } = {}) {
  return Object.entries(PROMPT_CATALOG)
    .filter(([, def]) => !def.editable)
    .map(([id, def]) => ({
      id,
      title: def.title,
      scope: def.scope,
      description: def.description,
      editable: false,
      content: id === PROMPT_IDS.MEMORY_SUMMARY
        ? String(memorySummaryPrompt || def.template || '')
        : String(def.template || ''),
    }))
}

module.exports = {
  PROMPT_IDS,
  getPromptText,
  renderPrompt,
  listReadonlyPrompts,
}
