# 0.0.4 迭代清单：ASR 多模型配置与流式识别

> 状态：待排期 · 记录于 2026-11-22
> 目标：设置页能容纳不同 ASR 供应商/模型的差异化配置；支持音频流式的模型自动走流式，不需要用户再选。

## 背景

- 现在 `asr` 是固定的 5 个字段（`provider / api_key / base_url / model / language`），所有供应商共用一套。
- 切换供应商会清空 `model` 和 `base_url`，切回去要重填；不同供应商的 Key 也会互相覆盖。
- 流式能力表达不出来：
  - Deepgram：音频流式（WebSocket）。
  - MiniMax `asr-1.0`：只能整段上传，`stream=true` 是**结果**流式（SSE）。
  - Qwen 文件模型和 `qwen3-asr-flash-realtime`：能力不同，需要按模型区分。
- `ASR_PROVIDERS` 里已经写了 `models` 列表，但设置页没用到，模型还是自由输入框。

## 设计决策

1. **配置按供应商各存一份**
   ```json
   "asr": {
     "provider": "minimax",
     "configs": {
       "qwen":    { "api_key": "...", "base_url": "...", "model": "qwen3-asr-flash", "language": "zh" },
       "minimax": { "api_key": "...", "base_url": "...", "model": "asr-1.0", "language": "zh" },
       "deepgram":{ "api_key": "...", "model": "nova-3", "language": "zh" }
     }
   }
   ```
   旧配置在读取时自动迁移到 `configs[当前 provider]`，密钥不丢。切换供应商不再清空，切回去就是上次填的。

2. **模型元数据驱动设置页**
   每个模型声明自己的能力与字段：
   ```ts
   { id: "qwen3-asr-flash-realtime", transport: "websocket", fields: ["api_key", "base_url", "model", "language", "silence_ms"] }
   { id: "asr-1.0", transport: "upload", fields: ["api_key", "base_url", "model", "language"] }
   ```
   设置页按选中的模型渲染字段；模型从自由输入改成下拉（保留“自定义”）。

3. **流式是模型能力，不是用户开关**
   支持就自动用，不支持就整段识别。界面上只放只读标记：`音频流式 / 结果流式 / 整段识别`。

4. **后端按 provider + model 路由**
   `build_stt` 不再只按 provider 粗分，而是选到具体实现：
   - `deepgram` → 音频流式
   - `qwen` + `*-realtime` → 音频流式（新服务）
   - `qwen` 文件模型 / `minimax` / `openai` → 整段上传；MiniMax 自动 SSE 结果流式

5. **不做通用 JSON Schema 表单引擎**
   只有 ASR / LLM / TTS 三块，一份显式元数据表 + 条件渲染就够，别把设置页做成动态表单框架。

## 任务

### 1. 配置结构与迁移

- [x] `DEFAULT_SETTINGS.asr` 增加 `configs`，保留 `provider`
- [x] `load_settings()` 把旧平铺字段迁移到 `configs[provider]`
- [x] `save_settings()` 写入新结构，兼容旧字段
- [x] `build_stt` 读取当前 provider 对应的配置
- [x] `_model_snapshot`、启动日志读取当前模型
- [x] 测试：迁移不丢 Key；切换 provider 不丢配置

### 2. 设置页

- [x] ASR 模型改成下拉（来自 `models`），保留自定义输入
- [x] 按模型渲染字段，删除 `showAsrBaseUrl` 的硬编码
- [x] 显示能力标记：音频流式 / 结果流式 / 整段识别
- [x] 切换供应商保留各自配置
- [x] 中英文 i18n

### 3. 流式 ASR

- [x] 新增 `QwenRealtimeSTTService`（`qwen3-asr-flash-realtime`，WebSocket）
  - [x] `session.update` / `input_audio_buffer.append` / 事件解析
  - [x] partial → `InterimTranscriptionFrame`；completed → `TranscriptionFrame`
  - [ ] 断线重连 + 重连期间音频缓冲回放
  - [x] 关闭前 `session.finish`
