# Repository Guidelines

## Project Structure & Module Organization
- `src/main/`: Electron main process (`main.js`), preload bridge (`preload.js`), SQLite layer (`db.js`), service modules (`services/`).
- `src/renderer/`: React UI views and components (`components/` + `styles/`) for game, chat, and settings.
- `src/shared/`: IPC channel constants shared by main/renderer.
- `assets/`: built-in character images/audio bundled into app resources.
- `tests/e2e/`: Playwright Electron regression tests.
- Outputs: `dist/renderer/` (Vite bundle) and `dist-electron/` (packaged artifacts).

## Build, Test, and Development Commands
- `npm run dev`: start Vite and Electron together for local development.
- `npm run start:vite`: run renderer dev server only (`http://localhost:5173`).
- `npm run start:electron`: launch Electron against a running Vite server.
- `npm run build:renderer`: build renderer into `dist/renderer`.
- `npm run build`: build renderer and package desktop app via `electron-builder`.
- `npm run rebuild-native`: rebuild `better-sqlite3` for the current Electron runtime.
- `npm run test:e2e`: run Playwright Electron regressions (`tests/e2e/pet-regression.e2e.spec.js`).
- `npm run test:e2e:debug`: run Playwright Electron regressions in debug mode (`PWDEBUG=1`).

## Coding Style & Naming Conventions
- Language: JavaScript/JSX (no TypeScript configured).
- Match existing style: 2-space indentation, single quotes, semicolon-free statements.
- Naming: `PascalCase` for React components, `camelCase` for functions/variables, `UPPER_SNAKE_CASE` for shared constants.
- Main process uses CommonJS (`require/module.exports`); renderer uses ESM imports.
- Keep IPC additions synchronized in three places: `src/shared/ipc-channels.js`, `src/main/main.js`, `src/main/preload.js`.

## Testing Guidelines
- Run `npm run test:e2e` before PRs touching interactions, window behavior, chat, or settings.
- Keep regressions green for: role switch + tap responsiveness, resize limits (`0.6x~1.8x`), chat docking, tray hide/restore flows, and chat error UX.
- For new user-visible flows (for example export docs), add or extend Playwright coverage in `tests/e2e/`.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (for example: `feat: add chat export`, `fix: clamp pet scale bounds`).

PRs should include:
- what changed and why;
- manual test steps/results;
- screenshots or GIFs for renderer UI changes;
- linked issue/task ID when available.

## Data & Security Notes
- App data is stored under `app.getPath('userData')` (for macOS: `~/Library/Application Support/muyu-desktop/`), including `muyu.db`.
- API keys are encrypted via Electron `safeStorage`; never print or commit secrets.
- Exported chat/profile memory documents are user data. Treat generated `.md`/`.jsonl` as sensitive.
