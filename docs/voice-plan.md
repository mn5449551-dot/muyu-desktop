# 语音接入方案（最简模式，点击录音首版）

## 1. 目标

- 在现有桌宠中增加语音输入（ASR）和语音播报（TTS）。
- 交互采用“点按一次开始录音，再点按一次结束并发送”，不做实时全双工。
- 尽量少填配置，能默认的都默认。

## 2. 已确定默认决策

1. 厂商：火山引擎（ASR + TTS，单厂商闭环）。
2. 语音流程：`录音 -> ASR -> 现有 LLM -> 情绪判定 -> TTS 播放`。
3. 情绪策略：规则映射（角色默认 + 文本关键词修正）。
4. 回退策略：音色不支持目标情绪时自动回退 `neutral`。
5. 平台：macOS + Windows。
6. 首版不做：VAD 自动打断、多厂商切换（ASR 已切为流式输入模式）。

## 3. 官方能力与业务规则边界

- 官方文档定义的是“可用接口和参数”（如音色、style、语速、音高）。
- “白虎默认 cute，挑衅时 angry”这类规则是业务侧策略，不是官方固定规则。
- 系统提示词只影响回复文本风格，不能替代 TTS 情绪参数。

参考入口（火山官方）：

- 音色列表（含 `voice_type` 与 `emotion`）：<https://www.volcengine.com/docs/6561/1257544>
- TTS V3（HTTP Chunked/SSE）：<https://www.volcengine.com/docs/6561/1598757>
- ASR 流式识别：<https://www.volcengine.com/docs/6561/1354869>
- 快速入门（新版控制台）：<https://www.volcengine.com/docs/6561/2119699>

## 4. 凭证策略（简化版）

### 4.1 默认策略

- LLM 继续使用当前 ARK Key。
- 语音（ASR/TTS）默认使用一套“语音专用凭证”，ASR 和 TTS 共用。

### 4.2 关于“能否共用一个 API Key”

- 对语音接口族，官方示例普遍是 `AppID + Access Token (+ Resource-Id)` 鉴权。
- 是否可直接复用 ARK LLM Key 到语音接口：**不确定**。
- 处理方式：文档标记不确定，后续在实现中加“兼容探测测试”，失败不影响主链路。

## 5. 你最少需要提供的内容

只需 6 项：

1. `Region`（默认 `cn-beijing`，不确定可先留空）
2. `AppID`
3. `Access Token`
4. `ASR 资源 ID`
5. `TTS 资源 ID`
6. `TTS 音色 ID`

其余都走默认。

## 5.1 这些信息去哪里拿（控制台路径）

1. `AppID / Access Token`  
路径：豆包语音控制台 -> 快速入门（新版控制台）-> 五、API接入及 API Key 管理。  
或参考 FAQ：`Q1：哪里可以获取 appid / token ...`。  

2. `ASR 资源ID`  
官方字段：`X-Api-Resource-Id`。  
推荐（流式识别 2.0）：
- 小时版：`volc.seedasr.sauc.duration`
- 并发版：`volc.seedasr.sauc.concurrent`

3. `TTS 资源ID`  
官方字段：`X-Api-Resource-Id`。  
推荐（豆包语音合成 2.0）：`seed-tts-2.0`

4. `TTS 音色ID + 支持情绪(style)`  
路径：豆包语音 -> 语音合成大模型 -> 音色列表（表格含 `voice_type`）。  
情绪参数官方字段名为 `emotion`，中文情绪示例：`happy/angry/comfort/tension/storytelling/neutral` 等。  

## 5.2 本项目先固定的音色选择（已代你决定）

仅前三个角色做定制，其余角色统一通用音色（基于豆包语音合成2.0在线音色列表）：

| 角色 | 音色名 | voice_type | 选择原因 |
|---|---|---|---|
| 白虎 | 小天 2.0 | `zh_male_taocheng_uranus_bigtts` | 男声有张力，适配“平时萌、惹急会吼”的反差 |
| 黄色仓鼠 | 小何 2.0 | `zh_female_xiaohe_uranus_bigtts` | 轻快活泼，适配可爱嘴碎风格 |
| 木鱼 | 云舟 2.0 | `zh_male_m191_uranus_bigtts` | 稳定平和，适配陪伴与安抚场景 |
| 其他角色 | Vivi 2.0（通用） | `zh_female_vv_uranus_bigtts` | 通用能力最强，支持多语与情绪 |

## 6. 执行规则（情绪生成）

