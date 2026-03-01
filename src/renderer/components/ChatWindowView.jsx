import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findById, mergeCharacters } from '../../utils/characters'
import {
  buildChatErrorMessage,
  buildVoiceErrorMessage,
  buildVoiceNoTextHint,
  commonPrefixLength,
  getSessionIdByCharId,
  isAsrNoTextError,
} from './chat-window-utils'
import '../styles/chat-window.css'

const PCM_TARGET_SAMPLE_RATE = 16000
const PCM_CHUNK_MS = 100
const PCM_CHUNK_SAMPLES = Math.round((PCM_TARGET_SAMPLE_RATE * PCM_CHUNK_MS) / 1000)
const PROFILE_CONFLICT_FIELD_LABELS = Object.freeze({
  name: '姓名',
  occupation: '职业',
  birthday: '生日',
  birthday_year: '出生年份',
})

function buildMissingApiKeyHint(charId) {
  return buildChatErrorMessage({
    charId,
    payload: {
      source: 'llm',
      kind: 'missing_key',
      reasonCode: 'llm_missing_api_key',
      message: '请先在设置里配置 API Key',
    },
  })
}

function isVoiceInputLocked({
  recording = false,
  transcribing = false,
  voiceSessionBusy = false,
  activeVoiceSessionId = '',
} = {}) {
  return Boolean(recording || transcribing || voiceSessionBusy || String(activeVoiceSessionId || '').trim())
}

function buildVoiceInputPrefix(baseInput = '') {
  const normalized = String(baseInput || '')
  return normalized && !/\s$/.test(normalized) ? `${normalized} ` : normalized
}

function buildChatStatusText({
  recording = false,
  transcribing = false,
  voiceSessionBusy = false,
  error = '',
  voiceHint = '',
  speaking = false,
  voiceAutoPlay = true,
} = {}) {
  if (recording) {
    return {
      kind: 'info',
      text: '录音中，识别内容会实时写入输入框',
    }
  }
  if (transcribing) {
    return {
      kind: 'info',
      text: '录音已结束，正在收尾识别...',
    }
  }
  if (voiceSessionBusy) {
    return {
      kind: 'info',
      text: '语音处理中，请稍候...',
    }
  }
  if (error) {
    return {
      kind: 'error',
      text: '出现错误，请查看上方消息详情',
    }
  }
  if (voiceHint) {
    return {
      kind: 'warn',
      text: voiceHint,
    }
  }
  if (speaking) {
    return {
      kind: 'info',
      text: '正在语音播报',
    }
  }
  return {
    kind: 'neutral',
    text: `语音播放${voiceAutoPlay ? '开' : '关'} · 点击“语”开始录音`,
  }
}

function downsampleFloat32Buffer(source, inputRate, outputRate) {
  const input = source instanceof Float32Array ? source : Float32Array.from(source || [])
  if (!input.length) return new Float32Array(0)
  const fromRate = Number(inputRate) || outputRate
  const toRate = Number(outputRate) || fromRate
  if (fromRate === toRate) return input

  const ratio = fromRate / toRate
  const outputLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(outputLength)

  let offsetInput = 0
  for (let i = 0; i < outputLength; i += 1) {
    const nextOffset = Math.min(input.length, Math.round((i + 1) * ratio))
    let sum = 0
    let count = 0
    for (let j = offsetInput; j < nextOffset; j += 1) {
      sum += input[j]
      count += 1
    }
    output[i] = count ? sum / count : input[Math.min(offsetInput, input.length - 1)] || 0
    offsetInput = nextOffset
  }

  return output
}

function float32ToInt16(float32Buffer) {
  const input = float32Buffer instanceof Float32Array ? float32Buffer : Float32Array.from(float32Buffer || [])
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    out[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff)
  }
  return out
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function pcmChunkToBase64(chunk) {
  const view = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  return bytesToBase64(view)
}

function buildWavDataUrl(chunks, sampleRate = PCM_TARGET_SAMPLE_RATE) {
  const validChunks = Array.isArray(chunks) ? chunks.filter((item) => item && item.length > 0) : []
  const totalSamples = validChunks.reduce((sum, item) => sum + item.length, 0)
  if (!totalSamples) return ''

  const bytesPerSample = 2
  const dataSize = totalSamples * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  validChunks.forEach((chunk) => {
    for (let i = 0; i < chunk.length; i += 1) {
      view.setInt16(offset, chunk[i], true)
      offset += 2
    }
  })

  const base64 = bytesToBase64(new Uint8Array(buffer))
  return `data:audio/wav;base64,${base64}`
}

