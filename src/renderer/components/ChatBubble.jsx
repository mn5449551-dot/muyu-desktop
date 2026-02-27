import React from 'react'

export default function ChatBubble({
  open,
  title,
  side = 'right',
  panelRef,
  messages,
  input,
  isStreaming,
  error,
  onClose,
  onInput,
  onSend,
  onCancel,
}) {
  if (!open) return null

  return (
    <div
      ref={panelRef}
      className={`chat-bubble chat-bubble--${side}`}
      data-hit-area="1"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="chat-header">
        <strong>{title || '角色小剧场'}</strong>
        <button className="chat-close" onClick={onClose} title="关闭聊天" aria-label="关闭聊天">
          ×
        </button>
      </div>

      <div className="chat-log">
        {messages.length === 0 && <div className="chat-empty">右键桌宠可再打开这里，随时聊两句。</div>}
        {messages.map((message) => (
          <div key={message.id} className={`chat-item chat-item--${message.role}`}>
            <span>{message.content || (message.role === 'assistant' ? '（正在想招）' : '')}</span>
          </div>
        ))}
      </div>

      {error && <div className="chat-error">{error}</div>}

      <div className="chat-input-row">
        <input
          className="chat-input"
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
          placeholder="说点什么..."
        />
        {isStreaming ? (
          <button className="chat-btn chat-btn--cancel" onClick={onCancel}>停</button>
        ) : (
          <button className="chat-btn" onClick={onSend}>发</button>
        )}
      </div>
    </div>
  )
}
