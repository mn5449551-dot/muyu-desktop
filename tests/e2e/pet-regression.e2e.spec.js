const fs = require('fs')
const os = require('os')
const path = require('path')
const { test, expect, _electron: electron } = require('@playwright/test')
const { loadLiveVoiceConfig } = require('./helpers/live-voice-config')

async function launchApp({ userDataDir } = {}) {
  const runtimeDir = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'muyu-e2e-'))
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      E2E: '1',
      E2E_USER_DATA_DIR: runtimeDir,
      OPEN_DEVTOOLS: '0',
    },
  })

  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="pet-character"]', { timeout: 15_000 })
  await expect.poll(async () => page.getAttribute('[data-testid="pet-page"]', 'data-ready')).toBe('1')

  return { app, page, userDataDir: runtimeDir }
}

async function closeApp(ctx, { keepUserDataDir = false } = {}) {
  if (!ctx) return
  if (ctx.app) {
    await ctx.app.close()
  }
  if (!keepUserDataDir && ctx.userDataDir) {
    fs.rmSync(ctx.userDataDir, { recursive: true, force: true })
  }
}

async function getRuntimeState(page) {
  return page.evaluate(() => window.e2eAPI.getRuntimeState())
}

function expectMainWindowInsideDisplay(runtime) {
  const main = runtime?.windows?.main?.bounds
  const display = runtime?.windows?.main?.display
  expect(main).toBeTruthy()
  expect(display).toBeTruthy()
  expect(main.x).toBeGreaterThanOrEqual(display.x)
  expect(main.y).toBeGreaterThanOrEqual(display.y)
  expect(main.x + main.width).toBeLessThanOrEqual(display.x + display.width)
  expect(main.y + main.height).toBeLessThanOrEqual(display.y + display.height)
}

async function getPetCount(page) {
  const value = await page.getAttribute('[data-testid="pet-state"]', 'data-count')
  return Number.parseInt(value || '0', 10)
}

async function switchCharacter(page, charId) {
  const result = await page.evaluate((id) => window.e2eAPI.switchCharacter(id), charId)
  expect(result.ok).toBeTruthy()
  await expect.poll(async () => page.getAttribute('[data-testid="pet-page"]', 'data-char-id')).toBe(charId)
  // Wait for character switch animation to complete before tap assertions.
  await page.waitForTimeout(360)
  await expect.poll(async () => {
    const className = await page.getAttribute('.char-img', 'class')
    return String(className || '').includes('switch-')
  }).toBe(false)
}

async function ensurePetInteractive(page) {
  await page.hover('[data-testid="pet-character"]')
  await expect.poll(async () => {
    const runtime = await getRuntimeState(page)
    return Boolean(runtime?.windows?.main?.ignoreMouse)
  }).toBe(false)
}

async function tapAndExpectIncrement(page) {
  const before = await getPetCount(page)
  await ensurePetInteractive(page)
  await page.click('[data-testid="pet-character"]', { button: 'left' })
  await expect.poll(async () => getPetCount(page)).toBe(before + 1)
}

async function getActiveCharacters(page) {
  const runtime = await getRuntimeState(page)
  return runtime.characters.filter((item) => item.isActive)
}

async function findChatPage(app) {
  for (const page of app.windows()) {
    try {
      const count = await page.locator('[data-testid="chat-root"]').count()
      if (count > 0) return page
    } catch {
      // ignore page transition errors
    }
  }
  return null
}

async function ensureChatOpen(ctx) {
  await ctx.page.evaluate(() => window.e2eAPI.openChatWindow({}))
  let chatPage = null
  await expect.poll(async () => {
    chatPage = await findChatPage(ctx.app)
    return Boolean(chatPage)
  }).toBe(true)

  await chatPage.waitForSelector('[data-testid="chat-shell"]', { timeout: 10_000 })
  return chatPage
}

async function findSettingsPage(app) {
  for (const page of app.windows()) {
    try {
      const count = await page.locator('.settings-root').count()
      if (count > 0) return page
    } catch {
      // ignore page transition errors
    }
  }
  return null
}

async function ensureSettingsOpen(ctx) {
  await ctx.page.evaluate(() => window.electronAPI.openSettings())
  let settingsPage = null
  await expect.poll(async () => {
    settingsPage = await findSettingsPage(ctx.app)
    return Boolean(settingsPage)
  }).toBe(true)
  await settingsPage.waitForSelector('.settings-layout', { timeout: 10_000 })
  return settingsPage
}

async function configureVoice(page, patch = {}) {
  await page.evaluate(async (payload) => {
    await window.electronAPI.setAppConfig({ voice: payload })
  }, patch)
}