- [x] `build_stt` 按模型路由：realtime → 新服务；文件模型 → 现有分段实现
- [ ] WS 失败时降级到现有 MiniMax 分段实现，不能让整场面试哑掉
- [ ] 指标：说话→首字、说完→final，与现状对比
- [x] 测试：事件解析、断线、空音频、语言

### 4. 首页主视觉动效（DecryptedText）

- [x] 安装 `motion`（当前 `web/client/package.json` 没有这个依赖）
- [x] 把 React Bits 的 `DecryptedText`（TypeScript + CSS 版）放到 `web/client/src/components/ui/decrypted-text.tsx`
- [x] `StartPanel` 顶部替换原有祝福语轮播：显示固定文案 `FUCKINTERVIEW`
- [ ] 删掉旧轮播的 `CHEER_INTERVAL_MS`、`carousel` state、两层淡入淡出 `<p>`；确认 `home.cheers` 是否还有其他引用，没有就一并清理
- [x] 动效参数先按 `effect="scramble"`、`animateOn="view"`、`sequential`、`loop`、`loopDelay={4000}`、`speed={45}` 起，联调时再调
- [x] 字号/字重沿用当前主视觉（按用户要求调到 30px / font-semibold），窄屏检查不溢出、不跳版
- [x] 亮暗色、`prefers-reduced-motion` 下回退为静态文字
- [x] 构建验证：`tsc && vite build`

**验收**：首页第一行稳定显示 `FUCKINTERVIEW`，入场有解密动效；切换页面回来不会闪烁到无法阅读；360px 宽度不横向溢出；减少动态效果时直接显示完整文字。

### 5. 验证

- [ ] 中英文各跑一场实时面试
- [x] 切换供应商/模型后重启，配置保持
- [x] 旧 `settings.json` 升级后密钥与模型仍在
- [x] `pytest -q`
- [x] `npm --prefix desktop test`
- [x] `tsc && vite build`

## 工作量预估

- 第一步（配置结构 + 迁移 + 设置页）：半天到一天。
- 第二步（Qwen realtime 服务 + 自动路由）：一天。
- 首页 DecryptedText 动效：半天（含依赖、组件落地和视觉微调）。

## 暂不做

- 本地 ASR（sherpa-onnx / FunASR）接入——结构留好字段，后续再加
- LLM / TTS 的按模型配置——同类问题，但不在本次范围
- 多模型同时启用 / 热切换

## 验收标准

- 切换供应商不再丢配置，每个供应商有自己的 `api_key / base_url / model`。
- 选到支持音频流式的模型时，说话过程中前端能出现中间文字。
- 选到不支持音频流式的模型时，行为与现在一致，不报错。
- 现有测试全部通过。

## 执行记录（2026-11-24）

- 配置迁移、设置页模型下拉/字段联动/自动填请求地址、能力标记、`QwenRealtimeSTTService`、首页 DecryptedText 已落地。
- 测试：`pytest` 156 passed；`npm --prefix desktop test` 20 passed；`tsc && vite build` 通过。
- 6 分钟静音实测：没有出现 `Idle timeout detected`，连接一直保持（旧代理配置下的 ASR 报错不影响连接）——5 分钟自动结束已修。
- 真实面试（MiniMax，系统音频播放 3 个问题）：
  - ASR 每段约 1.3–2.1 秒；
  - 第三问首字 391ms，552 字答案 2.2 秒；
  - 第一问命中问答库，721 字直出，0ms。
- Qwen 实时识别真机联调（`qwen3-asr-flash-realtime` + 官方 WebSocket）：
  - 16.65 秒音频：partial 边说边出，句子 final 约在句尾后 0.1–0.3 秒；
  - 应用内系统音频/麦克风两路都连上，16kHz，转写正确；
  - 应用层的多问融合会额外等待（测试中第一轮约 4 秒），这是 turn fusion，不是 ASR。
- 未完成 / 待联调：
  - WS 断线重连与失败自动降级到分段实现尚未做：目前连接失败会让该路 STT 报错，需要手动切回文件模型。
  - 只有中文实测，英文待补。
