# 面试语音助手（基于 Pipecat）

实时语音面试助手：浏览器说话 → ASR 转写 → LLM 面试官 → TTS 朗读。
界面复用 Pipecat 官方 [pipecat-prebuilt](https://github.com/pipecat-ai/pipecat-prebuilt) 的 React 组件，
并新增了可视化「模型设置」页，可在运行时切换 ASR / LLM / TTS 供应商。

## 目录结构

```
语音机器人2/
├── server.py                    # 后端入口：配置接口 + 语音 pipeline + 托管前端
├── app/
│   ├── config.py                # 读写 config/settings.json
│   ├── providers.py             # 按配置构建 STT / LLM / TTS
│   ├── materials.py             # 面试档案的本地 JSON 存储与数据目录
│   ├── materials_ai.py          # 简历整合 / 经历单元 / 经历卡的提示词
│   ├── ai.py                    # 直接调用配置里的 LLM（不经过语音 pipeline）
│   └── services/
│       ├── qwen_stt.py          # Qwen ASR（DashScope OpenAI 兼容接口）
│       └── qwen_tts.py          # Qwen TTS（DashScope 多模态生成接口）
├── config/settings.json         # 运行时配置（含密钥，勿提交）
├── config/profiles.json         # 面试档案（含个人简历，勿提交）
├── web/client/                  # 前端源码（pipecat-prebuilt 的 React 应用）
│   └── dist/                    # npm run build 产物，server.py 托管在 /client
├── pipecat/                     # Pipecat 源码（editable 安装）
└── .venv/                       # Python 3.12 虚拟环境
```

## 启动

```bash
# 1) 构建前端（首次或改动前端后）
npm --prefix web/client run build

# 2) 启动服务（中文 Windows 需要 UTF-8，否则启动横幅会因 GBK 编码报错）
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe server.py
```

打开 <http://localhost:7860/>，会自动跳转到 `/client/`。

## 界面与语言

- 左侧导航：**实时面试**、**模拟面试**、**面试材料** 与 **设置**；桌面端展开、平板折叠为图标栏（悬停显示名称）、手机端隐藏（顶栏改为页面下拉 + 设置入口）
- **实时面试**：点「连接」先弹出系统音频选择器（选「整个屏幕」并勾选「分享系统音频」），
  采集面试官的系统声音；对话 / 回答 / 指标 三栏，栏间可拖拽改宽，指标栏拖窄到阈值后折叠成图标条
- 实时面试建立两条会话：系统音频跑「STT + LLM」生成答案，麦克风只跑 STT 做复盘转写；
  该模式**不启用 TTS**，答案只以文字出现在「回答」栏，对话里面试官提问是左侧气泡、面试者发言是右侧纯文本
- 实时面试绑定一份**面试档案**（顶栏「面试档案」下拉，连接时随 `/start` 下发 `profileId`）：后端改用
  「候选人视角」的系统提示词，把档案里的简历、岗位描述和已生成的经历卡放进上下文，只依据确认过的事实作答，
  不编造、不加模型自己的观点；没选档案时用最近编辑的一份。模拟面试仍然用设置页里的面试官提示词
- **模拟面试**：沿用原版控制台布局（机器人音频、机器人视频、对话 + 指标标签页、状态面板），保留 TTS 语音
- 两个页面互相独立：各自持有自己的 Pipecat 客户端、会话和前端状态（每个页面一个 jotai store），
  切换页面会断开当前连接，语音对话与转写不会串到另一页
- 设备选择（麦克风 / 摄像头 / 屏幕共享）在侧栏「设置」上方；侧栏折叠时变成图标 + 浮层，
  小屏隐藏侧栏时入口在顶栏。实时面试只启用麦克风，摄像头与屏幕共享置灰
- 默认中文；语言与主题都在「设置 → 通用设置」里切换（主题支持浅色 / 深色 / 跟随系统），选择保存在浏览器 localStorage
- 文案统一走 `web/client/src/i18n/index.ts`（i18next），新增文案在 `zh` / `en` 两份资源里同步添加
- 设置页分两页：「通用设置」（界面语言、主题、采集麦克风、数据目录）与「模型配置」（ASR / LLM / TTS 三段，同页滚动）
- 界面只保留浏览器直连的 **SmallWebRTC**。Daily、LiveKit、Twilio、MoQ、原始 WebSocket
  等属于电话/第三方云/调试场景的传输，已从下拉框移除
- 电话拨号盘（DTMF 键盘）用于拨打 IVR 按键菜单，语音面试用不到，已移除

## 面试材料

侧栏第三项「面试材料」，顶部滑块分三段：**面试档案**、问答库、热词库；本期只实现面试档案，
后两段是占位页。

面试档案支持多份（一个岗位一份），页面是自上而下的五步流程图：

1. **命名**
2. **面试语言**：中文 / English，只影响这份档案生成的文字，不改界面语言
3. **简历**：粘贴全文；「AI 整合」把它改写成更简洁、更有结构的一版（纯文本小标题 + 「- 」条目，
   只压缩描述、不丢事实），替换后可撤销
4. **岗位描述**：同上
5. **经历卡**：先切出 0–10 段经历单元（可改名、可勾掉），确认后逐张生成；
   每张卡有名称、描述和六段正文（事实底座 / 现场防守答案 / 连续追问 / 边界转向 / 深度地图 L1–L5 /
   待补的一个问题），可编辑、删除、手动新增、上下移动，单张也能重新生成；
   生成中可以「停止」，回来点「继续生成」接着做

改过简历或岗位描述后，已生成的卡会标注「可能过期」，但不会自动重做；切换面试语言只提示新内容用新语言。

所有编辑自动保存（停手 800ms 后写盘）。档案默认存在 `config/profiles.json`，可在
「设置 → 通用设置 → 数据目录」换成别的目录（切换时把现有文件复制过去，旧文件保留 `.bak` 备份）。
这个文件含个人简历，已在 `.gitignore` 里。AI 整合与经历卡生成直接用「设置 → 模型配置」里的 LLM，
不经过语音 pipeline。

实时面试页顶栏可以选一份档案：连接时把 `profileId` 随 `/start` 下发，后端用候选人视角的提示词把
简历、岗位描述和已生成的经历卡拼进上下文（见上一节）。

## 设置页

点击右上角齿轮 ⚙ 打开，分三个标签页：

| 能力 | 支持的供应商 |
| --- | --- |
| ASR | Qwen（qwen3-asr-flash）、MiniMax（asr-1.0）、Deepgram、OpenAI Whisper 及兼容接口 |
| LLM | 任意 OpenAI 兼容接口（OpenAI / DeepSeek / SiliconFlow / Ollama / vLLM）、Qwen、Anthropic |
| TTS | MiniMax、Qwen、OpenAI、ElevenLabs、Cartesia |

配置保存到 `config/settings.json`，**下一次点击 Connect 时生效**。密钥只保存在本机。

「通用设置」里的 **采集麦克风（面试者）** 只影响实时面试的第二路会话：关闭后不再建立麦克风会话，
面试者的语音不转写、也不产生 ASR 费用；连接中修改需要重连才生效。设备选择保存在浏览器本地，两个页面共用。

实时面试不使用 TTS，配置里的 TTS 只在模拟面试页生效。

几个易错点：

- **MiniMax** 需要额外的 `Group ID`；国内域名把 Base URL 填成 `https://api.minimaxi.chat/v1/t2a_v2`
- **MiniMax ASR** 走 `POST {base_url}/speech_to_text`（multipart，模型 `asr-1.0`），
  国内 Base URL 用 `https://api.minimax.cn/v1`
- **Qwen ASR / TTS / LLM** 都使用阿里云百炼的 `DASHSCOPE_API_KEY`，ASR 走 OpenAI 兼容的
  `/chat/completions`（音频以 base64 Data URL 传入），因此是 VAD 分段后整段识别，
  不是逐字流式输出
- LLM 选「OpenAI 兼容接口」时，Base URL 决定实际服务商；Ollama 可用 `http://localhost:11434/v1`

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/settings` | 读取当前配置 |
| POST | `/api/settings` | 保存配置（合并写入） |
| GET | `/api/profiles` | 面试档案列表（摘要） |
| POST | `/api/profiles` | 新建档案 |
| GET | `/api/profiles/{id}` | 读取一份档案（含经历卡） |
| PATCH | `/api/profiles/{id}` | 局部更新（名称、语言、简历、岗位描述、经历卡） |
| DELETE | `/api/profiles/{id}` | 删除档案 |
| POST | `/api/profiles/{id}/consolidate` | AI 整合简历或岗位描述（`kind=resume|jobDescription`） |
| POST | `/api/profiles/{id}/skills/plan` | 切分经历单元，生成待生成的卡 |
| POST | `/api/profiles/{id}/skills/{slug}/generate` | 生成单张经历卡 |
| GET | `/api/storage` | 数据目录信息 |
| PUT | `/api/storage` | 切换数据目录（默认迁移现有文件） |
| POST | `/api/storage/open` | 在资源管理器中打开数据目录 |
| GET | `/status` | Runner 状态与可用传输 |
| POST | `/start` | 建立会话（Pipecat 官方协议）；`body.mode` 选择管道 |
| POST | `/api/offer` | SmallWebRTC 信令 |

`body.mode` 决定服务端管道：

| mode | 管道 | 用途 |
| --- | --- | --- |
| `mock`（默认） | STT → LLM → TTS，连接后先问候 | 模拟面试 |
| `live` | STT → LLM → 文本输出（无 TTS），不问候 | 实时面试的面试官一路 |
| `listen` | 仅 STT | 实时面试的麦克风一路，只回传转写 |

## 环境要求（官方文档结论）

- Python **3.11+**（本项目使用 3.12.14）
- Node.js（构建前端）
- 至少一组 STT / LLM / TTS 的 API Key

## 常见问题

- **控制台 `UnicodeEncodeError: 'gbk' codec ...`**：启动时带上 `PYTHONUTF8=1 PYTHONIOENCODING=utf-8`
- **点 Connect 后秒断**：先看服务端日志里的 `ERROR`。LLM 返回 4xx 会让处理器被标记不可用并结束整条 pipeline。
  例如 DeepSeek 等兼容服务不接受 `developer` 角色（422 `unknown variant developer`），项目已用
  `CompatibleOpenAILLMService`（`supports_developer_role = False`）把该角色转成 `user`
- **端口 7860 被占用**：先结束旧进程，或 `python server.py --port 7861`
- **前端改动后页面没变化**：重新执行 `npm --prefix web/client run build`
- **实时面试没有转写 / 回答栏空白**：连接时要在选择器里选「整个屏幕」并勾选「分享系统音频」；
  只共享标签页时只有该标签页的声音。浏览器需要 Chrome / Edge（Windows），Firefox / Safari 不支持系统音频
- **实时面试收不到面试官声音**：确认会议的声音输出没有被切到别的设备；建议戴耳机，
  外放时麦克风会把面试官的声音再收一遍
- **回答栏迟迟不出现**：实时面试不启用 TTS，答案在 LLM 输出后直接以文字推送；
  若一直空白，检查服务端日志里 `Starting bot mode=live` 是否出现，以及 ASR 是否识别到了提问

## 开发

前端热更新（自动代理 `/api`、`/start` 到 7860）：

```bash
npm --prefix web/client run dev
```

后端修改后重启 `server.py` 即可（`pipecat/` 是 editable 安装，改源码无需重装）。

前端所有滚动区统一用 `web/client/src/components/ui/scroll-area.tsx`（base-ui `ScrollArea` 封装的
浮层滚动条，不占内容宽度）；新增页面也用它，别再写 `overflow-y-auto`。多选框统一用
`components/ui/checkbox.tsx`。`textarea`、下拉/选择器浮层这类包不到的原生滚动区由 `index.css` 里的
`scrollbar-width: thin` 兜底，文本框右下角的拖拽手柄也在那里换成了细斜线。
