# 火山语音关键参考（2026-02-27 核对）

本文整理了本项目接入豆包语音时，来自火山官方文档的关键字段和可直接使用的默认值。

## 1. 官方文档入口（最小必需）

- 音色列表（查 `voice_type`、`emotion`）：<https://www.volcengine.com/docs/6561/1257544>
- TTS V3（查请求头与 `X-Api-Resource-Id`）：<https://www.volcengine.com/docs/6561/1598757>
- ASR 流式识别（查请求头与 `X-Api-Resource-Id`）：<https://www.volcengine.com/docs/6561/1354869>
- 快速入门（控制台取 `AppID/Access Token`）：<https://www.volcengine.com/docs/6561/2119699>

## 2. 鉴权字段（按接口）

### 2.1 TTS V3（HTTP）

- `X-Api-App-Id`：AppID
- `X-Api-Access-Key`：Access Token
- `X-Api-Resource-Id`：资源 ID（如 `seed-tts-2.0`）

### 2.2 ASR 流式（WebSocket）

- `X-Api-App-Key`：AppID（命名与 TTS 不同）
- `X-Api-Access-Key`：Access Token
- `X-Api-Resource-Id`：资源 ID
- `X-Api-Connect-Id`：建议 UUID（排障追踪）

## 3. 推荐资源 ID（首版默认）

- ASR（2.0 流式）：
  - `volc.seedasr.sauc.duration`（小时版）
  - `volc.seedasr.sauc.concurrent`（并发版）
- TTS（2.0）：`seed-tts-2.0`

## 4. 情绪参数（emotion）要点

音色情绪通过 `emotion` 传入。常用中文情绪值包括：

- `happy`
- `angry`
- `comfort`
- `tension`
- `storytelling`
- `neutral`

说明：不同音色支持的 `emotion` 不完全一致，不支持时应回退 `neutral`。

## 5. 本项目当前默认音色选择

- 白虎：`zh_male_taocheng_uranus_bigtts`
- 黄色仓鼠：`zh_female_xiaohe_uranus_bigtts`
- 木鱼：`zh_male_m191_uranus_bigtts`
- 其他角色：`zh_female_vv_uranus_bigtts`

## 6. 参数获取路径（控制台）

1. 打开豆包语音控制台，进入“快速入门（新版控制台）”。
2. 在“API接入及 API Key 管理”中获取 `AppID` 与 `Access Token`。
3. 在语音合成/识别对应 API 文档中确认 `X-Api-Resource-Id`。
4. 在“音色列表”页面确认目标 `voice_type` 与支持的 `emotion`。

## 7. 当前不需要提供

- 桌面端语音接入阶段不需要微信账号/小程序 AppID。
