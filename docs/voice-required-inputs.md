# 语音接入资料清单（最简版）

你只需要先提供下面 6 项。不会填的可留空，我会先按默认值实现并在测试时补齐。

## 必填（最少 6 项）

1. `Region`（不确定可留空，默认 `cn-beijing`）
2. `AppID`（Header: `X-Api-App-Id` 或 `X-Api-App-Key`）
3. `Access Token`（Header: `X-Api-Access-Key`）
4. `ASR 资源 ID`（`X-Api-Resource-Id`）
5. `TTS 资源 ID`（`X-Api-Resource-Id`）
6. `TTS 音色 ID`（`voice_type`）

## 可选（不填则走默认）

- 是否自动播报 AI 回复（默认：是，设置开关可关闭）
- ASR 上传接口（可选，`POST` 音频文件后返回可访问 `http(s)` URL）
- 录音最大时长（默认：20s）
- 播放中来新回复是否打断当前播放（默认：是）
- TTS 输出格式（默认：`mp3`）
- TTS 采样率（默认：`24000`）

## 说明：关于是否复用一个 API Key

- LLM 当前用 ARK Key；
- 语音链路按官方文档走 `AppID + Access Token + ResourceId`；
- 默认方案：ASR/TTS 使用同一套语音凭证，不与 LLM Key 强绑定；
- 是否复用 ARK Key：**不作为首版前提**，后续可单独做兼容测试。

## 三角色默认音色（我已先帮你定好）

- 白虎：`zh_male_taocheng_uranus_bigtts`
- 黄色仓鼠：`zh_female_xiaohe_uranus_bigtts`
- 木鱼：`zh_male_m191_uranus_bigtts`
- 其他角色（通用）：`zh_female_vv_uranus_bigtts`

## 这些信息去哪里拿

- 音色与情绪列表：豆包语音文档 -> 语音合成大模型 -> 音色列表。
- AppID / Access Token：豆包语音控制台 -> 快速入门（新版）-> API接入及 API Key 管理；或见“控制台使用FAQ-Q1”。
- ASR 资源ID（推荐）：
  - `volc.seedasr.sauc.duration`（流式识别小时版，当前默认）
  - `volc.seedasr.sauc.concurrent`（流式识别并发版）
  - `volc.seedasr.auc`（文件识别，仅 file 模式使用）
- TTS 资源ID（推荐）：`seed-tts-2.0`

## 不需要你提供的

- 当前桌面端版本不需要微信账号/小程序 AppID。
- 当前语音接入不需要“知识库列表”；知识库是 LLM 检索能力配置，和 ASR/TTS 解耦。

## 直接复制这段回我

```text
[必填]
Region:
AppID:8196266437
AccessToken:Gx3vXDaVdZ_t-Kbuat3ZK0-3giUPd8Dd
ASR资源ID(建议 volc.seedasr.sauc.duration):volc.seedasr.sauc.duration
TTS资源ID(建议 seed-tts-2.0):seed-tts-2.0
TTS音色ID(建议按角色默认):按角色自动映射（白虎/黄色仓鼠/木鱼/其他）

[可选-可留空]
自动播报AI回复(是/否):
最大录音时长(秒):
新回复是否打断当前播放(是/否):
TTS格式(mp3/pcm):
TTS采样率:
```