function normalizeIncomingText(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (!value || typeof value !== 'object') return ''

  const direct = typeof value.text === 'string' ? value.text : ''
  if (direct) return direct

  if (Array.isArray(value.result)) {
    const merged = value.result
      .map((item) => (typeof item?.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('')
    if (merged) return merged
  }

  if (typeof value.result?.text === 'string') return value.result.text
  return ''
}

function resolveUtteranceList(payload) {
  const source = payload && typeof payload === 'object' ? payload : {}
  if (Array.isArray(source.utterances)) return source.utterances
  if (Array.isArray(source?.result?.utterances)) return source.result.utterances
  if (Array.isArray(source?.text?.utterances)) return source.text.utterances
  return []
}

function normalizeUtteranceTime(item, directKey, legacyKey) {
  const directValue = Number(item?.[directKey])
  if (Number.isFinite(directValue)) return directValue
  const legacyValue = Number(item?.[legacyKey])
  if (Number.isFinite(legacyValue)) return legacyValue
  return null
}

function normalizeIncomingUtterances(payload) {
  const list = resolveUtteranceList(payload)
  if (!Array.isArray(list) || list.length === 0) return []

  return list
    .map((item) => {
      const text = typeof item?.text === 'string' ? item.text.trim() : ''
      if (!text) return null
      return {
        text,
        definite: Boolean(item?.definite),
        startTime: normalizeUtteranceTime(item, 'startTime', 'start_time'),
        endTime: normalizeUtteranceTime(item, 'endTime', 'end_time'),
      }
    })
    .filter(Boolean)
}

function joinUtteranceTexts(utterances, definite) {
  if (!Array.isArray(utterances) || utterances.length === 0) return ''
  return utterances
    .filter((item) => Boolean(item?.definite) === Boolean(definite))
    .map((item) => String(item?.text || ''))
    .filter(Boolean)
    .join('')
}

export default function ChatWindowView() {
  const [characters, setCharacters] = useState([])
  const [char, setChar] = useState(null)
  const [loading, setLoading] = useState(true)

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [voiceAutoPlay, setVoiceAutoPlay] = useState(true)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [voiceSessionBusy, setVoiceSessionBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [voiceHint, setVoiceHint] = useState('')
  const [pendingMemoryConflict, setPendingMemoryConflict] = useState(null)
  const [resolvingMemoryConflict, setResolvingMemoryConflict] = useState(false)

  const loadSeqRef = useRef(0)
  const activeRequestRef = useRef('')
  const assistantMessageRef = useRef('')
  const pendingAssistantRef = useRef('')
  const currentCharIdRef = useRef('')
  const voiceAutoPlayRef = useRef(true)
  const recordingRef = useRef(false)
  const captureModeRef = useRef('none')
  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const mediaChunksRef = useRef([])
  const audioContextRef = useRef(null)
  const audioSourceRef = useRef(null)
  const audioProcessorRef = useRef(null)
  const audioSilenceGainRef = useRef(null)
  const pcmSampleQueueRef = useRef([])
  const pcmRecordedChunksRef = useRef([])
  const pendingChunkTasksRef = useRef(new Set())
  const recordingMimeTypeRef = useRef('audio/webm')
  const recordShouldFinalizeRef = useRef(true)
  const recordAutoStopTimerRef = useRef(null)
  const activeAudioRef = useRef(null)
  const ttsRequestTokenRef = useRef(0)
  const transcribingRef = useRef(false)
  const activeVoiceSessionIdRef = useRef('')
  const liveInputPrefixRef = useRef('')
  const liveStreamErrorRef = useRef('')
  const liveInputTargetRef = useRef('')
  const liveInputRenderedRef = useRef('')
  const liveTypingTimerRef = useRef(null)
  const liveCommittedTextRef = useRef('')
  const liveMutableTextRef = useRef('')
  const liveShortCandidateRef = useRef('')
  const liveShortCandidateHitRef = useRef(0)
  const logRef = useRef(null)
  const chatInputRef = useRef(null)

  const activeCharacters = useMemo(() => characters.filter((item) => item.isActive), [characters])

  const stopActiveStreamRef = useRef(null)
  const stopRecordingRef = useRef(null)
  const stopVoicePlaybackRef = useRef(null)
  const playVoiceReplyRef = useRef(null)
  const applyCharByIdRef = useRef(null)
  const bindIncomingRequestRef = useRef(null)

  const appendAssistantMessage = useCallback((content, options = {}) => {
    const text = String(content || '').trim()
    if (!text) return
    setMessages((prev) => prev.concat([
      {
        id: `local_assistant_tip_${Date.now()}`,
        role: 'assistant',
        content: text,
        isError: Boolean(options.isError),
      },
    ]).slice(-60))
  }, [])

  const stopVoicePlayback = useCallback(() => {
    ttsRequestTokenRef.current += 1
    const audio = activeAudioRef.current
    if (audio) {
      try {
        audio.pause()
        audio.src = ''
      } catch {
        // no-op
      }
    }
    activeAudioRef.current = null
    setSpeaking(false)
  }, [])

  const callVoiceApi = useCallback((method, payload = {}) => {
    const e2eMock = window?.e2eAPI?.isEnabled ? window.__e2eChatVoiceApiMock : null
    const mockMethod = e2eMock && typeof e2eMock[method] === 'function' ? e2eMock[method] : null
    if (mockMethod) {
      return mockMethod(payload)
    }
    return window.electronAPI[method](payload)
  }, [])

  const stopLiveTyping = useCallback(() => {
    if (liveTypingTimerRef.current) {
      clearInterval(liveTypingTimerRef.current)
      liveTypingTimerRef.current = null
    }
  }, [])

  const applyRenderedLiveInput = useCallback((nextValue) => {
    const normalized = String(nextValue || '')
    liveInputRenderedRef.current = normalized
    setInput(normalized)
  }, [])

  const stepLiveTyping = useCallback(() => {
    const current = String(liveInputRenderedRef.current || '')
    const target = String(liveInputTargetRef.current || '')
    if (current === target) {
      stopLiveTyping()
      return
    }

    if (target.startsWith(current)) {
      applyRenderedLiveInput(current + target.charAt(current.length))
      return
    }

    if (current.startsWith(target)) {
      applyRenderedLiveInput(current.slice(0, -1))
      return
    }

    const shared = commonPrefixLength(current, target)
    applyRenderedLiveInput(current.slice(0, shared))
  }, [applyRenderedLiveInput, stopLiveTyping])

  const ensureLiveTyping = useCallback(() => {
    if (liveTypingTimerRef.current) return
    liveTypingTimerRef.current = setInterval(() => {
      stepLiveTyping()
    }, 24)
  }, [stepLiveTyping])

  const setLiveInputTarget = useCallback((nextValue, options = {}) => {
    liveInputTargetRef.current = String(nextValue || '')
    if (options.immediate) {
      stopLiveTyping()
      applyRenderedLiveInput(liveInputTargetRef.current)
      return
    }
    ensureLiveTyping()
    stepLiveTyping()
  }, [applyRenderedLiveInput, ensureLiveTyping, stepLiveTyping, stopLiveTyping])

  const resetLiveInputState = useCallback((baseInput = '') => {
    stopLiveTyping()
    const normalized = String(baseInput || '')
    liveInputTargetRef.current = normalized
    liveInputRenderedRef.current = normalized
    setInput(normalized)
  }, [stopLiveTyping])

  const resetLiveRecognitionState = useCallback(() => {
    liveCommittedTextRef.current = ''
    liveMutableTextRef.current = ''
    liveShortCandidateRef.current = ''
    liveShortCandidateHitRef.current = 0
  }, [])

  const applyLiveRecognizedText = useCallback((nextRecognized, options = {}) => {
    let candidate = String(nextRecognized || '')
    if (!candidate) return false

    const committed = String(liveCommittedTextRef.current || '')
    if (committed && !candidate.startsWith(committed)) {
      candidate = `${committed}${candidate}`
    }

    const currentRecognized = `${liveCommittedTextRef.current || ''}${liveMutableTextRef.current || ''}`
    const shortRollback = Boolean(currentRecognized)
      && candidate.length < currentRecognized.length
      && currentRecognized.startsWith(candidate)

    if (shortRollback) {
      if (options.isFinal) {
        candidate = currentRecognized
      } else {
        if (liveShortCandidateRef.current === candidate) {
          liveShortCandidateHitRef.current += 1
        } else {
          liveShortCandidateRef.current = candidate
          liveShortCandidateHitRef.current = 1
        }
        if (liveShortCandidateHitRef.current < 2) {
          return false
        }
      }
    }

    liveShortCandidateRef.current = ''
    liveShortCandidateHitRef.current = 0
    const fixedCommitted = String(liveCommittedTextRef.current || '')
    liveMutableTextRef.current = fixedCommitted ? candidate.slice(fixedCommitted.length) : candidate
    setLiveInputTarget(`${liveInputPrefixRef.current}${candidate}`, { immediate: Boolean(options.immediate) })
    return true
  }, [setLiveInputTarget])

  const applyVoiceTranscriptUpdate = useCallback((payload, options = {}) => {
    const isFinal = Boolean(options.isFinal)
    const text = normalizeIncomingText(payload?.text ?? payload).trim()
    const utterances = normalizeIncomingUtterances(payload)

    let nextCommitted = String(liveCommittedTextRef.current || '')
    let nextRecognized = text

    if (utterances.length > 0) {
      const committedFromUtterances = joinUtteranceTexts(utterances, true)
      const mutableFromUtterances = joinUtteranceTexts(utterances, false)

      if (committedFromUtterances) {
        if (!nextCommitted || committedFromUtterances.startsWith(nextCommitted)) {
          nextCommitted = committedFromUtterances
        }
      }
      liveCommittedTextRef.current = nextCommitted
      nextRecognized = `${nextCommitted}${mutableFromUtterances}`
      if (!nextRecognized) {
        nextRecognized = text || nextCommitted
      }
    } else {
      liveCommittedTextRef.current = nextCommitted
      if (!nextRecognized && nextCommitted) {
        nextRecognized = nextCommitted
      }
    }

    if (!nextRecognized) return false
    return applyLiveRecognizedText(nextRecognized, {
      isFinal,
      immediate: isFinal || Boolean(options.immediate),
    })
  }, [applyLiveRecognizedText])

  stopVoicePlaybackRef.current = stopVoicePlayback

  const playVoiceReply = useCallback(async (text, charId) => {
    const content = String(text || '').trim()
    if (!content || !voiceAutoPlayRef.current) return

    stopVoicePlayback()
    const token = Date.now()
    ttsRequestTokenRef.current = token

    try {
      const result = await window.electronAPI.synthesizeVoice({
        text: content,
        charId: String(charId || currentCharIdRef.current || ''),
      })
      if (ttsRequestTokenRef.current !== token) return
      const base64 = String(result?.audioBase64 || '')
      if (!base64) throw new Error('TTS 未返回音频数据')

      const mimeType = String(result?.mimeType || 'audio/mpeg')
      const audio = new Audio(`data:${mimeType};base64,${base64}`)
      activeAudioRef.current = audio
      setSpeaking(true)

      audio.onended = () => {
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null
        }
        setSpeaking(false)
      }
      audio.onerror = () => {
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null
        }
        setSpeaking(false)
      }
      await audio.play()
    } catch (err) {
      const hint = buildVoiceErrorMessage(charId || currentCharIdRef.current, err?.message || String(err))
      setError(hint)
      appendAssistantMessage(hint, { isError: true })
      setSpeaking(false)
    }
  }, [appendAssistantMessage, stopVoicePlayback])

  playVoiceReplyRef.current = playVoiceReply

  useEffect(() => {
    if (!window?.e2eAPI?.isEnabled) return undefined
    window.__e2eChatVoiceHooks = {
      triggerVoicePlayback: (text, charId = '') => playVoiceReply(String(text || ''), charId || currentCharIdRef.current || ''),
      stopVoicePlayback: () => stopVoicePlayback(),
    }
    return () => {
      delete window.__e2eChatVoiceHooks
    }
  }, [playVoiceReply, stopVoicePlayback])

  useEffect(() => {
    liveInputRenderedRef.current = input
    if (!recording && !transcribing) {
      liveInputTargetRef.current = input
    }
  }, [input, recording, transcribing])

  const blobToDataUrl = useCallback((blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('录音读取失败'))
      reader.readAsDataURL(blob)
    })
  }, [])

  const cleanupRecorderStream = useCallback(() => {
    if (recordAutoStopTimerRef.current) {
      clearTimeout(recordAutoStopTimerRef.current)
      recordAutoStopTimerRef.current = null
    }

    const processor = audioProcessorRef.current
    const source = audioSourceRef.current
    const silentGain = audioSilenceGainRef.current
    const audioContext = audioContextRef.current
    if (processor) {
      try { processor.disconnect() } catch {}
    }
    if (source) {
      try { source.disconnect() } catch {}
    }
    if (silentGain) {
      try { silentGain.disconnect() } catch {}
    }
    if (audioContext) {
      audioContext.close().catch(() => {})
    }
    audioProcessorRef.current = null
    audioSourceRef.current = null
    audioSilenceGainRef.current = null
    audioContextRef.current = null

    const stream = mediaStreamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
    }
    mediaStreamRef.current = null
    mediaRecorderRef.current = null
    captureModeRef.current = 'none'
  }, [])

  const resetVoiceRecordingBuffers = useCallback(() => {
    mediaChunksRef.current = []
    pcmSampleQueueRef.current = []
    pcmRecordedChunksRef.current = []
    pendingChunkTasksRef.current.clear()
    recordingMimeTypeRef.current = 'audio/webm'
  }, [])

  const scheduleRecordingAutoStop = useCallback((durationMs = 20000) => {
    if (recordAutoStopTimerRef.current) {
      clearTimeout(recordAutoStopTimerRef.current)
    }
    recordAutoStopTimerRef.current = setTimeout(() => {
      stopRecordingRef.current?.({ finalize: true })
    }, durationMs)
  }, [])

  const clearLiveVoiceState = useCallback((options = {}) => {
    const {
      clearSessionId = true,
      clearPrefix = true,
      clearStreamError = false,
      resetRecognition = true,
      stopTyping = false,
      resetBuffers = false,
      resetTranscribing = false,
    } = options

    if (clearSessionId) {
      activeVoiceSessionIdRef.current = ''
      setVoiceSessionBusy(false)
    }
    if (clearPrefix) liveInputPrefixRef.current = ''
    if (clearStreamError) liveStreamErrorRef.current = ''
    if (resetRecognition) resetLiveRecognitionState()
    if (stopTyping) stopLiveTyping()
    if (resetBuffers) resetVoiceRecordingBuffers()
    if (resetTranscribing) setTranscribing(false)
  }, [resetLiveRecognitionState, resetVoiceRecordingBuffers, stopLiveTyping])

  const startLiveVoiceSession = useCallback((sessionId, options = {}) => {
    const { baseInput = '', mimeType = 'audio/webm' } = options
    activeVoiceSessionIdRef.current = String(sessionId || '').trim()
    setVoiceSessionBusy(true)
    recordShouldFinalizeRef.current = true
    recordingMimeTypeRef.current = mimeType
    liveInputPrefixRef.current = buildVoiceInputPrefix(baseInput)
    liveStreamErrorRef.current = ''
    resetLiveRecognitionState()
    resetLiveInputState(baseInput)
  }, [resetLiveRecognitionState, resetLiveInputState])

  const waitPendingVoiceChunks = useCallback(async () => {
    const tasks = Array.from(pendingChunkTasksRef.current)
    if (!tasks.length) return
    await Promise.allSettled(tasks)
  }, [])

  const trackVoiceChunkTask = useCallback((task) => {
    pendingChunkTasksRef.current.add(task)
    task.finally(() => {
      pendingChunkTasksRef.current.delete(task)
    })
    return task
  }, [])

  const flushPcmQueueAsChunk = useCallback(() => {
    const queue = pcmSampleQueueRef.current
    if (!Array.isArray(queue) || queue.length === 0) {
      return new Int16Array(0)
    }
    const chunk = Int16Array.from(queue)
    pcmSampleQueueRef.current = []
    return chunk
  }, [])

  const pushPcmChunkToStream = useCallback((chunk, sessionId) => {
    if (!chunk || chunk.length === 0 || !sessionId) return
    const task = (async () => {
      try {
        await callVoiceApi('pushVoiceStreamChunk', {
          sessionId,
          audioBase64: pcmChunkToBase64(chunk),
          mimeType: 'audio/pcm',
        })
      } catch (err) {
        if (liveStreamErrorRef.current) return
        const message = err?.message || String(err)
        liveStreamErrorRef.current = message
        stopRecordingRef.current?.({ finalize: false })
        callVoiceApi('cancelVoiceStream', { sessionId }).catch(() => {})
      }
    })()
    trackVoiceChunkTask(task)
  }, [callVoiceApi, trackVoiceChunkTask])

  const appendPcmFrame = useCallback((floatFrame, inputRate, sessionId) => {
    if (!floatFrame || !floatFrame.length || !sessionId) return
    const downsampled = downsampleFloat32Buffer(floatFrame, inputRate, PCM_TARGET_SAMPLE_RATE)
    const pcm16 = float32ToInt16(downsampled)
    if (!pcm16.length) return

    const queue = pcmSampleQueueRef.current
    for (let i = 0; i < pcm16.length; i += 1) {
      queue.push(pcm16[i])
    }

    while (queue.length >= PCM_CHUNK_SAMPLES) {
      const values = queue.splice(0, PCM_CHUNK_SAMPLES)
      const chunk = Int16Array.from(values)
      pcmRecordedChunksRef.current.push(chunk)
      pushPcmChunkToStream(chunk, sessionId)
    }
  }, [pushPcmChunkToStream])

  const finalizeVoiceRecognition = useCallback(async ({
    sessionId,
    shouldFinalize,
    stopPayload = {},
    fallbackDataUrl = '',
    fallbackMimeType = 'audio/wav',
  }) => {
    const activeSessionId = String(sessionId || '').trim()
    if (!activeSessionId) {
      setVoiceSessionBusy(false)
      clearLiveVoiceState({
        clearSessionId: false,
        clearPrefix: false,
        resetBuffers: true,
        resetTranscribing: true,
      })
      return
    }

    if (!shouldFinalize) {
      await callVoiceApi('cancelVoiceStream', { sessionId: activeSessionId }).catch(() => {})
      clearLiveVoiceState({
        resetBuffers: true,
        resetTranscribing: true,
      })
      return
    }

    try {
      setTranscribing(true)
      const result = await callVoiceApi('stopVoiceStream', {
        sessionId: activeSessionId,
        ...stopPayload,
      })
      const applied = applyVoiceTranscriptUpdate(result, { isFinal: true, immediate: true })
      if (!applied) {
        throw new Error('未识别到有效文本，请说得更清楚一点')
      }
      setVoiceHint('')
      setError('')
    } catch (streamErr) {
      try {
        if (!fallbackDataUrl) {
          throw streamErr
        }
        const fallbackResult = await callVoiceApi('transcribeVoice', {
          audioDataUrl: fallbackDataUrl,
          mimeType: fallbackMimeType,
          charId: currentCharIdRef.current,
        })
        const fallbackText = String(fallbackResult?.text || '').trim()
        if (!fallbackText) {
          throw new Error('兜底识别未返回有效文本')
        }
        applyVoiceTranscriptUpdate({ text: fallbackText }, { isFinal: true, immediate: true })
        setVoiceHint('')
        setError('')
      } catch (fallbackErr) {
        const streamMsg = streamErr?.message || String(streamErr)
        const fallbackMsg = fallbackErr?.message || String(fallbackErr)
        const hasLiveText = Boolean(String(liveInputRenderedRef.current || '').trim())
        if (isAsrNoTextError(streamMsg) || isAsrNoTextError(fallbackMsg)) {
          setError('')
          setVoiceHint(hasLiveText ? '已保留实时识别内容，可直接编辑或发送。' : buildVoiceNoTextHint(currentCharIdRef.current))
          return
        }
        const hint = buildVoiceErrorMessage(
          currentCharIdRef.current,
          `流式识别失败: ${streamMsg}; 兜底失败: ${fallbackMsg}`
        )
        setError(hint)
        appendAssistantMessage(hint, { isError: true })
      }
    } finally {
      clearLiveVoiceState({
        resetBuffers: true,
        resetTranscribing: true,
      })
    }
  }, [appendAssistantMessage, applyVoiceTranscriptUpdate, callVoiceApi, clearLiveVoiceState])

  const stopRecording = useCallback(({ finalize = true } = {}) => {
    const mode = captureModeRef.current
    if (mode === 'pcm') {
      const shouldFinalize = Boolean(finalize)
      recordShouldFinalizeRef.current = shouldFinalize
      if (recordAutoStopTimerRef.current) {
        clearTimeout(recordAutoStopTimerRef.current)
        recordAutoStopTimerRef.current = null
      }

      const sessionId = String(activeVoiceSessionIdRef.current || '').trim()
      const tailChunk = flushPcmQueueAsChunk()
      if (tailChunk.length) {
        pcmRecordedChunksRef.current.push(tailChunk)
      }

      cleanupRecorderStream()
      setRecording(false)

      const stopPayload = tailChunk.length
        ? {
          audioBase64: pcmChunkToBase64(tailChunk),
          mimeType: 'audio/pcm',
        }
        : {}
      const fallbackDataUrl = buildWavDataUrl(pcmRecordedChunksRef.current, PCM_TARGET_SAMPLE_RATE)
      void (async () => {
        await waitPendingVoiceChunks()
        await finalizeVoiceRecognition({
          sessionId,
          shouldFinalize,
          stopPayload,
          fallbackDataUrl,
          fallbackMimeType: 'audio/wav',
        })
      })()
      return
    }

    const recorder = mediaRecorderRef.current
    if (!recorder) return

    recordShouldFinalizeRef.current = Boolean(finalize)
    if (recordAutoStopTimerRef.current) {
      clearTimeout(recordAutoStopTimerRef.current)
      recordAutoStopTimerRef.current = null
    }

    if (recorder.state === 'inactive') {
      cleanupRecorderStream()
      setRecording(false)
      return
    }

    try {
      recorder.stop()
    } catch {
      cleanupRecorderStream()
      setRecording(false)
    }
  }, [cleanupRecorderStream, finalizeVoiceRecognition, flushPcmQueueAsChunk, waitPendingVoiceChunks])

  stopRecordingRef.current = stopRecording

  const cancelLiveVoiceSession = useCallback((silent = true) => {
    const sessionId = String(activeVoiceSessionIdRef.current || '').trim()
    clearLiveVoiceState({
      clearStreamError: true,
      stopTyping: true,
      resetBuffers: true,
      resetTranscribing: true,
    })
    if (!sessionId) return
    callVoiceApi('cancelVoiceStream', { sessionId }).catch((err) => {
      if (silent) return
      const hint = buildVoiceErrorMessage(currentCharIdRef.current, err?.message || String(err))
      setError(hint)
      appendAssistantMessage(hint, { isError: true })
    })
  }, [appendAssistantMessage, callVoiceApi, clearLiveVoiceState])

  const checkApiKeyConfigured = useCallback(async () => {
    const appConfig = await window.electronAPI.getAppConfig()
    const configured = Boolean(appConfig?.llm?.apiKeyConfigured)
    const voiceConfig = appConfig?.voice || {}
    const autoPlay = voiceConfig.autoPlay !== false
    setVoiceAutoPlay(autoPlay)
    voiceAutoPlayRef.current = autoPlay
    return configured
  }, [])

  const refreshRuntimeConfig = useCallback(async () => {
    try {
      return await checkApiKeyConfigured()
    } catch (err) {
      if (import.meta.env.DEV) {
        // Keep runtime behavior stable in production while preserving diagnostics in dev.
        console.warn('[chat] refreshRuntimeConfig failed:', err?.message || String(err))
      }
      return false
    }
  }, [checkApiKeyConfigured])

  const getVoiceInputLocked = useCallback(() => {
    return isVoiceInputLocked({
      recording,
      transcribing,
      voiceSessionBusy,
      activeVoiceSessionId: activeVoiceSessionIdRef.current,
    })
  }, [recording, transcribing, voiceSessionBusy])

  const refreshPendingMemoryConflict = useCallback(async () => {
    try {
      const pending = await window.electronAPI.getPendingMemoryConflict()
      if (!pending || !pending.fieldKey || !pending.candidateValue) {
        setPendingMemoryConflict(null)
        return null
      }
      setPendingMemoryConflict(pending)
      return pending
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[chat] refreshPendingMemoryConflict failed:', err?.message || String(err))
      }
      return null
    }
  }, [])

  const resolvePendingMemoryConflict = useCallback(async (action) => {
    const decisionId = Number(pendingMemoryConflict?.id || 0)
    if (!decisionId || resolvingMemoryConflict) return
    try {
      setResolvingMemoryConflict(true)
      const result = await window.electronAPI.resolveMemoryConflict({ id: decisionId, action })
      if (result?.pending && result.pending.fieldKey) {
        setPendingMemoryConflict(result.pending)
      } else {
        setPendingMemoryConflict(null)
      }
      if (action === 'update') {
        appendAssistantMessage('已更新长期档案字段。', { isError: false })
      }
    } catch (err) {
      const hint = buildChatErrorMessage({
        charId: currentCharIdRef.current,
        payload: {
          source: 'memory',
          message: err?.message || String(err),
        },
      })
      setError(hint.text)
      appendAssistantMessage(hint.text, { isError: true })
    } finally {
      setResolvingMemoryConflict(false)
    }
  }, [appendAssistantMessage, pendingMemoryConflict?.id, resolvingMemoryConflict])

  useEffect(() => {
    const refresh = () => {
      refreshRuntimeConfig()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refreshRuntimeConfig])

  const finalizeAssistantPlaceholder = useCallback((fallbackText, isError = false) => {
    const text = String(fallbackText || '').trim()
    if (!text) return
    const assistantId = assistantMessageRef.current || pendingAssistantRef.current
    if (!assistantId) return

    setMessages((prev) => {
      let found = false
      const next = prev.map((item) => {
        if (item.id !== assistantId) return item
        found = true
        const current = String(item.content || '').trim()
        if (current) return item
        return { ...item, content: text, isError: Boolean(isError) }
      })

      if (!found) {
        next.push({
          id: `local_assistant_tip_${Date.now()}`,
          role: 'assistant',
          content: text,
          isError: Boolean(isError),
        })
      }

      return next.slice(-60)
    })
  }, [])

  const stopActiveStream = useCallback((fallbackText = '（已停止）') => {
    const requestId = activeRequestRef.current
    if (!requestId) {
      finalizeAssistantPlaceholder(fallbackText, false)
      assistantMessageRef.current = ''
      pendingAssistantRef.current = ''
      setStreaming(false)
      return
    }

    finalizeAssistantPlaceholder(fallbackText, false)
    activeRequestRef.current = ''
    assistantMessageRef.current = ''
    pendingAssistantRef.current = ''
    setStreaming(false)
    window.electronAPI.cancelLlm(requestId).catch(() => {})
  }, [finalizeAssistantPlaceholder])

  stopActiveStreamRef.current = stopActiveStream

  const bindIncomingRequest = useCallback((requestId) => {
    const incoming = String(requestId || '')
    if (!incoming) return false
    if (activeRequestRef.current) {
      return activeRequestRef.current === incoming
    }

    if (!assistantMessageRef.current && !pendingAssistantRef.current) {
      return false
    }

    activeRequestRef.current = incoming
    if (!assistantMessageRef.current && pendingAssistantRef.current) {
      assistantMessageRef.current = pendingAssistantRef.current
    }
    return true
  }, [])

  const loadChatByCharId = useCallback(async (charId) => {
    const seq = ++loadSeqRef.current
    try {
      const items = await window.electronAPI.getChatRecent(40, getSessionIdByCharId(charId))
      if (seq !== loadSeqRef.current) return
      const normalized = items.map((item) => ({
        id: `db_${item.id}`,
        role: item.role,
        content: item.content,
        isError: false,
      }))
      setMessages(normalized)
      setInput('')
      setError('')
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      setMessages([])
      setError(`读取聊天失败: ${err.message || err}`)
    }
  }, [])

  const applyCharById = useCallback((charId, list = characters) => {
    const next = findById(charId, list)
    if (!next) return
    setChar(next)
  }, [characters])

  bindIncomingRequestRef.current = bindIncomingRequest
  applyCharByIdRef.current = applyCharById

  useEffect(() => {
    currentCharIdRef.current = char?.id || ''
  }, [char?.id])

  useEffect(() => {
    voiceAutoPlayRef.current = Boolean(voiceAutoPlay)
  }, [voiceAutoPlay])

  useEffect(() => {
    recordingRef.current = Boolean(recording)
  }, [recording])

  useEffect(() => {
    transcribingRef.current = Boolean(transcribing)
  }, [transcribing])

  useEffect(() => {
    Promise.all([
      window.electronAPI.getState(),
      window.electronAPI.listCharacters(),
      window.electronAPI.getAppConfig(),
    ]).then(([state, rows, appConfig]) => {
      const merged = mergeCharacters(rows)
      const next = findById(state.currentCharId, merged)
      setCharacters(merged)
      setChar(next)
      const voiceConfig = appConfig?.voice || {}
      const autoPlay = voiceConfig.autoPlay !== false
      setVoiceAutoPlay(autoPlay)
      voiceAutoPlayRef.current = autoPlay
      refreshPendingMemoryConflict()
    }).finally(() => setLoading(false))

    const unsubChars = window.electronAPI.onCharactersUpdated((rows) => {
      const merged = mergeCharacters(rows)
      setCharacters(merged)

      setChar((prev) => {
        const exact = prev ? findById(prev.id, merged) : null
        if (exact && exact.isActive) return exact
        const fallback = merged.find((item) => item.isActive) || merged[0] || null
        return fallback
      })
    })

    const unsubPetMenuAction = window.electronAPI.onPetMenuAction((payload) => {
      if (!payload?.type) return
      if (payload.type === 'switch-char' && payload.charId) {
        const nextId = String(payload.charId || '').trim()
        const currentId = String(currentCharIdRef.current || '').trim()
        if (!nextId || nextId === currentId) return
        stopActiveStreamRef.current()
        stopRecordingRef.current?.({ finalize: false })
        cancelLiveVoiceSession(true)
        stopVoicePlaybackRef.current?.()
        applyCharByIdRef.current(nextId)
        return
      }
      if (payload.type === 'chat-open' && payload.charId) {
        const nextId = String(payload.charId || '').trim()
        const currentId = String(currentCharIdRef.current || '').trim()
        if (!nextId || nextId === currentId) return
        applyCharByIdRef.current(nextId)
      }
    })

    const unsubDelta = window.electronAPI.onLlmDelta((payload) => {
      if (!bindIncomingRequestRef.current(payload.requestId)) return
      const assistantId = assistantMessageRef.current
      if (!assistantId) return

      setMessages((prev) => prev.map((item) => (
        item.id === assistantId
          ? { ...item, content: item.content + payload.token, isError: false }
          : item
      )))
    })

    const unsubDone = window.electronAPI.onLlmDone((payload) => {
      if (!bindIncomingRequestRef.current(payload.requestId)) return

      setStreaming(false)
      activeRequestRef.current = ''
      pendingAssistantRef.current = ''

      const assistantId = assistantMessageRef.current
      assistantMessageRef.current = ''
      if (!assistantId) return

      let finalText = String(payload?.text || '').trim()
      setMessages((prev) => prev.map((item) => (
        item.id === assistantId
          ? (() => {
            const content = payload.text || item.content || '（无回复）'
            if (!finalText) finalText = String(content || '').trim()
            return { ...item, content, isError: false }
          })()
          : item
      )))

      if (finalText) {
        playVoiceReplyRef.current?.(finalText, currentCharIdRef.current)
      }
      refreshPendingMemoryConflict()
    })

    const unsubError = window.electronAPI.onLlmError((payload) => {
      if (!bindIncomingRequestRef.current(payload.requestId)) return

      setStreaming(false)
      const errorPack = buildChatErrorMessage({ charId: currentCharIdRef.current, payload })
      setError(errorPack.text)
      activeRequestRef.current = ''
      pendingAssistantRef.current = ''

      const assistantId = assistantMessageRef.current
      assistantMessageRef.current = ''
      setMessages((prev) => {
        let found = false
        const next = prev.map((item) => {
          if (item.id !== assistantId) return item
          found = true

          const current = String(item.content || '').trim()
          if (payload.aborted) {
            return { ...item, content: current || '（已停止：本次请求已取消，可重试）', isError: false }
          }
          if (!current) return { ...item, content: errorPack.text, isError: true }
          if (current.includes(errorPack.text)) return { ...item, isError: true }
          return { ...item, content: `${current}\n\n${errorPack.text}`, isError: true }
        })

        if (!found && !payload.aborted) {
          next.push({
            id: `local_assistant_error_${Date.now()}`,
            role: 'assistant',
            content: errorPack.text,
            isError: true,
          })
        }
        return next.slice(-60)
      })
    })

    const handleVoicePartial = (payload) => {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId || sessionId !== activeVoiceSessionIdRef.current) return
      const updated = applyVoiceTranscriptUpdate(payload, { isFinal: false })
      if (!updated) return
      setVoiceHint('')
      setError('')
      liveStreamErrorRef.current = ''
    }

    const handleVoiceFinal = (payload) => {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId || sessionId !== activeVoiceSessionIdRef.current) return
      const updated = applyVoiceTranscriptUpdate(payload, { isFinal: true, immediate: true })
      if (updated) {
        setVoiceHint('')
        setError('')
      }
      clearLiveVoiceState({
        clearStreamError: true,
        resetTranscribing: true,
      })
    }

    const handleVoiceError = (payload) => {
      const sessionId = String(payload?.sessionId || '').trim()
      if (!sessionId || sessionId !== activeVoiceSessionIdRef.current) return
      const kind = String(payload?.kind || '').trim().toLowerCase()
      const reasonCode = String(payload?.reasonCode || '').trim().toLowerCase()
      const message = String(payload?.message || '').trim() || '语音识别异常'
      const noTextKind = kind === 'asr_no_text' || reasonCode === 'voice_asr_no_text'
      const recoverable = noTextKind || kind === 'timeout' || /未返回可识别文本|等待结果超时|连接已关闭/.test(message)
      if (transcribingRef.current && recoverable) {
        return
      }
      if (recoverable || isAsrNoTextError(message)) {
        setError('')
        const hasLiveText = Boolean(String(liveInputRenderedRef.current || '').trim())
        setVoiceHint(hasLiveText ? '已保留实时识别内容，可直接编辑或发送。' : buildVoiceNoTextHint(currentCharIdRef.current))
        clearLiveVoiceState({ resetTranscribing: true })
        return
      }
      if (message === liveStreamErrorRef.current) return
      liveStreamErrorRef.current = message
      const hint = buildVoiceErrorMessage(currentCharIdRef.current, message)
      setError(hint)
      appendAssistantMessage(hint, { isError: true })
      clearLiveVoiceState({ resetTranscribing: true })
    }

    const unsubVoicePartial = window.electronAPI.onVoiceStreamPartial(handleVoicePartial)
    const unsubVoiceFinal = window.electronAPI.onVoiceStreamFinal(handleVoiceFinal)
    const unsubVoiceError = window.electronAPI.onVoiceStreamError(handleVoiceError)

    const unsubChatReload = window.electronAPI.onChatReload(({ sessionId }) => {
      const currentSessionId = getSessionIdByCharId(currentCharIdRef.current)
      if (sessionId === currentSessionId) {
        loadChatByCharId(currentCharIdRef.current)
      }
    })
    const unsubMemoryConflictRefresh = window.electronAPI.onMemoryConflictRefresh(() => {
      refreshPendingMemoryConflict()
    })

    if (window?.e2eAPI?.isEnabled) {
      window.__e2eChatVoiceStreamHooks = {
        emitPartial: handleVoicePartial,
        emitFinal: handleVoiceFinal,
        emitError: handleVoiceError,
        getActiveSessionId: () => String(activeVoiceSessionIdRef.current || ''),
      }
    }

    return () => {
      unsubChars()
      unsubPetMenuAction()
      unsubDelta()
      unsubDone()
      unsubError()
      unsubVoicePartial()
      unsubVoiceFinal()
      unsubVoiceError()
      unsubChatReload()
      unsubMemoryConflictRefresh()
      stopActiveStreamRef.current()
      stopRecordingRef.current?.({ finalize: false })
      cancelLiveVoiceSession(true)
      stopVoicePlaybackRef.current?.()
      stopLiveTyping()
      if (window?.e2eAPI?.isEnabled && window.__e2eChatVoiceStreamHooks) {
        delete window.__e2eChatVoiceStreamHooks
      }
    }
  }, [
    appendAssistantMessage,
    applyVoiceTranscriptUpdate,
    cancelLiveVoiceSession,
    clearLiveVoiceState,
    refreshPendingMemoryConflict,
    stopLiveTyping,
  ])

  useEffect(() => {
    if (!char?.id) return
    setVoiceHint('')
    loadChatByCharId(char.id)
    window.electronAPI.pinChatWindowToPet({ charId: char.id })
  }, [char?.id, loadChatByCharId])

  useEffect(() => {
    const node = logRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages.length, streaming])

  useEffect(() => {
    const node = chatInputRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 132)}px`
  }, [input])

  const sendMessage = async (rawText = null) => {
    const looksLikeEvent = Boolean(
      rawText
      && typeof rawText === 'object'
      && (typeof rawText.preventDefault === 'function' || rawText.nativeEvent)
    )
    const explicit = looksLikeEvent ? null : rawText
    const normalizedExplicit = normalizeIncomingText(explicit)
    const source = explicit === null || explicit === undefined ? input : normalizedExplicit
    const text = String(source || '').trim()
    const voiceInputLocked = getVoiceInputLocked()
    if (!text || streaming || !char || voiceInputLocked) return

    const configured = await refreshRuntimeConfig()

    if (!configured) {
      const hint = buildMissingApiKeyHint(char.id)
      setError(hint.text)
      appendAssistantMessage(hint.text, { isError: true })
      return
    }

    setError('')
    setVoiceHint('')
    setInput('')

    const userId = `local_user_${Date.now()}`
    const assistantId = `local_assistant_${Date.now()}`
    assistantMessageRef.current = assistantId
    pendingAssistantRef.current = assistantId
    activeRequestRef.current = ''

    setMessages((prev) => prev.concat([
      { id: userId, role: 'user', content: text, isError: false },
      { id: assistantId, role: 'assistant', content: '', isError: false },
    ]).slice(-60))

    try {
      const configured = await refreshRuntimeConfig()
      if (!configured) {
        const hint = buildMissingApiKeyHint(char.id)
        setStreaming(false)
        setError(hint.text)
        activeRequestRef.current = ''
        pendingAssistantRef.current = ''
        assistantMessageRef.current = ''
        setMessages((prev) => {
          const next = prev.map((item) => (
            item.id === assistantId ? { ...item, content: hint.text, isError: true } : item
          ))
          return next.slice(-60)
        })
        return
      }

      setStreaming(true)
      const { requestId } = await window.electronAPI.startLlmStream(text, getSessionIdByCharId(char.id), char.id)
      activeRequestRef.current = requestId
      pendingAssistantRef.current = ''
    } catch (err) {
      setStreaming(false)
      const errText = err.message || String(err)
      const errorPack = buildChatErrorMessage({
        charId: char.id,
        payload: {
          source: 'llm',
          message: errText,
        },
      })
      setError(errorPack.text)
      activeRequestRef.current = ''
      pendingAssistantRef.current = ''
      assistantMessageRef.current = ''
      setMessages((prev) => {
        let found = false
        const next = prev.map((item) => {
          if (item.id !== assistantId) return item
          found = true
          return { ...item, content: errorPack.text, isError: true }
        })
        if (!found) {
          next.push({
            id: `local_assistant_error_${Date.now()}`,
            role: 'assistant',
            content: errorPack.text,
            isError: true,
          })
        }
        return next.slice(-60)
      })
    }
  }

  const toggleVoiceRecord = async () => {
    if (!char) return
    if (transcribing) return

    if (recording) {
      stopRecording({ finalize: true })
      return
    }
    if (streaming) return

    await refreshRuntimeConfig()

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    const supportsPcmCapture = typeof AudioContextCtor === 'function'
    const supportsMediaRecorder = typeof MediaRecorder !== 'undefined'
    const useLegacyRecorder = Boolean(window?.e2eAPI?.isEnabled) || !supportsPcmCapture

    if (!navigator.mediaDevices?.getUserMedia || (!supportsPcmCapture && !supportsMediaRecorder)) {
      const hint = buildVoiceErrorMessage(char.id, '当前系统不支持录音')
      setError(hint)
      appendAssistantMessage(hint, { isError: true })
      return
    }

    try {
      setError('')
      setVoiceHint('')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (useLegacyRecorder) {
        const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '')
        const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream)
        const audioType = recorder.mimeType || preferredType || 'audio/webm'
        const voiceSession = await callVoiceApi('startVoiceStream', {
          charId: currentCharIdRef.current,
          mimeType: audioType,
        })
        const voiceSessionId = String(voiceSession?.sessionId || '').trim()
        if (!voiceSessionId) {
          throw new Error('语音识别会话创建失败')
        }

        captureModeRef.current = 'media-recorder'
        mediaStreamRef.current = stream
        mediaRecorderRef.current = recorder
        resetVoiceRecordingBuffers()
        startLiveVoiceSession(voiceSessionId, {
          baseInput: input,
          mimeType: audioType,
        })

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            mediaChunksRef.current.push(event.data)
            const sessionId = String(activeVoiceSessionIdRef.current || '').trim()
            if (!sessionId) return
            const task = (async () => {
              try {
                const audioDataUrl = await blobToDataUrl(event.data)
                await callVoiceApi('pushVoiceStreamChunk', {
                  sessionId,
                  audioDataUrl,
                  mimeType: audioType,
                })
              } catch (err) {
                if (liveStreamErrorRef.current) return
                const message = err?.message || String(err)
                liveStreamErrorRef.current = message
                stopRecordingRef.current?.({ finalize: false })
              }
            })()
            trackVoiceChunkTask(task)
          }
        }

        recorder.onerror = (event) => {
          const hint = buildVoiceErrorMessage(char.id, event?.error?.message || '录音失败')
          setError(hint)
        }

        recorder.onstop = async () => {
          const shouldFinalize = recordShouldFinalizeRef.current
          const sessionId = String(activeVoiceSessionIdRef.current || '').trim()
          const backupChunks = mediaChunksRef.current.slice()
          const audioTypeToUse = recordingMimeTypeRef.current || audioType

          setRecording(false)
          cleanupRecorderStream()
          await waitPendingVoiceChunks()

          const fallbackDataUrl = backupChunks.length
            ? await blobToDataUrl(new Blob(backupChunks, { type: audioTypeToUse })).catch(() => '')
            : ''
          await finalizeVoiceRecognition({
            sessionId,
            shouldFinalize,
            stopPayload: {},
            fallbackDataUrl,
            fallbackMimeType: audioTypeToUse,
          })
        }

        recorder.start(120)
        setRecording(true)
        scheduleRecordingAutoStop()
        return
      }

      const voiceSession = await callVoiceApi('startVoiceStream', {
        charId: currentCharIdRef.current,
        mimeType: 'audio/pcm',
      })
      const voiceSessionId = String(voiceSession?.sessionId || '').trim()
      if (!voiceSessionId) {
        throw new Error('语音识别会话创建失败')
      }

      const audioContext = new AudioContextCtor()
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      const silenceGain = audioContext.createGain()
      silenceGain.gain.value = 0

      captureModeRef.current = 'pcm'
      mediaStreamRef.current = stream
      audioContextRef.current = audioContext
      audioSourceRef.current = source
      audioProcessorRef.current = processor
      audioSilenceGainRef.current = silenceGain

      resetVoiceRecordingBuffers()
      startLiveVoiceSession(voiceSessionId, {
        baseInput: input,
        mimeType: 'audio/pcm',
      })

      processor.onaudioprocess = (event) => {
        try {
          if (!recordingRef.current) return
          const sessionId = String(activeVoiceSessionIdRef.current || '').trim()
          if (!sessionId) return
          const channel = event.inputBuffer.getChannelData(0)
          appendPcmFrame(channel, audioContext.sampleRate, sessionId)
        } catch (err) {
          if (liveStreamErrorRef.current) return
          liveStreamErrorRef.current = err?.message || String(err)
          stopRecordingRef.current?.({ finalize: false })
        }
      }

      source.connect(processor)
      processor.connect(silenceGain)
      silenceGain.connect(audioContext.destination)
      await audioContext.resume().catch(() => {})

      setRecording(true)
      scheduleRecordingAutoStop()
    } catch (err) {
      cleanupRecorderStream()
      setRecording(false)
      cancelLiveVoiceSession(true)
      resetVoiceRecordingBuffers()
      const hint = buildVoiceErrorMessage(char.id, err?.message || String(err))
      setError(hint)
      appendAssistantMessage(hint, { isError: true })
    }
  }

  const toggleVoiceAutoPlay = async () => {
    const next = !voiceAutoPlayRef.current
    const prev = voiceAutoPlayRef.current
    voiceAutoPlayRef.current = next
    setVoiceAutoPlay(next)
    if (!next) {
      stopVoicePlaybackRef.current?.()
    }

    try {
      await window.electronAPI.setAppConfig({ voice: { autoPlay: next } })
    } catch (err) {
      voiceAutoPlayRef.current = prev
      setVoiceAutoPlay(prev)
      const hint = buildVoiceErrorMessage(currentCharIdRef.current, `语音播放开关保存失败: ${err?.message || err}`)
      setError(hint)
      appendAssistantMessage(hint, { isError: true })
    }
  }

  const closeChatWindow = async () => {
    stopActiveStream()
    stopRecording({ finalize: false })
    cancelLiveVoiceSession(true)
    setVoiceHint('')
    stopVoicePlayback()
    await window.electronAPI.hideChatWindow()
  }

  if (loading) {
    return <div className="chat-window-root chat-window-loading">加载聊天中...</div>
  }

  const title = `${char?.name || '角色'}小剧场`
  const voiceInputLocked = getVoiceInputLocked()
  const statusText = buildChatStatusText({
    recording,
    transcribing,
    voiceSessionBusy,
    error,
    voiceHint,
    speaking,
    voiceAutoPlay,
  })
  const conflictFieldLabel = PROFILE_CONFLICT_FIELD_LABELS[pendingMemoryConflict?.fieldKey] || '档案字段'
  const conflictCurrentValue = String(pendingMemoryConflict?.currentValue || '').trim() || '（空）'
  const conflictCandidateValue = String(pendingMemoryConflict?.candidateValue || '').trim() || '（空）'
  const conflictCount = Number(pendingMemoryConflict?.count7d || 0)

  return (
    <div className="chat-window-root" data-testid="chat-root" data-char-id={char?.id || ''}>
      <div className="chat-window-shell" data-testid="chat-shell">
        <header className="chat-window-header">
          <div className="chat-window-title-wrap">
            {char?.idleImg && <img src={char.idleImg} alt={char.name} className="chat-window-avatar" draggable={false} />}
            <div className="chat-window-title-stack">
              <strong className="chat-window-title" data-testid="chat-title">{title}</strong>
              <span className="chat-window-meta" title="可在桌宠右键菜单中切换角色">
                当前角色：{char?.name || '-'} · 已启用 {activeCharacters.length} 个角色
              </span>
            </div>
          </div>

          <div className="chat-window-actions">
            <button
              className={`chat-window-action chat-window-action--voice-play${voiceAutoPlay ? '' : ' is-off'}`}
              data-testid="chat-voice-playback-toggle"
              onClick={toggleVoiceAutoPlay}
              title={voiceAutoPlay ? '关闭语音播放' : '开启语音播放'}
            >
              {voiceAutoPlay ? '播' : '静'}
            </button>
            <button className="chat-window-action" onClick={() => window.electronAPI.openSettings()} title="打开设置">设</button>
            <button className="chat-window-action" data-testid="chat-close" onClick={closeChatWindow} title="关闭聊天">×</button>
          </div>
        </header>

        {pendingMemoryConflict && (
          <section className="chat-memory-conflict-banner" data-testid="chat-memory-conflict-banner">
            <p className="chat-memory-conflict-text">
              记忆待确认：{conflictFieldLabel} 当前为“{conflictCurrentValue}”，近 7 天检测到 {conflictCount} 次冲突，
              建议更新为“{conflictCandidateValue}”。
            </p>
            <div className="chat-memory-conflict-actions">
              <button
                type="button"
                className="chat-memory-conflict-btn"
                disabled={resolvingMemoryConflict}
                onClick={() => resolvePendingMemoryConflict('keep')}
              >
                保留原值
              </button>
              <button
                type="button"
                className="chat-memory-conflict-btn chat-memory-conflict-btn--primary"
                disabled={resolvingMemoryConflict}
                onClick={() => resolvePendingMemoryConflict('update')}
              >
                更新为新值
              </button>
              <button
                type="button"
                className="chat-memory-conflict-btn"
                disabled={resolvingMemoryConflict}
                onClick={() => resolvePendingMemoryConflict('defer')}
              >
                稍后处理
              </button>
            </div>
          </section>
        )}

        <div ref={logRef} className="chat-window-log" data-testid="chat-log">
          {messages.length === 0 && (
            <div className="chat-window-empty">先打一声招呼吧。切换角色后会自动切到该角色独立会话。</div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`chat-window-item chat-window-item--${message.role}${
                message.role === 'assistant' && message.isError
                  ? ' is-error'
                  : ''
              }`}
            >
              <span>{message.content || (message.role === 'assistant' ? '（正在想招）' : '')}</span>
            </div>
          ))}
        </div>

        <footer className="chat-window-composer">
          <div
            className={`chat-window-status is-${statusText.kind}`}
            data-testid="chat-status"
          >
            {statusText.text}
          </div>
          <div className="chat-window-input-row">
            <button
              type="button"
              data-testid="chat-voice-toggle"
              className={`chat-window-voice${recording ? ' is-recording' : ''}${transcribing ? ' is-transcribing' : ''}`}
              title={recording ? '结束录音并保留识别结果' : '点击开始录音'}
              disabled={transcribing || (streaming && !recording)}
              onClick={toggleVoiceRecord}
            >
              {transcribing ? '转' : (recording ? '录' : '语')}
            </button>
            <textarea
              ref={chatInputRef}
              rows={1}
              data-testid="chat-input"
              className="chat-window-input"
              value={input}
              onChange={(event) => {
                const nextValue = String(event.target.value || '')
                liveInputTargetRef.current = nextValue
                liveInputRenderedRef.current = nextValue
                setInput(nextValue)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  if (voiceInputLocked) return
                  sendMessage()
                }
              }}
              placeholder="说点什么..."
            />
            {streaming ? (
              <button data-testid="chat-cancel" className="chat-window-send chat-window-send--cancel" onClick={stopActiveStream}>停</button>
            ) : (
              <button
                data-testid="chat-send"
                className="chat-window-send"
                disabled={voiceInputLocked}
                title={voiceInputLocked ? '请先结束录音' : '发送消息'}
                onClick={() => sendMessage()}
              >
                发
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
