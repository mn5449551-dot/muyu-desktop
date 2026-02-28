# muyu-desktop

Electron desktop pet app with chat, voice input/output, role switching, memory summaries, and export tools.

## Platform Support

- macOS: `dmg` installer
- Windows: `zip` portable package
- iOS: not supported in this Electron repository

## What This Project Does

`muyu-desktop` provides:

- A floating desktop pet window with tap interactions
- A chat window with per-role sessions
- Voice input (streaming/file ASR) and voice playback (TTS)
- Long-term memory summary and profile conflict handling
- Settings and memory management panels
- Export of chats/summaries/profile to Markdown/JSON/JSONL

## Quick Start

Requirements:

- Node.js and npm
- macOS or Windows for local development/build

Install and run:

```bash
npm install
npm run rebuild-native
npm run dev
```

Notes:

- `npm run rebuild-native` is required after Electron or Node runtime changes (for `better-sqlite3`).
- `npm run dev` starts Vite and Electron together.

## Scripts

- `npm run dev`: start renderer (Vite) and Electron
- `npm run start:vite`: renderer dev server only (`http://localhost:5173`)
- `npm run start:electron`: launch Electron against running Vite server
- `npm run build:renderer`: build renderer to `dist/renderer`
- `npm run build:mac`: build macOS `dmg` to `dist-electron`
- `npm run build:win`: build Windows `zip` to `dist-electron`
- `npm run build`: build renderer and package app to `dist-electron`
- `npm run release:check`: quick pre-release check (`build:renderer` + targeted e2e)
- `npm run rebuild-native`: rebuild `better-sqlite3` for Electron runtime
- `npm run test:e2e`: run Playwright Electron regressions
- `npm run test:e2e:debug`: run e2e tests with `PWDEBUG=1`

## Project Structure

- `src/main/`: Electron main process, IPC handlers, DB, services
- `src/renderer/`: React UI for pet/chat/settings/memory views
- `src/shared/`: IPC channel constants shared by main/renderer
- `src/utils/`: shared utility functions
- `assets/`: packaged images/audio resources
- `tests/e2e/`: Playwright Electron regression tests
- `dist/renderer/`: renderer production output
- `dist-electron/`: packaged desktop artifacts

## Data and Security

- App data is stored under `app.getPath('userData')`
- Typical macOS path: `~/Library/Application Support/muyu-desktop/`
- SQLite DB file: `muyu.db` inside user data directory
- API keys/tokens are encrypted with Electron `safeStorage`
- Exported docs (`.md`, `.json`, `.jsonl`) contain user data and should be treated as sensitive

## API Key 获取与配置（火山引擎）

本项目默认使用火山能力：

- LLM（方舟）接口：`https://ark.cn-beijing.volces.com/api/v3/chat/completions`
- 语音（ASR/TTS）接口：豆包语音

获取入口（官方）：

- 方舟控制台（LLM API Key）：`https://console.volcengine.com/ark`
- 豆包语音快速入门（AppID/Access Token）：`https://www.volcengine.com/docs/6561/2119699`
- 音色列表（`voice_type` / `emotion`）：`https://www.volcengine.com/docs/6561/1257544`
- TTS V3 文档：`https://www.volcengine.com/docs/6561/1598757`
- ASR 流式文档：`https://www.volcengine.com/docs/6561/1354869`

在应用中配置：

1. 打开设置面板。
2. 在 AI 配置中填写 LLM API Key（以及 Base URL/Model）。
3. 在语音配置中填写 `AppID`、`Access Token`、`ASR 资源 ID`、`TTS 资源 ID`。
4. 点击“保存”并执行“测试连通”。

注意：

- 不要把真实 API Key / Token 提交到 GitHub。
- 本地保存会使用 Electron `safeStorage` 加密。

## Testing

Primary regression suite:

```bash
npm run test:e2e
```

Playwright config:

- Config file: `playwright.e2e.config.js`
- Report output: `artifacts/e2e/report`
- Test artifacts: `artifacts/e2e/test-results`

## Release (GitHub)

Release pipeline is defined in:

- `.github/workflows/release.yml`
- [Latest Release Page](https://github.com/mn5449551-dot/muyu-desktop/releases/latest)
- Direct download (Windows x64): [muyu-desktop-win-x64.zip](https://github.com/mn5449551-dot/muyu-desktop/releases/latest/download/muyu-desktop-win-x64.zip)
- Direct download (macOS Apple Silicon): [muyu-desktop-mac-arm64.dmg](https://github.com/mn5449551-dot/muyu-desktop/releases/latest/download/muyu-desktop-mac-arm64.dmg)
- Direct download (macOS Intel): [muyu-desktop-mac-x64.dmg](https://github.com/mn5449551-dot/muyu-desktop/releases/latest/download/muyu-desktop-mac-x64.dmg)

Trigger:

- Push a tag like `v0.1.0`

Pipeline behavior:

- Build macOS artifact (`.dmg`) on `macos-latest`
- Build Windows artifact (`.zip`) on `windows-latest`
- Upload both artifacts to GitHub Release for that tag

Detailed release steps are in:

- `docs/release.md`

## What To Upload To GitHub

Keep in repository:

- Source code: `src/`, `tests/`, `assets/`
- Build config: `package.json`, `package-lock.json`, `vite.config.js`, `playwright.e2e.config.js`
- Documentation: `README.md`, `docs/` (technical docs)

Do not upload:

- Build outputs: `dist/`, `dist-electron/`
- Dependencies: `node_modules/`
- Test outputs: `artifacts/`, `test-results/`
- Local secrets and environment files: `.env*`
- Local databases: `*.db`, `*.sqlite`, `*.sqlite3`

## Troubleshooting

- Native module mismatch (`better-sqlite3` load errors):
  - Run `npm run rebuild-native`
- Electron starts but renderer is blank in dev:
  - Ensure `npm run start:vite` is running on `http://localhost:5173`
- Voice/chat requests fail due to missing credentials:
  - Configure LLM API key and voice settings in the app settings panel

## Development Notes

- Main process uses CommonJS (`require/module.exports`)
- Renderer uses ESM and React
- Keep IPC changes aligned in:
  - `src/shared/ipc-channels.js`
  - `src/main/main.js`
  - `src/main/preload.js`

Last reviewed: 2026-02-28