test.describe('Desktop Pet Regressions', () => {
  let ctx

  test.beforeEach(async () => {
    ctx = await launchApp()
  })

  test.afterEach(async () => {
    await closeApp(ctx)
    ctx = null
  })

  test('multi switch then tap keeps working', async () => {
    const active = await getActiveCharacters(ctx.page)
    test.skip(active.length < 2, 'At least two active characters are required')

    for (let i = 0; i < 12; i += 1) {
      const target = active[i % active.length].id
      await switchCharacter(ctx.page, target)
      await tapAndExpectIncrement(ctx.page)
    }
  })

  test('first tap right after switch works', async () => {
    const active = await getActiveCharacters(ctx.page)
    test.skip(active.length < 2, 'At least two active characters are required')

    await switchCharacter(ctx.page, active[1].id)
    await tapAndExpectIncrement(ctx.page)
  })

  test('resize cycles still allow tap', async () => {
    const scales = [0.6, 0.8, 1.2, 1.8, 1.0, 1.4, 0.9, 1.0]

    for (const scale of scales) {
      await ctx.page.evaluate((value) => window.e2eAPI.resizePetScale(value), scale)
      await expect.poll(async () => {
        const runtime = await getRuntimeState(ctx.page)
        return Math.round(runtime.petScale * 10)
      }).toBe(Math.round(scale * 10))
      await tapAndExpectIncrement(ctx.page)
    }
  })

  test('tap at 60% scale does not trigger temporary window resize', async () => {
    await ctx.page.evaluate(() => window.e2eAPI.resizePetScale(0.6))
    await expect.poll(async () => {
      const runtime = await getRuntimeState(ctx.page)
      return Math.round(runtime.petScale * 10)
    }).toBe(6)

    const before = await getRuntimeState(ctx.page)
    const beforeBounds = before?.windows?.main?.bounds
    expect(beforeBounds).toBeTruthy()

    await tapAndExpectIncrement(ctx.page)

    for (let i = 0; i < 10; i += 1) {
      await ctx.page.waitForTimeout(120)
      const runtime = await getRuntimeState(ctx.page)
      const bounds = runtime?.windows?.main?.bounds
      expect(bounds.width).toBe(beforeBounds.width)
      expect(bounds.height).toBe(beforeBounds.height)
    }
  })

  test('scale adjust and reset IPC keeps value in range', async () => {
    await ctx.page.evaluate(() => window.electronAPI.adjustPetScale(-0.8))
    await expect.poll(async () => {
      const runtime = await getRuntimeState(ctx.page)
      return runtime.petScale
    }).toBe(0.6)

    await ctx.page.evaluate(() => window.electronAPI.adjustPetScale(5))
    await expect.poll(async () => {
      const runtime = await getRuntimeState(ctx.page)
      return runtime.petScale
    }).toBe(1.8)

    await ctx.page.evaluate(() => window.electronAPI.resetPetScale())
    await expect.poll(async () => {
      const runtime = await getRuntimeState(ctx.page)
      return runtime.petScale
    }).toBe(1)
  })

  test('open and close chat does not break pet taps', async () => {
    const chatPage = await ensureChatOpen(ctx)
    await chatPage.click('[data-testid="chat-close"]')

    await expect.poll(async () => {
      const runtime = await getRuntimeState(ctx.page)
      return Boolean(runtime.windows.chat && runtime.windows.chat.visible)
    }).toBe(false)

    await tapAndExpectIncrement(ctx.page)
  })

  test('hide all windows then restore main window works', async () => {
    await ensureChatOpen(ctx)
    await ctx.page.evaluate(() => window.electronAPI.openSettings())

    await expect.poll(async () => {
      const runtime = await getRuntimeState(ctx.page)
      return Boolean(runtime.windows.settings && runtime.windows.settings.visible)
    }).toBe(true)

    await ctx.page.evaluate(() => window.e2eAPI.hideAllWindows())
    await expect.poll(async () => {
      const runtime = await getRuntimeState(ctx.page)
      return {
        main: Boolean(runtime?.windows?.main?.visible),
        chat: Boolean(runtime?.windows?.chat?.visible),
        settings: Boolean(runtime?.windows?.settings?.visible),
      }
    }).toEqual({
      main: false,
      chat: false,
      settings: false,
    })

    await ctx.page.evaluate(() => window.e2eAPI.showMainWindow())
    await expect.poll(async () => {
      const runtime = await getRuntimeState(ctx.page)
      return Boolean(runtime?.windows?.main?.visible)
    }).toBe(true)
  })

  test('switch role while chat open keeps pet tappable', async () => {
    const active = await getActiveCharacters(ctx.page)
    test.skip(active.length < 2, 'At least two active characters are required')

    await ensureChatOpen(ctx)
    await switchCharacter(ctx.page, active[1].id)
    await tapAndExpectIncrement(ctx.page)
  })

  test('chat window follows main window move', async () => {
    await ensureChatOpen(ctx)

    const before = await getRuntimeState(ctx.page)
    const mainBefore = before.windows.main.bounds
    const chatBefore = before.windows.chat.bounds

    const nextX = mainBefore.x + 120
    const nextY = mainBefore.y + 80
    await ctx.page.evaluate(({ x, y }) => window.e2eAPI.setMainWindowPosition(x, y), { x: nextX, y: nextY })

    const after = await expect.poll(async () => getRuntimeState(ctx.page)).toBeTruthy()
    const runtime = await getRuntimeState(ctx.page)

    const dxMain = runtime.windows.main.bounds.x - mainBefore.x
    const dyMain = runtime.windows.main.bounds.y - mainBefore.y
    const dxChat = runtime.windows.chat.bounds.x - chatBefore.x
    const dyChat = runtime.windows.chat.bounds.y - chatBefore.y

    expect(Math.abs(dxMain - dxChat)).toBeLessThan(56)
    expect(Math.abs(dyMain - dyChat)).toBeLessThan(56)
  })

  test('chat window stays inside display bounds near edges', async () => {
    const state = await getRuntimeState(ctx.page)
    const display = state.windows.main.display
    const main = state.windows.main.bounds

    const rightX = display.x + display.width - main.width - 4
    await ctx.page.evaluate(({ x, y }) => window.e2eAPI.setMainWindowPosition(x, y), { x: rightX, y: main.y })
    await ensureChatOpen(ctx)

    let runtime = await getRuntimeState(ctx.page)
    let chat = runtime.windows.chat.bounds
    expect(chat.x).toBeGreaterThanOrEqual(display.x)
    expect(chat.y).toBeGreaterThanOrEqual(display.y)
    expect(chat.x + chat.width).toBeLessThanOrEqual(display.x + display.width)
    expect(chat.y + chat.height).toBeLessThanOrEqual(display.y + display.height)

    const leftX = display.x + 4
    await ctx.page.evaluate(({ x, y }) => window.e2eAPI.setMainWindowPosition(x, y), { x: leftX, y: main.y })
    await ctx.page.evaluate(() => window.e2eAPI.openChatWindow({}))

    runtime = await getRuntimeState(ctx.page)
    chat = runtime.windows.chat.bounds
    expect(chat.x).toBeGreaterThanOrEqual(display.x)
    expect(chat.x + chat.width).toBeLessThanOrEqual(display.x + display.width)
  })

  test('chat window size persists after close and restart', async () => {
    await ensureChatOpen(ctx)
    await ctx.page.evaluate(() => window.e2eAPI.setChatWindowSize(448, 640))

    await expect.poll(async () => {
      const runtime = await getRuntimeState(ctx.page)
      return {
        width: runtime?.windows?.chat?.bounds?.width || 0,
        height: runtime?.windows?.chat?.bounds?.height || 0,
      }
    }).toEqual({ width: 448, height: 640 })

    let chatPage = await findChatPage(ctx.app)
    await chatPage.click('[data-testid="chat-close"]')
    await ensureChatOpen(ctx)
    await expect.poll(async () => {
      const runtime = await getRuntimeState(ctx.page)
      return {
        width: runtime?.windows?.chat?.bounds?.width || 0,
        height: runtime?.windows?.chat?.bounds?.height || 0,
      }
    }).toEqual({ width: 448, height: 640 })

    const keepDir = ctx.userDataDir
    await closeApp(ctx, { keepUserDataDir: true })
    ctx = await launchApp({ userDataDir: keepDir })

    await ensureChatOpen(ctx)
    await expect.poll(async () => {
      const runtime = await getRuntimeState(ctx.page)
      return {
        width: runtime?.windows?.chat?.bounds?.width || 0,
        height: runtime?.windows?.chat?.bounds?.height || 0,
      }
    }).toEqual({ width: 448, height: 640 })
  })

  test('chat content does not overflow horizontally at minimum size', async () => {
    const chatPage = await ensureChatOpen(ctx)
    await ctx.page.evaluate(() => window.e2eAPI.setChatWindowSize(340, 480))

    await chatPage.evaluate(() => {
      const originalGetAppConfig = window.electronAPI.getAppConfig
      window.electronAPI.getAppConfig = async () => {
        const config = await originalGetAppConfig()
        return {
          ...config,
          llm: {
            ...(config.llm || {}),
            apiKeyConfigured: true,
          },
        }
      }
      window.__e2eOriginalStartLlmStream = window.electronAPI.startLlmStream
      window.electronAPI.startLlmStream = async () => {
        throw new Error('mock failure for overflow test')
      }
    })

    const longText = 'https://example.com/'.repeat(18)
    await chatPage.fill('[data-testid="chat-input"]', longText)
    await chatPage.click('[data-testid="chat-send"]')
    await chatPage.waitForTimeout(150)

    const overflow = await chatPage.evaluate(() => {
      const shell = document.querySelector('[data-testid="chat-shell"]')
      const candidates = Array.from(document.querySelectorAll(
        '.chat-window-header, .chat-window-meta, .chat-window-item span, [data-testid="chat-status"]'
      ))
      const offenders = candidates.filter((node) => node.scrollWidth > node.clientWidth + 1)
      return {
        shellOverflow: Boolean(shell && shell.scrollWidth > shell.clientWidth + 1),
        offenderCount: offenders.length,
      }
    })

    expect(overflow.shellOverflow).toBe(false)
    expect(overflow.offenderCount).toBe(0)
  })

  test('dragging to far top-left stays within display bounds', async () => {
    const runtime = await getRuntimeState(ctx.page)
    const main = runtime.windows.main.bounds

    await ctx.page.evaluate(({ startX, startY }) => {
      window.electronAPI.startPetDrag(startX, startY)
      window.electronAPI.movePetDrag(-99999, -99999)
      window.electronAPI.endPetDrag()
    }, {
      startX: main.x + Math.round(main.width / 2),
      startY: main.y + Math.round(main.height / 2),
    })

    await expect.poll(async () => getRuntimeState(ctx.page)).toBeTruthy()
    const next = await getRuntimeState(ctx.page)
    const nextMain = next?.windows?.main?.bounds
    const display = next?.windows?.main?.display
    const maxTopOverflow = Math.max(0, Number(nextMain?.height || 0) - 48)
    expect(nextMain).toBeTruthy()
    expect(display).toBeTruthy()
    expect(nextMain.x).toBeGreaterThanOrEqual(display.x)
    expect(nextMain.y).toBeGreaterThanOrEqual(display.y - maxTopOverflow)
    expect(nextMain.x + nextMain.width).toBeLessThanOrEqual(display.x + display.width)
    expect(nextMain.y + nextMain.height).toBeLessThanOrEqual(display.y + display.height)
  })

  test('settings AI/语音配置已整合且不再显示高级分区', async () => {
    const settingsPage = await ensureSettingsOpen(ctx)
    await settingsPage.waitForSelector('text=AI 配置')
    await settingsPage.waitForSelector('text=语音配置')
    await settingsPage.waitForSelector('label:has-text("Temperature") input')
    await settingsPage.waitForSelector('label:has-text("上下文条数") input')
    await settingsPage.waitForSelector('label:has-text("TTS 格式") select')
    await settingsPage.waitForSelector('label:has-text("TTS 采样率") input')

    const legacyAdvancedExists = await settingsPage.evaluate(() => ({
      llm: Boolean(document.querySelector('[data-testid="settings-llm-advanced"]')),
      voice: Boolean(document.querySelector('[data-testid="settings-voice-advanced"]')),
      profile: Boolean(document.querySelector('[data-testid="settings-profile-advanced"]')),
    }))
    expect(legacyAdvancedExists).toEqual({ llm: false, voice: false, profile: false })
  })

  test('memory role context keeps export and timeline role in sync', async () => {
    const settingsPage = await ensureSettingsOpen(ctx)
    await settingsPage.click('button:has-text("记忆中心")')
    await settingsPage.waitForSelector('[data-testid="memory-role-select"]')

    const roleSelect = settingsPage.locator('[data-testid="memory-role-select"]')
    const roleOptions = roleSelect.locator('option')
    const roleCount = await roleOptions.count()
    expect(roleCount).toBeGreaterThan(0)
    await expect(roleOptions.first()).toHaveText('全部')
    test.skip(roleCount < 2, 'At least one active role is required for role-scoped memory view')

    await settingsPage.waitForSelector('[data-testid="memory-export-run"]')
    await settingsPage.click('[data-testid="memory-export-toggle"]')
    await settingsPage.waitForSelector('[data-testid="memory-export-scope-group"]')
    await settingsPage.waitForSelector('[data-testid="memory-export-format-group"]')

    const getChecked = async (selector) => {
      return settingsPage.locator(`${selector} input[type="checkbox"]`).isChecked()
    }

    // 默认导出范围=全部，默认格式=仅 Markdown
    expect(await getChecked('[data-testid="memory-scope-all"]')).toBe(true)
    expect(await getChecked('[data-testid="memory-scope-chats"]')).toBe(true)
    expect(await getChecked('[data-testid="memory-scope-summaries"]')).toBe(true)
    expect(await getChecked('[data-testid="memory-scope-profile"]')).toBe(true)
    expect(await getChecked('[data-testid="memory-format-markdown"]')).toBe(true)
    expect(await getChecked('[data-testid="memory-format-json"]')).toBe(false)
    expect(await getChecked('[data-testid="memory-format-jsonl"]')).toBe(false)

    await settingsPage.click('[data-testid="memory-scope-summaries"]')
    expect(await getChecked('[data-testid="memory-scope-all"]')).toBe(false)
    expect(await getChecked('[data-testid="memory-scope-summaries"]')).toBe(false)
    await settingsPage.click('[data-testid="memory-scope-all"]')
    expect(await getChecked('[data-testid="memory-scope-all"]')).toBe(true)
    expect(await getChecked('[data-testid="memory-scope-summaries"]')).toBe(true)

    const targetIndex = roleCount > 2 ? 2 : 1
    const targetRoleLabel = String(await roleOptions.nth(targetIndex).textContent() || '').trim()
    await roleSelect.selectOption({ index: targetIndex })

    await expect.poll(async () => {
      return String(await settingsPage.locator('[data-testid="memory-export-target"]').textContent() || '')
    }).toContain(targetRoleLabel)

    await settingsPage.waitForSelector('button:has-text("查看全部")')
  })

  test('role voice config can be saved from editor modal', async () => {
    const settingsPage = await ensureSettingsOpen(ctx)
    await settingsPage.click('[data-testid="role-card-baihu"]')
    await settingsPage.waitForSelector('.role-modal')

    await settingsPage.locator('[data-testid="role-voice-type"]').selectOption('zh_female_xiaohe_uranus_bigtts')
    await settingsPage.locator('[data-testid="role-voice-emotion"]').selectOption('comfort')
    await settingsPage.click('.role-modal-footer button:has-text("保存角色")')

    await expect.poll(async () => {
      return settingsPage.evaluate(async () => {
        const rows = await window.electronAPI.listCharacters()
        const role = rows.find((item) => item.id === 'baihu')
        return {
          voiceType: String(role?.voiceType || ''),
          voiceEmotion: String(role?.voiceEmotion || ''),
        }
      })
    }).toEqual({
      voiceType: 'zh_female_xiaohe_uranus_bigtts',
      voiceEmotion: 'comfort',
    })
  })

  test('dragging to far bottom-right stays within display bounds', async () => {
    const runtime = await getRuntimeState(ctx.page)
    const main = runtime.windows.main.bounds

    await ctx.page.evaluate(({ startX, startY }) => {
      window.electronAPI.startPetDrag(startX, startY)
      window.electronAPI.movePetDrag(99999, 99999)
      window.electronAPI.endPetDrag()
    }, {
      startX: main.x + Math.round(main.width / 2),
      startY: main.y + Math.round(main.height / 2),
    })

    await expect.poll(async () => getRuntimeState(ctx.page)).toBeTruthy()
    const next = await getRuntimeState(ctx.page)
    expectMainWindowInsideDisplay(next)
  })

  test('stress switch+resize then tap still works', async () => {
    const active = await getActiveCharacters(ctx.page)
    test.skip(active.length < 2, 'At least two active characters are required')

    for (let i = 0; i < 20; i += 1) {
      const target = active[i % active.length].id
      await switchCharacter(ctx.page, target)
      const scale = i % 2 === 0 ? 0.9 : 1.2
      await ctx.page.evaluate((value) => window.e2eAPI.resizePetScale(value), scale)
    }

    await tapAndExpectIncrement(ctx.page)
  })

  test('50 role switches then burst taps remain responsive', async () => {
    test.setTimeout(120_000)
    const active = await getActiveCharacters(ctx.page)
    test.skip(active.length < 2, 'At least two active characters are required')

    for (let i = 0; i < 50; i += 1) {
      const target = active[i % active.length].id
      await switchCharacter(ctx.page, target)
    }

    for (let i = 0; i < 10; i += 1) {
      await tapAndExpectIncrement(ctx.page)
    }
  })

  test('rapid taps trigger audio playback', async () => {
    const tapCount = 20
    await ensurePetInteractive(ctx.page)

    await ctx.page.evaluate(() => {
      if (window.__e2eAudioProbeInstalled) return
      window.__e2eAudioProbeInstalled = true
      window.__e2eAudioPlayCount = 0
      window.__e2eOriginalRandom = Math.random
      Math.random = () => 0.5

      const originalPlay = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function patchedPlay(...args) {
        if (this instanceof HTMLAudioElement) {
          window.__e2eAudioPlayCount += 1
        }
        try {
          return originalPlay.apply(this, args)
        } catch {
          return Promise.resolve()
        }
      }
    })

    const before = await getPetCount(ctx.page)
    for (let i = 0; i < tapCount; i += 1) {
      await ctx.page.click('[data-testid="pet-character"]', { button: 'left' })
    }

    await expect.poll(async () => getPetCount(ctx.page)).toBe(before + tapCount)

    const playCount = await ctx.page.evaluate(() => Number(window.__e2eAudioPlayCount || 0))
    expect(playCount).toBeGreaterThanOrEqual(tapCount)
  })

  test('chat send failure shows readable error in message and status', async () => {
    const chatPage = await ensureChatOpen(ctx)

    await chatPage.evaluate(() => {
      const originalGetAppConfig = window.electronAPI.getAppConfig
      window.electronAPI.getAppConfig = async () => {
        const config = await originalGetAppConfig()
        return {
          ...config,
          llm: {
            ...(config.llm || {}),
            apiKeyConfigured: true,
          },
        }
      }
      window.__e2eOriginalStartLlmStream = window.electronAPI.startLlmStream
      window.electronAPI.startLlmStream = async () => {
        throw new Error('模拟请求失败: 503 gateway timeout while contacting model backend')
      }
    })

    await chatPage.fill('[data-testid="chat-input"]', '你好')
    await chatPage.click('[data-testid="chat-send"]')

    const assistantLast = chatPage.locator('.chat-window-item--assistant span').last()
    await expect(assistantLast).toContainText(/说明：/)
    await expect(assistantLast).toContainText(/建议：/)
    await expect(chatPage.locator('[data-testid="chat-status"]')).toContainText('出现错误，请查看上方消息详情')
    await expect(assistantLast).not.toHaveText('...')
  })

  test('chat without api key shows playful hint instead of dots', async () => {
    const chatPage = await ensureChatOpen(ctx)

    await chatPage.evaluate(async () => {
      await window.electronAPI.setAppConfig({ llm: { apiKey: '' } })
    })

    await chatPage.fill('[data-testid="chat-input"]', '在吗')
    await chatPage.click('[data-testid="chat-send"]')

    const assistantLast = chatPage.locator('.chat-window-item--assistant span').last()
    await expect(assistantLast).toContainText('API Key')
    await expect(assistantLast).toContainText(/说明：/)
    await expect(assistantLast).toContainText(/建议：/)
    await expect(chatPage.locator('[data-testid="chat-status"]')).toContainText('出现错误，请查看上方消息详情')
    await expect(assistantLast).not.toHaveText('...')
  })

  test('voice tip refreshes when playback config changes while chat is open', async () => {
    await configureVoice(ctx.page, { autoPlay: false })
    const chatPage = await ensureChatOpen(ctx)
    await expect(chatPage.locator('[data-testid="chat-status"]')).toContainText('语音播放关')

    await configureVoice(ctx.page, { autoPlay: true })
    await chatPage.evaluate(() => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(chatPage.locator('[data-testid="chat-status"]')).toContainText('语音播放开')
  })

  test('chat playback toggle persists across restart', async () => {
    await configureVoice(ctx.page, { autoPlay: true })
    let chatPage = await ensureChatOpen(ctx)
    await expect(chatPage.locator('[data-testid="chat-status"]')).toContainText('语音播放开')

    await chatPage.click('[data-testid="chat-voice-playback-toggle"]')
    await expect(chatPage.locator('[data-testid="chat-status"]')).toContainText('语音播放关')

    const keepDir = ctx.userDataDir
    await closeApp(ctx, { keepUserDataDir: true })
    ctx = await launchApp({ userDataDir: keepDir })

    chatPage = await ensureChatOpen(ctx)
    await expect(chatPage.locator('[data-testid="chat-status"]')).toContainText('语音播放关')
  })

  test('saving llm config does not overwrite unsaved voice edits', async () => {
    await ctx.page.evaluate(async () => {
      await window.electronAPI.setAppConfig({
        llm: { baseUrl: 'https://llm-origin.example/v1/chat/completions' },
        voice: { appId: 'voice-origin-app' },
      })
    })

    const settingsPage = await ensureSettingsOpen(ctx)
    const llmInput = settingsPage.locator('label:has-text("API URL") input')
    const voiceAppIdInput = settingsPage.locator('label:has-text("语音 AppID") input')
    const saveLlmBtn = settingsPage.locator('button:has-text("保存 AI 配置")')

    await llmInput.fill('https://llm-updated.example/v1/chat/completions')
    await voiceAppIdInput.fill('voice-unsaved-draft')
    await saveLlmBtn.click()

    const nextConfig = await settingsPage.evaluate(() => window.electronAPI.getAppConfig())
    expect(String(nextConfig?.llm?.baseUrl || '')).toBe('https://llm-updated.example/v1/chat/completions')
    expect(String(nextConfig?.voice?.appId || '')).toBe('voice-origin-app')
  })

  test('voice stream partial updates input before stop', async () => {
    await configureVoice(ctx.page, { autoPlay: false })
    const chatPage = await ensureChatOpen(ctx)

    await chatPage.evaluate(() => {
      if (window.__e2eVoiceRealtimeMockInstalled) return
      window.__e2eVoiceRealtimeMockInstalled = true
      let activeSessionId = ''
      window.__e2eVoiceRealtimePushHit = 0
      window.__e2eVoiceRealtimeStopHit = 0
      window.__e2eVoiceRealtimeEmitPartialHit = 0
      window.__e2eVoiceRealtimeEmitFinalHit = 0

      window.__e2eChatVoiceApiMock = {
        startVoiceStream: async () => {
          activeSessionId = 'e2e-rt-session'
          return { sessionId: activeSessionId }
        },
        pushVoiceStreamChunk: async () => {
          window.__e2eVoiceRealtimePushHit += 1
          const payload = { sessionId: activeSessionId, text: '实时片段' }
          if (window.__e2eChatVoiceStreamHooks?.emitPartial) {
            window.__e2eVoiceRealtimeEmitPartialHit += 1
            window.__e2eChatVoiceStreamHooks.emitPartial(payload)
          }
          return { ok: true }
        },
        stopVoiceStream: async () => {
          window.__e2eVoiceRealtimeStopHit += 1
          const payload = { sessionId: activeSessionId, text: '最终识别结果' }
          if (window.__e2eChatVoiceStreamHooks?.emitFinal) {
            window.__e2eVoiceRealtimeEmitFinalHit += 1
            window.__e2eChatVoiceStreamHooks.emitFinal(payload)
          }
          return { text: payload.text }
        },
        cancelVoiceStream: async () => ({ canceled: true }),
      }

      class FakeMediaRecorder {
        static isTypeSupported() {
          return true
        }

        constructor(stream, options = {}) {
          this.stream = stream
          this.mimeType = options.mimeType || 'audio/webm'
          this.state = 'inactive'
          this.ondataavailable = null
          this.onstop = null
          this.onerror = null
        }

        start() {
          this.state = 'recording'
          setTimeout(() => {
            this.ondataavailable && this.ondataavailable({
              data: new Blob(['voice-rt'], { type: this.mimeType }),
            })
          }, 8)
        }

        stop() {
          this.state = 'inactive'
          setTimeout(() => {
            this.onstop && this.onstop()
          }, 8)
        }
      }

      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => ({
            getTracks: () => [{ stop() {} }],
          }),
        },
      })
      window.MediaRecorder = FakeMediaRecorder
    })

    await chatPage.click('[data-testid="chat-voice-toggle"]')
    await expect(chatPage.locator('[data-testid="chat-input"]')).toHaveValue(/实时片段/)
    await chatPage.click('[data-testid="chat-voice-toggle"]')
    await expect(chatPage.locator('[data-testid="chat-input"]')).toHaveValue(/最终识别结果/)
    const runtime = await chatPage.evaluate(() => ({
      pushHit: Number(window.__e2eVoiceRealtimePushHit || 0),
      stopHit: Number(window.__e2eVoiceRealtimeStopHit || 0),
      partialHit: Number(window.__e2eVoiceRealtimeEmitPartialHit || 0),
      finalHit: Number(window.__e2eVoiceRealtimeEmitFinalHit || 0),
    }))
    expect(runtime.pushHit).toBeGreaterThan(0)
    expect(runtime.stopHit).toBeGreaterThan(0)
    expect(runtime.partialHit).toBeGreaterThan(0)
    expect(runtime.finalHit).toBeGreaterThan(0)
  })

  test('voice stream keeps committed prefix when final text is shorter', async () => {
    await configureVoice(ctx.page, { autoPlay: false })
    const chatPage = await ensureChatOpen(ctx)

    await chatPage.evaluate(() => {
      if (window.__e2eVoicePrefixGuardMockInstalled) return
      window.__e2eVoicePrefixGuardMockInstalled = true
      let activeSessionId = ''
      let partialSeq = 0
      window.__e2eVoicePrefixGuardFinalHit = 0

      window.__e2eChatVoiceApiMock = {
        startVoiceStream: async () => {
          activeSessionId = 'e2e-prefix-guard-session'
          partialSeq = 0
          return { sessionId: activeSessionId }
        },
        pushVoiceStreamChunk: async () => {
          partialSeq += 1
          const payload = partialSeq === 1
            ? {
              sessionId: activeSessionId,
              text: '哈喽哈喽你是谁',
              utterances: [
                { text: '哈喽哈喽', definite: true, startTime: 0, endTime: 600 },
                { text: '你是谁', definite: false, startTime: 601, endTime: 1200 },
              ],
            }
            : {
              sessionId: activeSessionId,
              text: '你是谁',
              utterances: [
                { text: '你是谁', definite: false, startTime: 0, endTime: 1200 },
              ],
            }
          window.__e2eChatVoiceStreamHooks?.emitPartial?.(payload)
          return { ok: true }
        },
        stopVoiceStream: async () => {
          window.__e2eVoicePrefixGuardFinalHit += 1
          const payload = { sessionId: activeSessionId, text: '你是谁' }
          window.__e2eChatVoiceStreamHooks?.emitFinal?.(payload)
          return { text: payload.text }
        },
        cancelVoiceStream: async () => ({ canceled: true }),
      }

      class FakeMediaRecorder {
        static isTypeSupported() {
          return true
        }

        constructor(stream, options = {}) {
          this.stream = stream
          this.mimeType = options.mimeType || 'audio/webm'
          this.state = 'inactive'
          this.ondataavailable = null
          this.onstop = null
          this.onerror = null
        }

        start() {
          this.state = 'recording'
          setTimeout(() => {
            this.ondataavailable && this.ondataavailable({
              data: new Blob(['voice-prefix-guard-1'], { type: this.mimeType }),
            })
          }, 8)
          setTimeout(() => {
            this.ondataavailable && this.ondataavailable({
              data: new Blob(['voice-prefix-guard-2'], { type: this.mimeType }),
            })
          }, 16)
        }

        stop() {
          this.state = 'inactive'
          setTimeout(() => {
            this.onstop && this.onstop()
          }, 8)
        }
      }

      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => ({
            getTracks: () => [{ stop() {} }],
          }),
        },
      })
      window.MediaRecorder = FakeMediaRecorder
    })

    await chatPage.click('[data-testid="chat-voice-toggle"]')
    await expect(chatPage.locator('[data-testid="chat-input"]')).toHaveValue(/哈喽哈喽你是谁/)
    await chatPage.click('[data-testid="chat-voice-toggle"]')
    await expect(chatPage.locator('[data-testid="chat-input"]')).toHaveValue(/哈喽哈喽你是谁/)
  })

  test('voice stream stop failure falls back to full transcribe', async () => {
    await configureVoice(ctx.page, { autoPlay: false })
    const chatPage = await ensureChatOpen(ctx)

    await chatPage.evaluate(() => {
      if (window.__e2eVoiceFallbackMockInstalled) return
      window.__e2eVoiceFallbackMockInstalled = true
      let activeSessionId = ''
      window.__e2eFallbackHit = 0
      window.__e2eFallbackPushHit = 0
      window.__e2eFallbackStopHit = 0

      window.__e2eChatVoiceApiMock = {
        startVoiceStream: async () => {
          activeSessionId = 'e2e-fallback-session'
          return { sessionId: activeSessionId }
        },
        pushVoiceStreamChunk: async () => {
          window.__e2eFallbackPushHit += 1
          return { ok: true }
        },
        stopVoiceStream: async () => {
          window.__e2eFallbackStopHit += 1
          throw new Error('ASR 未返回可识别文本，请重试或检查录音内容')
        },
        transcribeVoice: async () => {
          window.__e2eFallbackHit += 1
          return { text: '兜底识别文本' }
        },
        cancelVoiceStream: async () => ({ canceled: true }),
      }

      class FakeMediaRecorder {
        static isTypeSupported() {
          return true
        }

        constructor(stream, options = {}) {
          this.stream = stream
          this.mimeType = options.mimeType || 'audio/webm'
          this.state = 'inactive'
          this.ondataavailable = null
          this.onstop = null
          this.onerror = null
        }

        start() {
          this.state = 'recording'
          setTimeout(() => {
            this.ondataavailable && this.ondataavailable({
              data: new Blob(['voice-fallback'], { type: this.mimeType }),
            })
          }, 8)
        }

        stop() {
          this.state = 'inactive'
          setTimeout(() => {
            this.onstop && this.onstop()
          }, 8)
        }
      }

      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => ({
            getTracks: () => [{ stop() {} }],
          }),
        },
      })
      window.MediaRecorder = FakeMediaRecorder
    })

    await chatPage.click('[data-testid="chat-voice-toggle"]')
    await chatPage.waitForTimeout(120)
    await chatPage.click('[data-testid="chat-voice-toggle"]')

    await expect(chatPage.locator('[data-testid="chat-input"]')).toHaveValue(/兜底识别文本/)
    const runtime = await chatPage.evaluate(() => ({
      fallbackHit: Number(window.__e2eFallbackHit || 0),
      pushHit: Number(window.__e2eFallbackPushHit || 0),
      stopHit: Number(window.__e2eFallbackStopHit || 0),
    }))
    expect(runtime.pushHit).toBeGreaterThan(0)
    expect(runtime.stopHit).toBeGreaterThan(0)
    const fallbackHit = runtime.fallbackHit
    expect(fallbackHit).toBeGreaterThan(0)
  })

  test('voice transcribe failure shows readable error in chat', async () => {
    await configureVoice(ctx.page, { autoPlay: false })
    const chatPage = await ensureChatOpen(ctx)

    await chatPage.evaluate(() => {
      if (!window.__e2eVoiceRecordMockInstalled) {
        window.__e2eVoiceRecordMockInstalled = true

        class FakeMediaRecorder {
          static isTypeSupported() {
            return true
          }

          constructor(stream, options = {}) {
            this.stream = stream
            this.mimeType = options.mimeType || 'audio/webm'
            this.state = 'inactive'
            this.ondataavailable = null
            this.onstop = null
            this.onerror = null
          }

          start() {
            this.state = 'recording'
            setTimeout(() => {
              this.ondataavailable && this.ondataavailable({
                data: new Blob(['fake-audio'], { type: this.mimeType }),
              })
            }, 8)
          }

          stop() {
            this.state = 'inactive'
            setTimeout(() => {
              this.onstop && this.onstop()
            }, 8)
          }
        }

        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: {
            getUserMedia: async () => ({
              getTracks: () => [{ stop() {} }],
            }),
          },
        })
        window.MediaRecorder = FakeMediaRecorder
      }

    })

    await chatPage.click('[data-testid="chat-voice-toggle"]')
    await chatPage.waitForTimeout(30)
    await chatPage.click('[data-testid="chat-voice-toggle"]')

    const assistantLast = chatPage.locator('.chat-window-item--assistant span').last()
    await expect(assistantLast).toContainText(/语音|ASR/)
    await expect(assistantLast).toContainText('缺少语音 AppID')
    await expect(assistantLast).not.toHaveText('...')
  })

  test('voice autoplay switch controls tts trigger', async () => {
    await configureVoice(ctx.page, { autoPlay: false })
    let chatPage = await ensureChatOpen(ctx)

    await chatPage.evaluate(async () => {
      const waitHook = async () => {
        const start = Date.now()
        while (Date.now() - start < 4000) {
          if (window.__e2eChatVoiceHooks && typeof window.__e2eChatVoiceHooks.triggerVoicePlayback === 'function') {
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        throw new Error('voice hook timeout')
      }
      await waitHook()
      await window.__e2eChatVoiceHooks.triggerVoicePlayback('自动播报关闭时不应触发')
    })
    const lastTextOff = await chatPage.locator('.chat-window-item--assistant span').last().textContent().catch(() => '')
    expect(String(lastTextOff || '')).not.toContain('缺少语音 AppID')

    await closeApp(ctx)
    ctx = await launchApp()
    await configureVoice(ctx.page, { autoPlay: true })
    chatPage = await ensureChatOpen(ctx)

    await chatPage.evaluate(async () => {
      const waitHook = async () => {
        const start = Date.now()
        while (Date.now() - start < 4000) {
          if (window.__e2eChatVoiceHooks && typeof window.__e2eChatVoiceHooks.triggerVoicePlayback === 'function') {
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        throw new Error('voice hook timeout')
      }
      await waitHook()
      await window.__e2eChatVoiceHooks.triggerVoicePlayback('自动播报开启时应触发')
    })

    const assistantLast = chatPage.locator('.chat-window-item--assistant span').last()
    await expect(assistantLast).toContainText('语音')
    await expect(assistantLast).toContainText('缺少语音 AppID')
  })

  test('live tts from docs api can synthesize and play', async () => {
    test.setTimeout(120_000)
    const projectRoot = path.resolve(__dirname, '../..')
    const liveConfig = loadLiveVoiceConfig(projectRoot)

    await configureVoice(ctx.page, {
      region: 'cn-beijing',
      appId: liveConfig.appId,
      accessKey: liveConfig.accessToken,
      ttsResourceId: 'seed-tts-2.0',
      autoPlay: true,
    })

    const ttsProbe = await ctx.page.evaluate(async () => {
      return window.electronAPI.synthesizeVoice({
        text: '白虎实时语音合成探针',
        charId: 'baihu',
      })
    })
    expect(String(ttsProbe?.audioBase64 || '').length).toBeGreaterThan(120)

    const chatPage = await ensureChatOpen(ctx)
    await expect(chatPage.locator('[data-testid="chat-status"]')).toContainText('语音播放开')

    await chatPage.evaluate(async () => {
      const waitHook = async () => {
        const start = Date.now()
        while (Date.now() - start < 5000) {
          if (window.__e2eChatVoiceHooks && typeof window.__e2eChatVoiceHooks.triggerVoicePlayback === 'function') {
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 30))
        }
        throw new Error('live voice hook timeout')
      }
      await waitHook()
      await window.__e2eChatVoiceHooks.triggerVoicePlayback('白虎实时语音测试')
    })

    await expect.poll(async () => {
      const tip = await chatPage.locator('[data-testid="chat-status"]').textContent().catch(() => '')
      return String(tip || '').includes('正在语音播报')
    }, { timeout: 12_000 }).toBe(true)

    await chatPage.waitForTimeout(2500)
    const errorText = await chatPage.locator('[data-testid="chat-status"]').textContent().catch(() => '')
    expect(String(errorText || '')).not.toMatch(/缺少语音|TTS 请求失败|语音功能暂不可用|语音链路异常|语音系统异常|未返回音频/)
  })
})
