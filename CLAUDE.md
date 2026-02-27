# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

木鱼桌宠 (muyu-desktop) — an Electron desktop pet app (Mac-first) migrated from a WeChat mini-program. A transparent, always-on-top pet character that users can tap, drag, and chat with via LLM integration.

## Commands

```bash
npm run dev              # Start Vite dev server + Electron together
npm run build            # Build renderer + package with electron-builder
npm run rebuild-native   # Rebuild better-sqlite3 for current Electron (run after Electron version changes)
npm run test:e2e         # Playwright Electron regression tests
OPEN_DEVTOOLS=1 npm run dev  # Dev with devtools auto-opened
```

## Architecture

**Three Electron windows, one renderer bundle** — all windows load the same Vite-built React app, routed by `?view=` query parameter:
- `mainWindow` (240×340px, frameless, transparent, always-on-top, click-through by default) → `GameView`
- `chatWindow` (320×420px, frameless, transparent, docked to pet) → `ChatWindowView`
- `settingsWindow` (920×700px, framed) → `SettingsView`

**Module system split:**
- Main process (`src/main/`): **CommonJS** (`require`/`module.exports`)
- Renderer (`src/renderer/`): **ESM** (`import`/`export`)
- `src/shared/ipc-channels.js`: CJS — renderer never imports it directly; channel strings are inlined in preload

**IPC triple-sync rule** — any new IPC channel must be added in three places:
1. `src/shared/ipc-channels.js` — constant definition
2. `src/main/main.js` — `ipcMain.handle()` or `ipcMain.on()` handler
3. `src/main/preload.js` — `contextBridge` method exposing it to renderer

**State management:** No global store. Component-local `useState`/`useRef`. Cross-window coordination via IPC events. Persistent state in SQLite (`better-sqlite3`, WAL mode).

**Asset paths:** `assets/` is Vite's `publicDir`, so reference as `/images/...` and `/audio/...` (no `assets/` prefix). In production builds, `extraResources` copies `assets/` to `resources/assets/`.

**Path alias:** `@` maps to `src/` (configured in `vite.config.js`).

## Key Patterns

- **Security:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on all windows. API keys encrypted via `safeStorage`.
- **Mouse passthrough:** Main window uses `setIgnoreMouseEvents(true, { forward: true })`; elements with `data-hit-area="1"` toggle it off on hover.
- **Dual A/B animations:** CSS keyframes alternate between `shake-anim-a/b`, `squeeze-anim-a/b` classes to re-trigger on same element.
- **Character data flow:** DB rows merged over `DEFAULT_CHARACTERS` fallback via `mergeCharacters()`. Changes broadcast via `characters-updated` IPC to all windows.
- **LLM streaming:** SSE-based, supports both `/chat/completions` and `/responses` API modes with auto-detection and fallback.
- **Scale system:** 0.6x–1.8x range, clamped in both main and renderer. Stored in `app_state` table.

## Coding Style

- JavaScript/JSX only (no TypeScript)
- 2-space indent, single quotes, no semicolons
- `PascalCase` components, `camelCase` functions/vars, `UPPER_SNAKE_CASE` shared constants
- Conventional Commits (`feat:`, `fix:`, `refactor:`, etc.)

## Testing

- Playwright Electron e2e tests in `tests/e2e/` — tests launch fresh Electron instances with temp `userData` dirs
- `data-testid` attributes for test selectors (e.g., `pet-page`, `chat-root`, `chat-input`)
- Tests must run serially (`workers: 1`) due to Electron constraints
- Run `npm run test:e2e` before PRs touching interactions, windows, chat, or settings
