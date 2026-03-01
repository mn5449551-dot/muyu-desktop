# muyu-desktop

一个基于 Electron 的桌面木鱼宠物应用，支持聊天、语音输入输出、角色切换、记忆摘要与数据导出。

## 平台支持

- macOS：`dmg` 安装包
- Windows：`zip` 便携包
- iOS：当前仓库不支持（本项目是 Electron 桌面应用）

## 项目功能

`muyu-desktop` 提供以下能力：

- 可悬浮的桌宠窗口与点击互动
- 按角色隔离的聊天会话窗口
- 语音输入（流式/文件 ASR）与语音播放（TTS）
- 长期记忆摘要与人设冲突处理
- 设置面板与记忆管理面板
- 聊天/摘要/人设导出为 Markdown、JSON、JSONL

## 快速开始

环境要求：

- Node.js 与 npm
- macOS 或 Windows（用于本地开发与打包）

安装并运行：

```bash
npm install
npm run rebuild-native
npm run dev
```

说明：

- `npm run rebuild-native`：当 Electron 或 Node 运行时版本变化后，需要重新编译 `better-sqlite3`。
- `npm run dev`：会同时启动 Vite 与 Electron。

## 常用脚本

- `npm run dev`：同时启动渲染进程（Vite）与 Electron
- `npm run start:vite`：仅启动渲染进程开发服务（`http://localhost:5173`）
- `npm run start:electron`：在已有 Vite 服务时启动 Electron
- `npm run build:renderer`：构建渲染资源到 `dist/renderer`
- `npm run build:mac`：打包 macOS `dmg` 到 `dist-electron`
- `npm run build:win`：打包 Windows `zip` 到 `dist-electron`
- `npm run build`：构建渲染资源并打包桌面应用
- `npm run release:check`：发布前快速检查（`build:renderer` + 定向 e2e）
- `npm run rebuild-native`：为当前 Electron 运行时重编译 `better-sqlite3`
- `npm run test:e2e`：运行 Playwright Electron 回归测试
- `npm run test:e2e:debug`：以 `PWDEBUG=1` 调试运行 e2e

## 目录结构

- `src/main/`：Electron 主进程、IPC 处理、数据库、服务模块
- `src/renderer/`：React 界面（桌宠/聊天/设置/记忆）
- `src/shared/`：主进程与渲染进程共享的 IPC 常量
- `src/utils/`：共享工具函数
- `assets/`：打包进应用的图片与音频资源
- `tests/e2e/`：Playwright Electron 回归测试
- `dist/renderer/`：渲染进程生产构建输出
- `dist-electron/`：桌面安装包输出

## 数据与安全

- 应用数据存储在 `app.getPath('userData')`
- macOS 常见路径：`~/Library/Application Support/muyu-desktop/`
- SQLite 数据库文件：用户目录下的 `muyu.db`
- API Key / Token 使用 Electron `safeStorage` 加密保存
- 导出文件（`.md`、`.json`、`.jsonl`）包含用户数据，应按敏感数据处理

## API Key 获取与配置（火山引擎）

本项目默认使用火山能力：

- LLM（方舟）接口：`https://ark.cn-beijing.volces.com/api/v3/chat/completions`
- 语音（ASR/TTS）接口：豆包语音

官方入口：

- 方舟控制台（LLM API Key）：`https://console.volcengine.com/ark`
- 豆包语音快速入门（AppID/Access Token）：`https://www.volcengine.com/docs/6561/2119699`
- 音色列表（`voice_type` / `emotion`）：`https://www.volcengine.com/docs/6561/1257544`
- TTS V3 文档：`https://www.volcengine.com/docs/6561/1598757`
- ASR 流式文档：`https://www.volcengine.com/docs/6561/1354869`

应用内配置步骤：

1. 打开设置面板。
2. 在 AI 配置中填写 LLM API Key（以及 Base URL/Model）。
3. 在语音配置中填写 `AppID`、`Access Token`、`ASR 资源 ID`、`TTS 资源 ID`。
4. 点击“保存”，再执行“测试连通”。

注意事项：

- 不要把真实 API Key / Token 提交到 GitHub。
- 本地存储会通过 Electron `safeStorage` 加密。

## 测试

主要回归测试：

```bash
npm run test:e2e
```

Playwright 相关配置：

- 配置文件：`playwright.e2e.config.js`
- 报告目录：`artifacts/e2e/report`
- 测试产物：`artifacts/e2e/test-results`

## 发布（GitHub）

发布流水线位置：

- `.github/workflows/release.yml`
- [最新 Release 页面](https://github.com/mn5449551-dot/muyu-desktop/releases/latest)
- Windows x64 直链：[muyu-desktop-win-x64.zip](https://github.com/mn5449551-dot/muyu-desktop/releases/latest/download/muyu-desktop-win-x64.zip)
- macOS Apple Silicon 直链：[muyu-desktop-mac-arm64.dmg](https://github.com/mn5449551-dot/muyu-desktop/releases/latest/download/muyu-desktop-mac-arm64.dmg)

触发方式：

- 推送标签，例如 `v0.1.0`

流水线行为：

- 在 `macos-latest` 构建 macOS 安装包（`.dmg`）
- 在 `windows-latest` 构建 Windows 压缩包（`.zip`）
- 将产物上传到对应 tag 的 GitHub Release

详细发布步骤见：

- `docs/release.md`

## GitHub 应上传与不上传

建议上传：

- 源码：`src/`、`tests/`、`assets/`
- 构建配置：`package.json`、`package-lock.json`、`vite.config.js`、`playwright.e2e.config.js`
- 文档：`README.md`、`docs/`

不要上传：

- 构建产物：`dist/`、`dist-electron/`
- 依赖目录：`node_modules/`
- 测试产物：`artifacts/`、`test-results/`
- 本地密钥与环境变量文件：`.env*`
- 本地数据库：`*.db`、`*.sqlite`、`*.sqlite3`

## 故障排查

- 原生模块版本不匹配（`better-sqlite3` 加载报错）：
  - 执行 `npm run rebuild-native`
- Electron 启动但渲染页面空白：
  - 确认 `npm run start:vite` 已运行，地址为 `http://localhost:5173`
- 语音/聊天请求因凭据失败：
  - 在设置面板补全 LLM 与语音配置

## 开发说明

- 主进程使用 CommonJS（`require/module.exports`）
- 渲染进程使用 ESM + React
- 如新增 IPC，请同步以下三个文件：
  - `src/shared/ipc-channels.js`
  - `src/main/main.js`
  - `src/main/preload.js`

最后更新时间：2026-02-28
