import React from 'react'

function getPromptSummary(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  if (!raw) return '暂无系统提示词'
  return raw.length > 84 ? `${raw.slice(0, 84)}...` : raw
}

export default function RoleCardGrid({
  roles,
  selectedId,
  searchQuery,
  onSearchChange,
  onEdit,
}) {
  return (
    <div className="role-card-grid-wrap">
      <div className="role-toolbar">
        <input
          className="role-search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索角色（名称 / ID）"
          aria-label="搜索角色"
        />
      </div>

      <div className="role-grid">
        {roles.map((role) => (
          <button
            type="button"
            key={role.id}
            className={`role-card${role.id === selectedId ? ' is-selected' : ''}`}
            onClick={() => onEdit(role.id)}
            aria-label={`查看 ${role.name} 角色详情`}
          >
            <div className="role-card-media">
              {role.idleImg || role.hitImg ? (
                <img
                  className="role-avatar"
                  src={role.idleImg || role.hitImg}
                  alt={`${role.name}形象`}
                  loading="lazy"
                  draggable={false}
                />
              ) : (
                <div className="role-avatar role-avatar--placeholder" aria-hidden="true">
                  {(role.name || role.id || '?').slice(0, 1)}
                </div>
              )}
            </div>

            <header className="role-card-header">
              <div>
                <h3 className="role-card-title">{role.name}</h3>
                <p className="role-card-id">{role.id}</p>
              </div>
              <span className={`role-status ${role.isActive ? 'is-on' : 'is-off'}`}>
                {role.isActive ? '启用' : '停用'}
              </span>
            </header>

            <p className="role-card-summary">{getPromptSummary(role.chatSystemPrompt)}</p>
          </button>
        ))}

        {roles.length === 0 && (
          <div className="role-empty">
            未找到匹配角色
          </div>
        )}
      </div>
    </div>
  )
}
