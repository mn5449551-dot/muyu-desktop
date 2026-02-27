import React, { useEffect, useMemo, useState } from 'react'
import GameView from './components/GameView'
import SettingsView from './components/SettingsView'
import ChatWindowView from './components/ChatWindowView'
import { findById, mergeCharacters } from '../utils/characters'

function getCurrentView() {
  const search = new URLSearchParams(window.location.search)
  return search.get('view') || 'game'
}

export default function App() {
  const view = useMemo(() => getCurrentView(), [])
  const [initialState, setInitialState] = useState(null)

  useEffect(() => {
    if (view !== 'game') return

    Promise.all([
      window.electronAPI.getState(),
      window.electronAPI.listCharacters(),
    ]).then(([state, rows]) => {
      const characters = mergeCharacters(rows)
      setInitialState({
        count: state.count,
        characters,
        char: findById(state.currentCharId, characters),
      })
    })
  }, [view])

  if (view === 'settings') {
    return <SettingsView />
  }

  if (view === 'chat') {
    return <ChatWindowView />
  }

  // 加载中显示占位块，避免透明窗口完全不可见
  if (!initialState) {
    return (
      <div style={{
        width: '240px',
        height: '340px',
        background: 'transparent',
      }} />
    )
  }

  return (
    <GameView
      initialCount={initialState.count}
      initialChar={initialState.char}
      initialCharacters={initialState.characters}
    />
  )
}
