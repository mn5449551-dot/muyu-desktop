import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ROLE_VOICE_EMOTION_OPTIONS, ROLE_VOICE_OPTIONS } from './settings-config-utils'

export default function RoleEditorModal({
  open,
  draft,
  isDirty,
  isSaving,
  onClose,
  onSave,
  onFieldChange,
  onImportField,
}) {
  const [previewText, setPreviewText] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [previewState, setPreviewState] = useState({ kind: 'idle', message: '' })
  const activeAudioRef = useRef(null)
  const previewTokenRef = useRef(0)

  const stopPreview = useCallback(() => {
    previewTokenRef.current += 1
    const audio = activeAudioRef.current
    if (audio) {
      audio.pause()
      audio.src = ''
      activeAudioRef.current = null
    }
    setPreviewing(false)
  }, [])

  useEffect(() => {
    if (!open || !draft) return
    stopPreview()
    setPreviewState({ kind: 'idle', message: '' })
    setPreviewText(`你好，我是${draft.name || draft.id || '你的桌宠'}，很高兴认识你。`)
  }, [draft?.id, open, stopPreview])

  useEffect(() => {
    return () => stopPreview()
  }, [stopPreview])

  if (!open || !draft) return null

  const promptLength = String(draft.chatSystemPrompt || '').trim().length
  const closeAndStopPreview = () => {
    stopPreview()
    onClose()
  }

  const playVoicePreview = async () => {
    if (previewing) {
      stopPreview()
      setPreviewState({ kind: 'idle', message: '已停止试听' })
      return
    }

    const text = String(previewText || '').trim()
    if (!text) {
      setPreviewState({ kind: 'error', message: '请先输入试听文本' })
      return
    }

    try {
      setPreviewing(true)
      setPreviewState({ kind: 'testing', message: '音色生成中...' })
      const token = Date.now()
      previewTokenRef.current = token

      const result = await window.electronAPI.synthesizeVoice({
        text,
        charId: String(draft.id || ''),
        voiceType: String(draft.voiceType || ''),
        emotion: draft.voiceEmotion === 'auto' ? '' : String(draft.voiceEmotion || ''),
      })

      if (previewTokenRef.current !== token) return
      const audioBase64 = String(result?.audioBase64 || '')
      if (!audioBase64) {
        throw new Error('未返回可播放音频')
      }

      const mimeType = String(result?.mimeType || 'audio/mpeg')
      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`)
      activeAudioRef.current = audio
      audio.onended = () => {
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null
        }
        setPreviewing(false)
        setPreviewState({ kind: 'success', message: '试听完成' })
      }
      audio.onerror = () => {
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null
        }
        setPreviewing(false)
        setPreviewState({ kind: 'error', message: '试听播放失败，请重试' })
      }

      const emotionTag = result?.emotion || draft.voiceEmotion || 'auto'
      const voiceTag = String(result?.voiceType || draft.voiceType || '').trim()
      setPreviewState({ kind: 'success', message: `试听中 · ${voiceTag || '默认音色'} · ${emotionTag}` })
      await audio.play()
    } catch (error) {
      setPreviewing(false)
      setPreviewState({ kind: 'error', message: `试听失败：${error?.message || String(error)}` })
    }
  }

  return (
    <div className="role-modal-backdrop" onClick={closeAndStopPreview}>
      <div className="role-modal" onClick={(event) => event.stopPropagation()}>
        <header className="role-modal-header">
          <div>
            <h2>编辑角色</h2>
            <p>{draft.name || draft.id || '新角色'}</p>
          </div>
          <button className="modal-close" onClick={closeAndStopPreview} aria-label="关闭角色编辑弹窗">×</button>
        </header>

        <div className="role-modal-grid">
          <section className="role-modal-section">
            <h3>基础信息</h3>
            <div className="form-grid">
              <label>
                ID
                <input value={draft.id} readOnly />
              </label>
              <label>名称<input value={draft.name} onChange={(e) => onFieldChange('name', e.target.value)} /></label>
              <label>排序<input type="number" value={draft.sortOrder} onChange={(e) => onFieldChange('sortOrder', e.target.value)} /></label>
              <label>动画类型<input value={draft.animationType} onChange={(e) => onFieldChange('animationType', e.target.value)} /></label>
              <label>浮字颜色<input value={draft.floatTextColor} onChange={(e) => onFieldChange('floatTextColor', e.target.value)} /></label>
              <label className="checkbox-row">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => onFieldChange('isActive', e.target.checked)} />
                启用角色
              </label>
            </div>

            <section className="voice-config-block" aria-label="角色音色配置">
              <div className="voice-config-head">
                <h4>音色与情绪</h4>
                <p>可切换并立即试听，优先推荐情绪表现更明显的音色。</p>
              </div>
              <div className="form-grid">
                <label>
                  音色
                  <select
                    data-testid="role-voice-type"
                    value={draft.voiceType || ''}
                    onChange={(event) => onFieldChange('voiceType', event.target.value)}
                  >
                    {ROLE_VOICE_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label} · {item.tone}</option>
                    ))}
                  </select>
                </label>
                <label>
                  默认情绪
                  <select
                    data-testid="role-voice-emotion"
                    value={draft.voiceEmotion || 'auto'}
                    onChange={(event) => onFieldChange('voiceEmotion', event.target.value)}
                  >
                    {ROLE_VOICE_EMOTION_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                试听文本
                <input
                  data-testid="role-voice-preview-text"
                  value={previewText}
                  onChange={(event) => setPreviewText(event.target.value)}
                  placeholder="输入你想试听的文本"
                />
              </label>

              <div className="voice-preview-row">
                <button
                  data-testid="role-voice-preview-btn"
                  className="btn"
                  type="button"
                  onClick={playVoicePreview}
                >
                  {previewing ? '停止试听' : '试听音色'}
                </button>
                {previewState.kind !== 'idle' && (
                  <span className={`voice-preview-status voice-preview-status--${previewState.kind}`}>
                    {previewState.message}
                  </span>
                )}
              </div>
            </section>

            <details className="advanced-block">
              <summary>高级资源配置</summary>
              <div className="asset-grid">
                <div>
                  <label>静态图 URL<input value={draft.idleImg} onChange={(e) => onFieldChange('idleImg', e.target.value)} /></label>
                  <button className="btn" onClick={() => onImportField('idleImg', 'image')}>上传静态图</button>
                </div>
                <div>
                  <label>击打图 URL<input value={draft.hitImg} onChange={(e) => onFieldChange('hitImg', e.target.value)} /></label>
                  <button className="btn" onClick={() => onImportField('hitImg', 'image')}>上传击打图</button>
                </div>
                <div>
                  <label>主音效 URL<input value={draft.mainAudio} onChange={(e) => onFieldChange('mainAudio', e.target.value)} /></label>
                  <button className="btn" onClick={() => onImportField('mainAudio', 'audio')}>上传主音效</button>
                </div>
                <div>
                  <label>稀有音效 URL<input value={draft.rareAudio} onChange={(e) => onFieldChange('rareAudio', e.target.value)} /></label>
                  <button className="btn" onClick={() => onImportField('rareAudio', 'audio')}>上传稀有音效</button>
                </div>
              </div>

              <label>稀有音效池（每行一个 URL）
                <textarea
                  rows={4}
                  value={draft.rareAudioPoolText}
                  onChange={(e) => onFieldChange('rareAudioPoolText', e.target.value)}
                />
              </label>
            </details>
          </section>

          <section className="role-modal-section role-modal-section--prompt">
            <div className="prompt-head">
              <h3>角色系统提示词</h3>
              <span className="prompt-counter">{promptLength}/1200</span>
            </div>
            <textarea
              className="prompt-editor"
              rows={16}
              value={draft.chatSystemPrompt}
              onChange={(e) => onFieldChange('chatSystemPrompt', e.target.value)}
              placeholder="用于定义该角色聊天风格、行为边界、语言个性"
            />
            <p className="field-hint">要求 20-1200 字。建议包含：语气、行为规则、边界条件、禁区。</p>
          </section>
        </div>

        <footer className="role-modal-footer">
          <div className="dirty-indicator">{isDirty ? '有未保存修改' : '内容已同步'}</div>
          <div className="button-row">
            <button className="btn" onClick={closeAndStopPreview} disabled={isSaving}>取消</button>
            <button className="btn btn--primary" onClick={onSave} disabled={isSaving}>
              {isSaving ? '保存中...' : '保存角色'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