1. 先拿到 LLM 回复文本。
2. 以角色默认情绪作为初值。
3. 用关键词修正情绪（可含强度）。
4. 检查音色支持列表。
5. 不支持则回退 `neutral`，并记录 `emotionFallback=true`。
6. 输出最终 `style/speed/pitch/volume` 调用 TTS。

### 6.1 三个定制角色默认情绪映射

- 白虎：默认 `happy`，挑衅/冒犯词 -> `angry`，激烈冲突 -> `tension`，缓和场景 -> `comfort`。  
- 黄色仓鼠：默认 `happy`，安抚场景 -> `comfort`，讲故事/碎碎念 -> `storytelling`。  
- 木鱼：默认 `neutral`，安抚场景 -> `tender`，讲述类回复 -> `storytelling`。  

> 若目标音色不支持请求情绪，统一回退 `neutral`。

## 7. 配置与接口变更（实现时）

- DB 新增（`app_state`）：
  - `voice_enabled`
  - `voice_auto_play`
  - `voice_region`
  - `voice_app_id`
  - `voice_access_key_enc`
  - `voice_asr_resource_id`
  - `voice_asr_upload_endpoint`（可选）
  - `voice_tts_resource_id`
  - `voice_tts_format`（默认 `mp3`）
  - `voice_tts_sample_rate`（默认 `24000`）
- 新增主进程服务：`src/main/services/voice-service.js`
- 新增 IPC：
  - `voice-transcribe`
  - `voice-synthesize`
  - `voice-test-connection`

## 8. 默认参数

- Region：`cn-beijing`
- 录音最大时长：`20s`
- TTS 格式：`mp3`
- TTS 采样率：`24000`
- 自动播报 AI 回复：`用户可选（设置开关，默认开）`
- 新回复到达时打断当前播报：`是`

## 8.1 输入交互（桌面端）

- 聊天窗新增语音按钮（单击切换）：
  - 第一次点击：开始录音；
  - 第二次点击：结束录音并发送 ASR；
  - 录音中按钮显示“录音中”状态（含红点/计时）。
- 不采用“按住说话”，避免桌面端长按交互误触和窗口焦点问题。

## 9. 验收标准

1. 仅填写“最少 6 项”即可跑通语音链路。
2. 语音凭证为空时，测试连通必须失败并给可读提示。
3. 情绪不支持时能自动回退并继续播报。
4. 切角色/关闭聊天时停止播放，不出现卡住“已停止”死循环。
5. 不影响现有文本聊天和 e2e 回归。

## 10. 当前不需要的信息

- 本项目是桌面端（Electron）语音接入，当前阶段**不需要微信账号/小程序 AppID**。  
- 仅当后续要接微信小程序或公众号能力时，才新增微信侧凭证。

## 11. 本次实施计划（2026-02-27）

1. **先更新文档再改代码**：本节作为执行基线，后续按此顺序实现。
2. **主进程能力补齐**：
   - `db.js` 增加 `voice` 配置读写与安全存储（Access Token 加密）。
   - 新增 IPC：`voice-transcribe` / `voice-synthesize` / `voice-test-connection`。
   - `main.js` 挂载 `VoiceService` 并注册 IPC Handler。
3. **设置页接入语音配置**：
   - 增加“语音配置（ASR/TTS）”区块：启用开关、自动播报、AppID、Access Token、ASR/TTS 资源 ID、格式、采样率。
   - 增加“语音连通测试”按钮与状态反馈。
4. **聊天窗接入语音交互**：
   - 新增“点按开始录音 / 再点结束”按钮（PTT Toggle）。
   - 停止录音后调用 ASR，将识别文本自动填入并发送。
   - LLM 回复完成后，按开关自动调用 TTS 并播放；切角色/关闭聊天时停止当前播放。
5. **错误可见化**：
   - 无语音凭证、ASR/TTS 失败时，在聊天框展示可读错误，不再只显示“...”。
6. **验证与回归**：
   - `npm run build:renderer` 构建检查。
   - 验证文本聊天、角色切换、缩放、语音设置保存、语音测试不回归。

### 11.1 当前实现说明（ASR 输入形态）

- 默认使用官方 WebSocket 流式输入（`sauc/bigmodel_nostream`），客户端录音直接转为 `audio/wav` 后送 ASR，不再依赖公网音频 URL。
- 设置页支持 `stream/file` 双模式切换：
  - `stream`：推荐，无需上传接口；
  - `file`：兼容老链路，仍支持“ASR 上传接口（可选）+ audio.url”。
- 流式链路异常且配置了上传接口时，会自动回退到文件识别，避免完全不可用。
