import React from 'react'

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
  if (!open || !draft) return null

  const promptLength = String(draft.chatSystemPrompt || '').trim().length

  return (
    <div className="role-modal-backdrop" onClick={onClose}>
      <div className="role-modal" onClick={(event) => event.stopPropagation()}>
        <header className="role-modal-header">
          <div>
            <h2>编辑角色</h2>
            <p>{draft.name || draft.id || '新角色'}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭角色编辑弹窗">×</button>
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
            <button className="btn" onClick={onClose} disabled={isSaving}>取消</button>
            <button className="btn btn--primary" onClick={onSave} disabled={isSaving}>
              {isSaving ? '保存中...' : '保存角色'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
