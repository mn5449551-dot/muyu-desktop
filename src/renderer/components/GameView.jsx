import React, { useCallback, useEffect, useRef, useState } from 'react'
import { findById, mergeCharacters } from '../../utils/characters'
import {
  createFloatText,
  createHitParticles,
  getMilestoneDialogue,
  getTapHudText,
  resolveScaleHotkeyAction,
  shouldStartDragging,
} from './game-view-utils'
import '../styles/game.css'

const DRAG_THRESHOLD_PX = 6
const HOTKEY_SCALE_STEP = 0.05
const PET_SCALE_MIN = 0.6
const PET_SCALE_MAX = 1.8

export default function GameView({ initialCount, initialChar, initialCharacters, initialReachedMilestones }) {
  const [characters, setCharacters] = useState(initialCharacters)
  const [char, setChar] = useState(initialChar)
  const [count, setCount] = useState(initialCount)
  const [isHit, setIsHit] = useState(false)
  const [shakeClass, setShakeClass] = useState('')
  const [squeezeClass, setSqueeze] = useState('')
  const [switchClass, setSwitchClass] = useState('')
  const [floatTexts, setFloatTexts] = useState([])
  const [particles, setParticles] = useState([])
  const [tapHud, setTapHud] = useState(null)
  const [milestoneBubble, setMilestoneBubble] = useState(null)
  const [reachedMilestones, setReachedMilestones] = useState(() => new Set(initialReachedMilestones || []))
  const [eventReady, setEventReady] = useState(false)

  const useARef = useRef(true)
  const quadrantRef = useRef(0)
  const lastWasRareRef = useRef(false)
  const rareIsPlayingRef = useRef(false)
  const pendingCountRef = useRef(initialCount)
  const currentCharIdRef = useRef(initialChar?.id || '')
  const forceInteractiveUntilRef = useRef(0)

  const hitTimerRef = useRef(null)
  const hudTimerRef = useRef(null)
  const milestoneBubbleTimerRef = useRef(null)
  const switchTimerRef = useRef(null)
  const switchResetTimerRef = useRef(null)

  const ephemeralTimersRef = useRef([])

  const mainAudioRef = useRef(null)
  const rareAudioRef = useRef(null)

  const pressActiveRef = useRef(false)
  const dragModeRef = useRef(false)
  const suppressTapRef = useRef(false)
  const pressStartPointRef = useRef({ x: 0, y: 0 })
  const pressVisibleTopInsetRef = useRef(0)
  const ignoreMouseRef = useRef(null)
  const hitAreasRef = useRef([])
  const dragLatestPosRef = useRef({ x: 0, y: 0 })
  const dragLastSentPosRef = useRef({ x: Number.NaN, y: Number.NaN })
  const dragRafRef = useRef(0)

  const refreshHitAreas = useCallback(() => {
    hitAreasRef.current = Array.from(document.querySelectorAll('[data-hit-area="1"]'))
  }, [])

  const forceInteractiveWindow = useCallback((durationMs = 320) => {
    const ms = Math.max(0, Number(durationMs) || 0)
    const until = Date.now() + ms
    forceInteractiveUntilRef.current = Math.max(forceInteractiveUntilRef.current, until)
    ignoreMouseRef.current = false
    window.electronAPI.setIgnoreMouse(false)
  }, [])

  const setupAudio = useCallback((nextChar) => {
    if (!mainAudioRef.current) {
      mainAudioRef.current = new Audio()
      rareAudioRef.current = new Audio()

      rareAudioRef.current.addEventListener('ended', () => { rareIsPlayingRef.current = false })
      rareAudioRef.current.addEventListener('error', () => { rareIsPlayingRef.current = false })
    }

    mainAudioRef.current.src = nextChar.mainAudio

    if (rareAudioRef.current) {
      const pool = nextChar.rareAudioPool
      const hasRare = (pool && pool.length > 0) || !!nextChar.rareAudio
      if (hasRare) {
        rareAudioRef.current.src = (pool && pool.length > 0) ? pool[0] : nextChar.rareAudio
      }
    }
  }, [])

  const playSound = useCallback((nextChar) => {
    if (rareIsPlayingRef.current) return

    const pool = nextChar.rareAudioPool
    const hasRare = (pool && pool.length > 0) || !!nextChar.rareAudio
    const useRare = hasRare && !lastWasRareRef.current && Math.random() < 0.02
    lastWasRareRef.current = useRare

    if (useRare && rareAudioRef.current) {
      const src = (pool && pool.length > 0)
        ? pool[Math.floor(Math.random() * pool.length)]
        : nextChar.rareAudio
      rareAudioRef.current.src = src
      rareIsPlayingRef.current = true
      rareAudioRef.current.currentTime = 0
      rareAudioRef.current.play().catch(() => { rareIsPlayingRef.current = false })
      return
    }

    if (mainAudioRef.current) {
      mainAudioRef.current.currentTime = 0
      mainAudioRef.current.play().catch(() => {})
    }
  }, [])

  const switchToChar = useCallback((nextChar) => {
    if (!nextChar) return
    const currentId = currentCharIdRef.current
    if (
      nextChar.id === currentId
      && !switchTimerRef.current
      && !switchResetTimerRef.current
    ) return

    if (switchTimerRef.current) clearTimeout(switchTimerRef.current)
    if (switchResetTimerRef.current) clearTimeout(switchResetTimerRef.current)

    setSwitchClass('switch-squish-out')

    switchTimerRef.current = setTimeout(() => {
      setChar(nextChar)
      currentCharIdRef.current = nextChar.id
      setupAudio(nextChar)
      rareIsPlayingRef.current = false
      lastWasRareRef.current = false
      setSwitchClass('switch-expand-in')
      window.electronAPI.setCurrentChar(nextChar.id)

      switchResetTimerRef.current = setTimeout(() => setSwitchClass(''), 160)
    }, 150)
  }, [setupAudio])

  const switchToCharById = useCallback((charId) => {
    const next = findById(charId, characters)
    if (!next || !next.isActive) return
    switchToChar(next)
  }, [characters, switchToChar])

  useEffect(() => {
    const unsubForceSave = window.electronAPI.onForceSave(() => {
      window.electronAPI.saveCount(pendingCountRef.current)
    })

    const handleUnload = () => window.electronAPI.saveCount(pendingCountRef.current)
    window.addEventListener('beforeunload', handleUnload)

    const unsubChars = window.electronAPI.onCharactersUpdated((rows) => {
      const merged = mergeCharacters(rows)
      setCharacters(merged)

      setChar((prev) => {
        const exact = findById(prev.id, merged)
        if (exact && exact.isActive) return exact
        const active = merged.filter((item) => item.isActive)
        const fallback = active[0] || exact
        if (fallback) window.electronAPI.setCurrentChar(fallback.id)
        return fallback || prev
      })
    })

    const unsubPetMenuAction = window.electronAPI.onPetMenuAction((payload) => {
      if (!payload?.type) return

      if (payload.type === 'toggle-chat') {
        window.electronAPI.openChatWindow({})
        return
      }

      if (payload.type === 'switch-char' && payload.charId) {
        forceInteractiveWindow()
        switchToCharById(payload.charId)
        return
      }

      if (payload.type === 'quick-menu-closed') {
        forceInteractiveWindow()
      }
    })

    setEventReady(true)

    return () => {
      setEventReady(false)
      unsubForceSave()
      unsubChars()
      unsubPetMenuAction()
      window.removeEventListener('beforeunload', handleUnload)
      if (hitTimerRef.current) clearTimeout(hitTimerRef.current)
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current)
      if (milestoneBubbleTimerRef.current) clearTimeout(milestoneBubbleTimerRef.current)
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current)
      if (switchResetTimerRef.current) clearTimeout(switchResetTimerRef.current)
      ephemeralTimersRef.current.forEach((id) => clearTimeout(id))
      ephemeralTimersRef.current = []
    }
  }, [forceInteractiveWindow, switchToCharById])

  useEffect(() => {
    if (char) setupAudio(char)
  }, [char, setupAudio])

  useEffect(() => {
    currentCharIdRef.current = char?.id || ''
  }, [char])

  useEffect(() => {
    refreshHitAreas()
  }, [char?.id, switchClass, refreshHitAreas])

  useEffect(() => {
    let rafPending = false

    const onMouseMove = (event) => {
      if (rafPending) return
      rafPending = true

      requestAnimationFrame(() => {
        rafPending = false

        if (Date.now() < forceInteractiveUntilRef.current) {
          if (ignoreMouseRef.current !== false) {
            ignoreMouseRef.current = false
            window.electronAPI.setIgnoreMouse(false)
          }
          return
        }

        let inside = dragModeRef.current
        if (!inside) {
          const hitAreas = hitAreasRef.current.filter((el) => el && el.isConnected)
          if (hitAreas.length === 0) {
            refreshHitAreas()
          }
          const activeAreas = hitAreas.length > 0 ? hitAreas : hitAreasRef.current
          inside = activeAreas.some((el) => {
            const r = el.getBoundingClientRect()
            return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom
          })
        }

        const nextIgnore = !inside
        if (ignoreMouseRef.current === nextIgnore) return
        ignoreMouseRef.current = nextIgnore
        window.electronAPI.setIgnoreMouse(nextIgnore)
      })
    }

    document.addEventListener('mousemove', onMouseMove)
    return () => document.removeEventListener('mousemove', onMouseMove)
  }, [refreshHitAreas])

  const flushDragMove = useCallback(() => {
    dragRafRef.current = 0
    const x = dragLatestPosRef.current.x
    const y = dragLatestPosRef.current.y
    if (dragLastSentPosRef.current.x === x && dragLastSentPosRef.current.y === y) return
    dragLastSentPosRef.current = { x, y }
    window.electronAPI.movePetDrag(x, y)
  }, [])

  const scheduleDragMove = useCallback((screenX, screenY) => {
    dragLatestPosRef.current = { x: screenX, y: screenY }
    if (dragRafRef.current) return
    dragRafRef.current = requestAnimationFrame(flushDragMove)
  }, [flushDragMove])

  const startDragging = useCallback((screenX, screenY) => {
    if (dragModeRef.current) return
    dragModeRef.current = true
    suppressTapRef.current = true
    dragLatestPosRef.current = { x: screenX, y: screenY }
    dragLastSentPosRef.current = { x: Number.NaN, y: Number.NaN }
    window.electronAPI.startPetDrag(
      pressStartPointRef.current.x,
      pressStartPointRef.current.y,
      pressVisibleTopInsetRef.current
    )
    ignoreMouseRef.current = false
    window.electronAPI.setIgnoreMouse(false)
    scheduleDragMove(screenX, screenY)
  }, [scheduleDragMove])

  const finishDragging = useCallback(() => {
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = 0
    }

    if (dragModeRef.current) {
      window.electronAPI.endPetDrag()
      dragModeRef.current = false

      setTimeout(() => {
        suppressTapRef.current = false
      }, 50)
    }

    pressActiveRef.current = false
    ignoreMouseRef.current = null
  }, [])

  const onCharMouseDown = useCallback((event) => {
    if (event.button !== 0) return

    event.preventDefault()
    event.stopPropagation()

    pressActiveRef.current = true
    dragModeRef.current = false
    pressStartPointRef.current = { x: event.screenX, y: event.screenY }
    const rect = event.currentTarget?.getBoundingClientRect?.()
    const topInset = Number(rect?.top)
    pressVisibleTopInsetRef.current = Number.isFinite(topInset) ? Math.max(0, Math.round(topInset)) : 0
  }, [])

  useEffect(() => {
    const onMove = (event) => {
      if (!pressActiveRef.current) return

      if (!dragModeRef.current && shouldStartDragging(
        pressStartPointRef.current,
        { x: event.screenX, y: event.screenY },
        DRAG_THRESHOLD_PX
      )) {
        startDragging(event.screenX, event.screenY)
        return
      }

      if (!dragModeRef.current) return
      scheduleDragMove(event.screenX, event.screenY)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', finishDragging)
    window.addEventListener('blur', finishDragging)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', finishDragging)
      window.removeEventListener('blur', finishDragging)
      finishDragging()
    }
  }, [finishDragging, scheduleDragMove, startDragging])

  const onTap = useCallback(() => {
    if (switchClass || !char) return

    const newCount = pendingCountRef.current + 1
    pendingCountRef.current = newCount

    useARef.current = !useARef.current
    const useA = useARef.current
    setShakeClass(useA ? 'shake-anim-a' : 'shake-anim-b')
    setSqueeze(useA ? 'squeeze-anim-a' : 'squeeze-anim-b')

    const q = quadrantRef.current
    quadrantRef.current = (q + 1) % 4
    const nextFloatText = createFloatText({
      count: newCount,
      charId: char.id,
      color: char.floatTextColor,
      quadrant: q,
    })

    setFloatTexts((prev) => prev.concat([nextFloatText]).slice(-6))

    ephemeralTimersRef.current.push(setTimeout(() => {
      setFloatTexts((prev) => prev.filter((item) => item.id !== nextFloatText.id))
    }, 1600))

    setParticles(createHitParticles(newCount))
    ephemeralTimersRef.current.push(setTimeout(() => setParticles([]), 700))

    setIsHit(true)
    setCount(newCount)
    const hudText = getTapHudText(newCount)
    setTapHud({ id: `hud_${newCount}_${Date.now()}`, text: hudText })

    if (hitTimerRef.current) clearTimeout(hitTimerRef.current)
    hitTimerRef.current = setTimeout(() => setIsHit(false), 300)

    if (hudTimerRef.current) clearTimeout(hudTimerRef.current)
    hudTimerRef.current = setTimeout(() => {
      setTapHud(null)
    }, 800)

    const dialogue = getMilestoneDialogue(newCount, char.id)
    if (dialogue && !reachedMilestones.has(newCount)) {
      setReachedMilestones((prev) => new Set([...prev, newCount]))
      window.electronAPI.saveReachedMilestone(newCount)
      setMilestoneBubble({ id: `ms_${newCount}`, text: dialogue })
      if (milestoneBubbleTimerRef.current) clearTimeout(milestoneBubbleTimerRef.current)
      milestoneBubbleTimerRef.current = setTimeout(() => setMilestoneBubble(null), 3100)
    }

    if (newCount % 10 === 0) window.electronAPI.saveCount(newCount)
    playSound(char)
  }, [char, switchClass, playSound, reachedMilestones])

  const showScaleHud = useCallback((scale) => {
    const value = Number(scale)
    if (!Number.isFinite(value)) return
    setTapHud({
      id: `hud_scale_${Date.now()}`,
      text: `大小 ${Math.round(value * 100)}%`,
    })
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current)
    hudTimerRef.current = setTimeout(() => {
      setTapHud(null)
    }, 800)
  }, [])

  useEffect(() => {
    const onKeyDown = async (event) => {
      const isModifierPressed = event.metaKey || event.ctrlKey
      if (!isModifierPressed || event.altKey) return

      const action = resolveScaleHotkeyAction(event)
      if (!action) return

      event.preventDefault()
      event.stopPropagation()

      try {
        const prefs = await window.electronAPI.getPetUiPrefs()
        const currentScale = Number(prefs?.scale)
        const atMin = Number.isFinite(currentScale) && currentScale <= PET_SCALE_MIN + 0.001
        const atMax = Number.isFinite(currentScale) && currentScale >= PET_SCALE_MAX - 0.001

        if (action === 'shrink' && atMin) {
          showScaleHud(currentScale)
          return
        }
        if (action === 'grow' && atMax) {
          showScaleHud(currentScale)
          return
        }

        if (action === 'reset') {
          const result = await window.electronAPI.resetPetScale()
          showScaleHud(result?.scale)
          return
        }

        const delta = action === 'grow' ? HOTKEY_SCALE_STEP : -HOTKEY_SCALE_STEP
        const result = await window.electronAPI.adjustPetScale(delta)
        showScaleHud(result?.scale)
      } catch {
        // Ignore hotkey failures to avoid interrupting interaction.
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showScaleHud])

  const onCharContextMenu = useCallback((event) => {
    event.preventDefault()
    event.stopPropagation()
    window.electronAPI.showPetQuickMenu({ x: event.clientX, y: event.clientY })
  }, [])

  const onCharClick = useCallback(() => {
    if (suppressTapRef.current) {
      suppressTapRef.current = false
      return
    }
    onTap()
  }, [onTap])

  if (!char) {
    return <div className="page" />
  }

  return (
    <div className="page" data-testid="pet-page" data-char-id={char.id} data-count={count} data-ready={eventReady ? '1' : '0'}>
      <div className={`shake-wrap ${shakeClass}`}>
        {milestoneBubble && (
          <div key={milestoneBubble.id} className="milestone-bubble">
            {milestoneBubble.text}
          </div>
        )}

        {tapHud && (
          <div key={tapHud.id} className="tap-hud">
            {tapHud.text}
          </div>
        )}

        {floatTexts.map((item) => (
          <div
            key={item.id}
            className="float-text"
            style={{ left: `${item.left}%`, top: `${item.top}%`, color: item.color }}
          >
            {item.text}
          </div>
        ))}

        {particles.map((item) => (
          <div
            key={item.id}
            className={`particle p-fly-${item.dir}`}
            style={{
              left: `${item.x}%`,
              top: `${item.y}%`,
              background: item.color,
              width: `${item.size}px`,
              height: `${item.size}px`,
            }}
          />
        ))}

        <div
          className="char-touch"
          data-testid="pet-character"
          data-hit-area="1"
          onMouseDown={onCharMouseDown}
          onClick={onCharClick}
          onContextMenu={onCharContextMenu}
        >
          <img
            className={`char-img ${squeezeClass} ${switchClass}`}
            src={isHit ? char.hitImg : char.idleImg}
            alt={char.name}
            draggable={false}
          />
        </div>

        <div
          data-testid="pet-state"
          data-char-id={char.id}
          data-count={count}
          data-ready={eventReady ? '1' : '0'}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}
