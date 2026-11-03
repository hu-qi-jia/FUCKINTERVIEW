# FUCKINTERVIEW（基于 Pipecat）

实时语音面试助手：系统音频 / 麦克风 → ASR 转写 → LLM 生成候选人回答；实时面试只显示文字，不再朗读。
界面复用 Pipecat 官方 [pipecat-prebuilt](https://github.com/pipecat-ai/pipecat-prebuilt) 的 React 组件，
并新增了可视化「模型设置」页，可在运行时切换 ASR / LLM / TTS 供应商。

## 目录结构

```
语音机器人2/
├── server.py                    # 后端入口：配置接口 + 语音 pipeline + 托管前端
├── app/
│   ├── config.py                # 读写 settings.json；数据根目录（开发版 / 安装版）
│   ├── security.py              # 本机访问边界：回环 Host、精确 Origin、本地令牌
│   ├── storage_migration.py     # 数据目录整体迁移（预检 / 暂存 / 原子切换）
│   ├── providers.py             # 按配置构建 STT / LLM / TTS（供应商 SDK 懒加载）
│   ├── materials.py             # 面试档案的本地 JSON 存储与数据目录
│   ├── materials_ai.py          # 简历整合 / 经历单元 / 经历卡的提示词
│   ├── documents.py             # 其他资料（md / pdf）的本地存储与目录迁移
│   ├── qa.py                    # 问答库的 SQLite 存储、全文索引、去重
│   ├── qa_index.py              # 向量模型、后台索引线程、混合检索
│   ├── qa_import.py             # xlsx / csv / md 的解析、预览与导入
│   ├── terms.py                 # 术语库的 SQLite 存储、内置模板与转写纠错
│   ├── sessions.py              # 面试历史的 SQLite 存储、统计与术语回顾
│   ├── session_recorder.py      # 从 pipeline 帧里采集转写与指标
│   ├── ai.py                    # 直接调用配置里的 LLM（不经过语音 pipeline）
│   └── services/
│       ├── qwen_stt.py          # Qwen ASR（DashScope OpenAI 兼容接口）
│       └── qwen_tts.py          # Qwen TTS（DashScope 多模态生成接口）
├── config/                      # 开发环境的数据目录（安装版在 userData/data）
│   ├── settings.json            # 运行时配置（含密钥，勿提交）
│   ├── profiles.json            # 面试档案（含个人简历，勿提交）
│   ├── documents.json           # 其他资料索引（勿提交）
│   ├── documents/               # 其他资料原件（md / pdf，勿提交）
│   ├── qa.db                    # 问答库（SQLite，勿提交）
│   ├── terms.db                 # 术语库（SQLite，勿提交）
│   ├── sessions.db              # 面试历史与转写（SQLite，勿提交）
│   └── models/                  # 向量模型缓存（约 90MB，勿提交）
├── docs/qa-library-design.md     # 问答库的设计说明
├── web/client/                  # 前端源码（pipecat-prebuilt 的 React 应用）
│   └── dist/                    # npm run build 产物，server.py 托管在 /client
├── desktop/                     # Electron 桌面端外壳（见「桌面端（Electron）」）
├── pipecat/                     # Pipecat 源码（随仓库提交，见 pipecat/VENDORED.md）
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

开发环境的数据全部在仓库的 `config/` 下；安装版的数据在
`%APPDATA%\FUCKINTERVIEW\data`，两边用不同的目录、不同的模型缓存，互不覆盖。
开着安装版时如果要同时跑浏览器开发端，换一个端口：

```bash
INTERVIEW_PORT=7870 PYTHONUTF8=1 PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe server.py
```

> 本机接口默认只接受回环地址、同源请求，并给 `/api/*` 加了每次启动随机生成的
> 访问令牌（服务端渲染 `/client/` 时注入页面，前端自动带上）。跨源网页既读不到
> 设置里的 API Key，也改不了本地数据。

## 桌面端（Electron）

`desktop/` 是 Electron 外壳：主进程拉起本地 Python 服务（项目 `.venv` 里的解释器 + `server.py`），
等 `/status` 就绪后在窗口里加载同一套前端 `http://127.0.0.1:<port>/client/`。

```bash
npm --prefix web/client run build   # 先构建前端
npm --prefix desktop install        # 首次
npm --prefix desktop start          # 启动；npm --prefix desktop run dev 额外打开开发者工具
```

- 端口默认 7860，被占用时自动往后找空闲端口；单实例运行，重复启动会唤起已有窗口
- **开发端与安装版隔离**：`npm --prefix desktop start` 用仓库自己的 `.venv` 和
  `config/`，userData 指到 `interview-desktop-dev`，默认端口 7870；安装版用打包的
  Python 运行时，数据在 `%APPDATA%\FUCKINTERVIEW\data`，默认从 7860 起找端口。
  两者可以同时运行，不会抢窗口、抢数据或抢端口
- **构建产物也不碰安装版**：直接运行 `desktop/dist/win-unpacked` 时 userData 是
  `interview-desktop-build`、端口 7871，不共享安装版的单实例锁和 `data/`。
  不要把 `win-unpacked` 当客户端长期使用；它只是本次构建的输出
- **首次启动选位置**：安装版第一次打开会先弹出「选择数据位置」，可以把数据目录和模型目录
  换到任意可写路径；模型目录默认「跟随数据目录」。不修改直接开始也行，之后可以在
  「设置 → 通用设置」里随时更换（换数据目录会把现有数据一起复制过去，跟随模式的模型缓存也会带上）
- **从旧名字升级**：旧版 userData 在 `%APPDATA%\面试语音助手`；新版首次启动会把其中的
  `data`、`Local Storage`、`privacy.json` 复制到 `%APPDATA%\FUCKINTERVIEW`，旧目录保留作为备份
- **打包前自动重建**：`npm --prefix desktop run dist` 会先重建便携后端和前端，再清掉
  旧的 `desktop/dist`，避免历史 `win-unpacked`/安装包混进新产物。只想清干净时用
  `npm --prefix desktop run clean`
- **构建版本可核对**：打包时会把当前 `git commit`（含 `dirty` 标记）写进
  `resources/backend/build-info.json`；安装版启动后在
  `%APPDATA%\FUCKINTERVIEW\backend.log` 第一行附近能看到
  `Build channel=production version=... commit=... dirty=...`，用它对一下是不是当前代码
- **开发版 / 线上版**：`npm --prefix desktop start` 是开发版，窗口标题带「（开发版）」，
  userData 在 `interview-desktop-dev`；`npm --prefix desktop run dist` 产出的是线上版安装包，
  标题不带开发标记。两种版本使用不同端口、不同数据目录，可以同时开着
- **新用户第一次打开**：首页会提示先填写 ASR / LLM / TTS 的 API Key；安装包本身不包含
  任何开发者的 `settings.json`、档案、数据库或模型缓存，所有数据都写在当前用户的
  `%APPDATA%\FUCKINTERVIEW\data` 下
- **发布前自检**：`npm --prefix desktop run dist` 之后跑
  `npm --prefix desktop run release-check`。它会检查包里没有开发数据、构建 commit 与当前
  HEAD 一致，并用一个临时空数据目录启动后端，确认 `/status`、`/client/`、`/api/settings`
  和空档案列表都正常
- **无边框窗口**：不画单独的一条标题栏，最小化 / 最大化还原 / 关闭三个按钮直接排在页头的末尾
  （`web/client/src/components/window-controls.tsx`），和页面标题同一行；页头整行是窗口拖拽区，
  三个按钮标了 `no-drag` 才收得到点击（Electron 里拖拽区会吞掉鼠标事件，浮在上面的元素也不行）。
  侧栏顶部同样可以拖动窗口，双击页头最大化。浏览器版不渲染这三个按钮
- **关闭 = 收进托盘**：右上角 ✕ 只是隐藏窗口，点托盘图标恢复，托盘菜单里才有「退出」；
  真退出时用 `taskkill /T` 连 Python 及其子进程一起收掉
- **图标**：`desktop/build/` 下是 logo 的 svg / png / ico 和托盘图标；侧栏顶部换成和首页同款的
  FUCKINTERVIEW 字标，不再显示 Pipecat 的占位 logo
- **系统音频**：浏览器版要手动选「整个屏幕 + 共享系统音频」，桌面端由主进程
  `setDisplayMediaRequestHandler` 直接给第一块屏幕并挂上 `audio: "loopback"`（Windows 环回），
  点「开始面试」不再弹共享选择器；Linux 没有环回，实时面试仍要用浏览器版
- **权限**：麦克风、屏幕采集由 `setPermissionRequestHandler` 统一放行，不再弹浏览器授权框
- 站外链接交给系统浏览器打开；后端日志写在 `%APPDATA%\interview-desktop\backend.log`
- 首次安装如果卡在下载 Electron 二进制，用国内镜像：
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm --prefix desktop install`
- **打包**：先 `npm --prefix desktop run backend` 把 Python 运行时装进 `desktop/resources/backend`
  （便携 CPython + 依赖 + 精简版 Pipecat + 前端产物）。脚本会先构建前端、剔除
  运行时用不到的重包（OpenCV / pip / pygments 等）并预编译 `.pyc`，再
  `npm --prefix desktop run dist` 用 electron-builder 出 NSIS 安装包
  （`desktop/dist/FUCKINTERVIEW-Setup-<版本>.exe`）。
  安装版的后端跑在 `%APPDATA%\FUCKINTERVIEW\data`，配置、档案、问答库、历史、
  模型缓存都写在那儿，和安装目录分开；从旧版本升级时会自动把**同一个安装目录**
  `resources/backend/config` 里的数据搬过来（只补缺失文件，不覆盖新数据）。
  如果旧版装在另一个目录，把那个目录下 `resources/backend/config` 里的
  `settings.json` / `profiles.json` / `*.db` / `documents*` / `models/` 手动拷到
  `%APPDATA%\FUCKINTERVIEW\data` 即可

### 换一台机器

桌面端只依赖项目目录里的相对路径，拷一份代码过去按下面装一遍就能跑：

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux 换成 .venv/bin/python
npm --prefix web/client install && npm --prefix web/client run build
npm --prefix desktop install
npm --prefix desktop start
```

- 需要 Node 20+、Python 3.11+；`requirements.txt` 里的 `-e ./pipecat` 会装仓库里这份精简版 Pipecat
  （源码随仓库提交，干净克隆不需要再拉上游；版本信息见 `pipecat/VENDORED.md`）
- Python 解释器按「`.venv` → PATH 里的 python」找，也可以用环境变量 `INTERVIEW_PYTHON` 指定
- 数据（档案 / 问答库 / 术语库 / 历史 / 其他资料）都在 `config/` 下，跟着项目目录走；
  换机器时一起拷过去，或在「设置 → 通用设置 → 数据目录」指到同步盘
- 系统音频环回依赖平台：Windows 可以，macOS 需要 14.2+，Linux 拿不到环回音轨

## 界面与语言

- 左侧导航：**首页**、**面试材料**、**其他资料**、**历史记录** 与 **设置**；桌面端展开、平板折叠为图标栏（悬停显示名称）、手机端隐藏（顶栏左侧按顺序摆页面图标，不再有下拉选择框）
- **实时面试**：点「连接」先弹出系统音频选择器（选「整个屏幕」并勾选「分享系统音频」），
  采集面试官的系统声音；对话 / 回答 / 指标 三栏，栏间可拖拽改宽，指标栏拖窄到阈值后折叠成图标条
- 实时面试建立两条会话：系统音频跑「STT + LLM」生成答案，麦克风只跑 STT 做复盘转写；
  该模式**不启用 TTS**，答案只以文字出现在「回答」栏，对话里面试官提问是左侧气泡、面试者发言是右侧纯文本
- **系统音频只环回默认播放设备**：会议/网页的声音要从 Windows 默认输出设备播放；如果默认输出是虚拟声卡，
  环回音轨可能是静音的。候选人麦克风同理，侧栏里要选一个**有电平**的输入设备——「默认设备」可能是一个
  没接输入声卡的音频接口，Electron 不会自动替你换
- 桌面版首连只使用本机 host candidate，不等 STUN；因此连接通常在 1–3 秒内完成。首次安装后第一次启动
  Windows 安全软件要扫描约 2.4 万个运行时文件，可能多等 10 秒左右，之后启动约 8 秒
- 实时面试绑定一份**面试档案**（首页「开始面试」弹窗里选定，连接时随 `/start` 下发 `profileId`；
  面试页顶栏不再提供切换，开始后不换档案）：后端改用
  「候选人视角」的系统提示词，把档案里的简历、岗位描述和已生成的经历卡放进上下文，只依据确认过的事实作答，
  不编造、不加模型自己的观点；没选档案时用最近编辑的一份
- 两个页面互相独立：各自持有自己的 Pipecat 客户端、会话和前端状态（每个页面一个 jotai store），
  切换页面会断开当前连接，语音对话与转写不会串到另一页
- 设备选择（麦克风 / 摄像头 / 屏幕共享）在侧栏「设置」上方；侧栏折叠时变成图标 + 浮层，
  小屏隐藏侧栏时入口在顶栏。实时面试只启用麦克风，摄像头与屏幕共享置灰
- 默认中文；语言与主题都在「设置 → 通用设置」里切换（主题支持浅色 / 深色 / 跟随系统），选择保存在浏览器 localStorage
- 文案统一走 `web/client/src/i18n/index.ts`（i18next），新增文案在 `zh` / `en` 两份资源里同步添加
- 设置页分两页：「通用设置」（界面语言、主题、采集麦克风、防截屏、数据目录、模型目录）与
  「模型配置」（ASR / LLM / TTS 三段，同页滚动）
- 界面只保留浏览器直连的 **SmallWebRTC**。Daily、LiveKit、Twilio、MoQ、原始 WebSocket
  等属于电话/第三方云/调试场景的传输，已从下拉框移除
- 电话拨号盘（DTMF 键盘）用于拨打 IVR 按键菜单，语音面试用不到，已移除

## 首页与历史记录

首页是控制台，布局参考仪表盘设计稿，视觉沿用项目自己的卡片、圆角和颜色 token：
第一行左侧是 SVG 字标（`FUCKINTERVIEW`，替代原来的标题和说明文案）+ 正下方的开始面试按钮，
右侧是两个场次数字（宽屏下两块指标挨在一起、右边缘与下面一行卡片对齐），整块与左侧「字标 + 按钮」垂直居中。
数据区用 12 栏网格：第二行是热力图（4）+ 首字响应（4）+ 模型消耗（4），三张图等宽；第三行是面试准备（4）+
最近面试（8），左侧两行共用同一条 4/12 边线。
所有页面（首页、历史记录、面试材料）的内容区统一使用 `max-w-7xl`；卡片标题下不再画分割线。
桌面横屏（≥1024px）时整页按视口高度铺满，两行数据卡等分剩余高度、图表跟着拉伸，不出现页面
滚动；更窄的窗口退回纵向滚动。

- **开始面试**：主视觉栏里、字标正下方的主按钮（占这一栏的 60%，0.6rem 圆角、只有文字）：
  上亮下暗的绿色渐变 + 顶部内高光，hover 只轻轻抬起提亮、按下压回，没有扫光动效，深浅主题都对比得住。
  先弹出面试档案选择（名称 / 更新时间 / 经历卡数量，
  默认上次用过的一份），确认后跳到实时面试页并**自动连接**；浏览器会紧接着弹系统音频授权，
  取消授权就停在面试页显示错误，可以手动点「连接」。没有档案时引导去「面试材料」新建。
  Electron 版本后续会用原生环回替代系统音频授权，这条流程不变
- **音频检查**：档案弹窗下方是另一个独立的「音频」弹窗，两个窗口上下叠放，
  「开始面试」压在整个组合的最底部。麦克风和扬声器**直接复用侧栏那套设备选择**
  （同一个 Pipecat 客户端，设备名和「被禁止 / 被占用」状态都一致）。打开弹窗就会初始化设备、
  要一次麦克风授权，选中即生效并记进浏览器偏好，连接时两路会话都按它走。
  档案列表不再单独滚动：内容放得下就不出滚动条，放不下整块滚动
- **面试热力图**：列是周一至周日，行是最近 5 周；方格铺满卡片可用区域（随宽高拉伸，不再固定正方形），
  色深按当天实时面试场次（5 档），悬停看「日期 · 场次 · token」
- **首字响应**：最近 30 场实时面试的首字延迟（TTFT）与 TTFB 折线，视觉与面试页的性能面板一致；
  上方是平均首字 / 平均 TTFB
- **模型与消耗**：最近 30 场实时面试的 token 面积图（绿色渐变），上方是平均每场 / 累计两个内联指标，下方是当前 ASR / LLM / TTS 模型
- **最近面试**：最近 5 场实时面试，点进历史详情；标题栏只放「查看全部」
- **面试准备**：上半是材料准备度——档案 / 问答库 / 术语库三份材料里有几份已建好，环形图显示百分比，
  点击直接去补第一份缺失的材料；下半是三个材料入口，图标分别是「简历里的人」「带问号的对话」「词典/术语」，
  带数量，直达「面试材料」对应标签页
- **主视觉**：设计稿导出的 SVG 字标 `FUCKINTERVIEW`（`src/assets/wordmark.svg`，610×64），
  宽度占主视觉那一栏的 75%，高度按 610:64 等比算，窗口怎么拉都跟着缩放；开始面试按钮比它窄一些。
  SVG 不直接当图片贴，而是当 CSS 遮罩、底下填当前主题的前景色——深色主题下是白色，浅色主题下是近黑色，
  两个主题都不用另出一版图。右侧的累计 / 本周场次不套卡片，直接落在页面底色上
- 导航里不再有「实时面试」；面试页只从首页的「开始面试」进入，面试中侧栏高亮首页，
  面试页右栏的实时指标面板默认折叠成图标条。**面试进行中侧栏自动折叠、除设备选择外全部置灰**
  （页面入口、展开按钮、设置都点不了）；连接失败、共享被取消或这一场断开后放开，
  免得停在一个走不掉的页面
- **历史记录**：顶部的全部 / 实时 / 模拟滑块与「面试材料」用同一个组件，位置和内容宽度也一致
  （模拟筛选只用于查看模块移除前的旧记录）；列表每次 30 条、可继续加载；点一条看摘要和按时间排序的
  完整转写（面试官 / 候选人 / AI，AI 回答默认折叠两行，问答库直出的会单独标记），
  异常断开的场次带「中断」标记，档案名可点回面试材料

### 数据是怎么记的

- 每场会话在 `config/sessions.db`（跟数据目录一起迁移）留一行：时间、时长、档案快照名、
  实际使用的模型、token、TTFB / 首字延迟、STT 音频秒数、轮次；转写按句存在 `session_turns`，
  术语纠错和疑似误听存在 `session_corrections`
- 实时面试有两条连接（面试官 + 候选人麦克风），前端在开始面试时生成 `interviewId`，
  两路 `/start` 的 body 都带上它；后端把两条连接拼成同一场
- 转写来自 Pipecat 的 `TranscriptionFrame`；AI 输出按 `LLMFullResponseStart/EndFrame` 聚合成整条；
  问答库直接贴原文的那一轮标成 `qa`，用来统计命中率
- **不足 60 秒的会话按误触处理，整行删除**；前端主动结束（点断开、切页）会先上报，
  没上报就断开的（关标签页、网络错误）记为「中断」。面试页点右上角「断开」后，连接一收掉就自动回首页，
  这一场此时已经写进历史记录（不足 60 秒的除外）
- 术语库的「上一场回顾」改为读这个库，进程重启后仍在；「忽略」只对那一场生效

## 面试材料

侧栏第三项「面试材料」，页头和首页、历史记录一样带页面标题；顶部滑块分三段：
**面试档案**、**问答库**、**术语库**。
问答库与术语库见下面两节。

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

经历卡生成后，页面底部是 **「和 AI 完善面试档案」**——一张**补全清单**，不是聊天窗口。

每张卡固定 6 个维度，顺序不变：规模与数据口径 → 你具体做了什么 → 团队分工与你的边界 →
技术或流程细节 → 结果怎么验证 → 如果重做会怎么改。第一次打开某张卡时，AI 结合这张卡的
内容一次性生成 6 个问题并写进档案，之后一直复用；点开一格、答完保存即可，界面会自动
跳到下一个还没答的维度。回答逐格落盘（这一步不经过模型，断网也不会丢），答过的格子标
「待写入」；点右上角「写入经历卡」把这些回答一次性合并进卡片（这时才调模型），
合并后标「已写入」。顶部按这张卡已答的格子数显示进度，只增不减。

教练**不保存、也不读取对话历史**：状态就是档案里的 `coachSlots`（问题 + 回答）。
所以关掉页面、重启服务、换台机器，重新打开都是「接着看清单」，
不存在「中断后接不上之前那段对话」的问题。
实时面试的提示词也据此调整：缺细节时停在能确认的部分，不主动补「材料里没有记录」
「不在我的工作范围内」这类免责说明。

所有编辑自动保存（停手 800ms 后写盘）。档案默认存在 `config/profiles.json`，可在
「设置 → 通用设置 → 数据目录」换成别的目录（切换时把现有文件复制过去，旧文件保留 `.bak` 备份）。
这个文件含个人简历，已在 `.gitignore` 里。AI 整合与经历卡生成直接用「设置 → 模型配置」里的 LLM，
不经过语音 pipeline。

实时面试页顶栏可以选一份档案：连接时把 `profileId` 随 `/start` 下发，后端用候选人视角的提示词把
简历、岗位描述和已生成的经历卡拼进上下文（见上一节）。

## 问答库

「面试材料 → 问答库」是你自己整理的面试问答。一条 = **主问题 + 答案 + 别名问法 + 类型**，
存在 `config/qa.db`（SQLite 单文件），和 `profiles.json` 同住数据目录。
按档案隔离预留了 `profile_id` 字段，本期按全局一个库使用。

分类轴只有「类型」一条（通用 / 行为面 / 知识 / 项目技术）。早期版本还有自由文本的「分类」
和多选的「标签」，两条轴和「类型」语义重叠，导入时该怎么填全凭手感，已去掉。

**三种检索同时生效**：

- **语义**：本地向量模型 `BAAI/bge-small-zh-v1.5`（512 维，ONNX，**不需要 torch**），
  主问题和每个别名各算一条向量，检索时取最高分——所以「简单介绍一下你自己」能命中
  「请做一下自我介绍」
- **关键词**：SQLite 自带的 FTS5（`trigram` 分词器，中文不需要 jieba）。两字词低于 trigram
  的 3 字符下限，会自动退化成子串扫描
- **类型**：普通筛选，用于浏览

两路召回用 RRF 融合后排序，页面上显示的是余弦相似度。检索是**问题对问题**，所以查询侧不加
bge 的指令前缀（实测加了反而把同义问题的相似度从 0.82 压到 0.70）。答案也向量化，
但只用于页面内的答案侧搜索，不参与问题检索。

**导入**支持 Excel（`.xlsx`）、CSV 和 Markdown，页面里有模板下载：

| 列 | 说明 |
| --- | --- |
| 问题 / 答案 | 必填 |
| 别名 | 多个用 `\|` 或 `;` 分隔 |
| 类型 | 通用 / 行为面 / 知识 / 项目技术，空 = 通用 |

Markdown 用 `## 问题` + 紧随其后的 `> 别名: …` 元数据行，正文到下一个标题为止；
`# 行为面` 这样的一级标题如果是类型名，它下面的问题都归到这一类型，写别的会被忽略。
导入前会出**预览**：新增 / 更新（主问题归一化后同名）/ 跳过（内容完全相同）/ 疑似重复
（问法不同但向量相似度 > 0.95，只提示不合并）。确认后可选「撤销新增」删掉这一批新加的条目。

**索引是后台异步算的**：保存或导入只写库、界面立刻返回，向量由一条后台线程补算，
列表上用小圆点显示「已索引 / 待索引 / 失败」。模型常驻内存（约 200MB），首次使用会从
`hf-mirror.com` 下载约 90MB（HuggingFace 直连不通），缓存在数据目录的 `models/`
（开发版 `config/models`，安装版 `userData/data/models`）；可在「设置 → 通用设置 → 模型目录」
换位置，留空则跟随数据目录。换数据目录时，跟随模式的模型缓存会一起复制过去。

**实时面试已经接上问答库**。面试官说完一句话，后端先拿转写去问答库检索：

- 命中（余弦相似度 ≥ `embedding.relevance_threshold`，默认 0.75）且类型是
  `通用 / 行为面 / 知识` → **把库里写的答案原样推给前端**，这一轮完全不跑 LLM，
  所以是秒出，也不会被模型改写
- 没命中，或者类型是 `项目技术` → 照旧走 LLM + 面试档案

`项目技术` 永远走档案，是因为库里的标准答案会盖掉你项目卡里更具体的细节。
模型没下载、检索报错都当作没命中，面试不会因为问答库挂掉而中断。
命中的那一条会打在服务端日志里（`问答库命中「…」score=…`）。

完整表结构与设计取舍见 [docs/qa-library-design.md](docs/qa-library-design.md)。

## 术语库

「面试材料 → 术语库」管的是**专业名词**：让 ASR 把 `JGV` 听错时改回 `GMV`，
顺便把公司内部黑话的含义告诉模型。一条 = **规范写法 + 替换词（ASR 常见的误转写）+ 可选释义**，
存在 `config/terms.db`（SQLite 单文件，一张 `terms` 表，替换词以 JSON 数组存同行），
和 `qa.db` 一样跟着数据目录走。新建和编辑都在弹窗里完成。

**内置四套模板**（产品 / 研发 / AI / 运营，各 30 条），首次启动自动入库。词条用英文术语，
替换词是同音或近音的误听写法（`GMV` ← `JGV`，`ROI` ← `RUA`）。模板按**插件**用：
搜索栏右侧的「模板」浮层里可以随时开启或关掉某一套——关掉的那套在列表里也不出现，
并且不参与纠错和提示词注入。浮层底部可以新建自己的模板（存在 `templates` 表里），
新建术语时能选它；删掉自建模板时，里面的词条退回「自定义」，不会跟着消失。
单条也可以停用、删除；删掉的模板词不会在下次启动时被补回来，
想反悔就点「恢复默认」。自定义词条排在模板前面，同一个词以自定义为准。模板只带词和替换词，
**不带释义**——模型本来就知道 GMV 是什么，它不知道的是你团队自己的叫法。

**纠错发生在 STT 和用户聚合器之间**（`TermCorrector`）：转写文本先按替换词精确匹配替换，
再交给聚合器和模型。所以问答库检索、LLM 上下文、前端看到的转写都是规范写法。
匹配大小写不敏感、要求词边界（`GMVs`、`superGMV` 不会被改）。改写前会说一句
`术语已纠正`：实时面试页顶部会出现 `JGV → GMV` 的提示，会话结束后这些记录
和「疑似被听错的词」（编辑距离 1 的近形词）一起出现在术语库顶部，点一下就加为替换词。

**提示词注入**只放「本场对话里提到过、而且填了释义」的词条，释义截断到 50 字，
整段上限 2000 字符，放在系统提示词**最末尾**——它比档案变得勤，放最后才不会让前面的内容
整段掉出供应商的前缀缓存。术语段变了才重建系统提示词，没变就不碰。
每回合还会把对话历史裁到最近 20 条消息，避免长会话把上下文顶爆。

ASR 供应商侧的热词参数（`keywords` / `context`）**没有接**：默认的 MiniMax 没有这个字段，
接了也只对个别供应商生效，与「换模型也依旧生效」冲突。

测试分两层：`tests/test_terms.py` 测纯逻辑（替换词命中、大小写、词边界、停用、
模板同步、批量解析），`tests/test_pipeline.py` 用 pipecat 的 `run_test` 把帧真的过一遍，
确认转写确实被改写、释义确实进了系统提示词、历史确实被裁剪：

```bash
PYTHONUTF8=1 .venv/Scripts/python.exe -m pytest tests -q
```

## 其他资料

侧栏第四项「其他资料」：上传**逐字稿、作品集**这类面试时要摆在眼前的东西，支持 `.md` 与 `.pdf`，
单个文件不超过 100MB。列表按上传时间倒序（最新的在最上面），点条目进入全宽预览，
「…」菜单里可以重命名（只改显示名）或删除。上传支持拖拽到页面，也支持右上角按钮选择文件；
同名文件自动加序号，不会覆盖。

这份资料是**全局的、纯展示的**：不挂在任何一份面试档案下，也不进提示词、不进检索、
不参与任何模型调用——上传什么都不会改变 AI 的回答。

实时面试页的底部条就是这份列表：左边选资料，右边预览。PDF 单页渲染，可以翻页、按档位缩放
（50%–300%，默认适应宽度）、放大后按住左键拖拽平移，`Ctrl + 滚轮` 以光标为中心缩放，
`←`/`→`、`PageUp`/`PageDown` 翻页；Markdown 直接上下滚动阅读。预览器不做文字层
（不能框选 PDF 文字），md 里的相对路径图片也解析不了，只支持外链图片。

原件存在数据目录下的 `documents/`，索引是同目录的 `documents.json`；切换数据目录时会一起复制，
目标目录已有 `documents.json` 则拒绝。

## 设置页

点击右上角齿轮 ⚙ 打开，分两个标签页：「通用设置」（界面语言、主题、采集麦克风、数据目录）与
「模型配置」（ASR / LLM / TTS 三段，同页滚动）：

| 能力 | 支持的供应商 |
| --- | --- |
| ASR | Qwen（qwen3-asr-flash）、MiniMax（asr-1.0）、Deepgram、OpenAI Whisper 及兼容接口 |
| LLM | 任意 OpenAI 兼容接口（OpenAI / DeepSeek / SiliconFlow / Ollama / vLLM）、Qwen、Anthropic |
| TTS | MiniMax、Qwen、OpenAI、ElevenLabs、Cartesia |

配置保存到 `config/settings.json`，**下一次点击 Connect 时生效**。密钥只保存在本机。
「模型配置」里的 Base URL / 模型 / 音色都**不预填**：新建配置或切换供应商时留空，由用户自己填；
只有后端构建服务时才用各供应商的兜底默认值。

「通用设置」里的 **采集麦克风（面试者）** 只影响实时面试的第二路会话：关闭后不再建立麦克风会话，
面试者的语音不转写、也不产生 ASR 费用；连接中修改需要重连才生效。设备选择保存在浏览器本地，两个页面共用。

「通用设置」里的 **防截屏 / 防录屏** 在桌面端生效：开启后窗口会从系统截屏、录屏和屏幕共享的画面里隐藏
（Windows 使用 WDA_EXCLUDEFROMCAPTURE，需 Windows 10 2004+），自己的屏幕上仍正常显示；
状态保存在当前渠道的 `userData/privacy.json`，启动时在窗口显示前应用。手机拍摄和外接采集卡无法阻止。

实时面试不使用 TTS；TTS 配置项保留，但当前没有页面会用到。

几个易错点：

- **MiniMax** 需要额外的 `Group ID`；国内域名 Base URL 填 `https://api.minimax.cn/v1`
  （代码会补成 `/t2a_v2`）
- **MiniMax ASR** 走 `POST {base_url}/speech_to_text`（multipart，模型 `asr-1.0`）：
  默认带 `stream=true`，接口按 SSE 逐段推 `delta`，服务边收边推中间结果、`finish` 后出最终转写；
  国内 Base URL 用 `https://api.minimax.cn/v1`。国内 Key 打到国际站 `api.minimax.io` 会报
  `401 invalid api key`。注意官方接口只收带容器的音频、**不支持裸 PCM 流式输入**，
  所以识别仍是「VAD 切段 → 每段流式返回」，不是边说边出字
- **流式显示**：「回答」面板自己攒回答——按 `bot-llm-started / bot-llm-text / bot-llm-stopped`
  把每轮 LLM 输出切成一条消息并逐 token 填字。不直接用 SDK 的 assistant 消息：没有 TTS 时
  RTVI 拿不到「说完了」的边界，SDK 会把后面几轮回答都并回同一条。
  识别侧的中间结果（`InterimTranscriptionFrame`）在「对话」面板里先以半透明气泡显示，
  最终转写到了再换成正式消息
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
| POST | `/api/profiles/{id}/coach/questions` | 取一张卡的补全清单（首次会生成 6 个问题） |
| POST | `/api/profiles/{id}/coach/answer` | 保存一格回答（纯本地写盘） |
| POST | `/api/profiles/{id}/coach/apply` | 把没写回的回答合并进经历卡 |
| GET | `/api/documents` | 其他资料列表（新 → 旧） |
| POST | `/api/documents` | 上传一份资料（multipart，字段 `file`） |
| PATCH | `/api/documents/{id}` | 重命名（只改显示名） |
| DELETE | `/api/documents/{id}` | 删除资料与原件 |
| GET | `/api/documents/{id}/file` | 原件直出（支持 Range，PDF 按需分片） |
| GET | `/api/storage` | 数据目录 / 模型目录信息（含 `modelDirCustom`） |
| PUT | `/api/storage` | 切换数据目录和 / 或模型目录（默认迁移现有文件；`modelDir: ""` 表示跟随数据目录） |
| POST | `/api/storage/open` | 在资源管理器中打开数据目录 |
| GET | `/api/sessions/stats` | 首页看板：热力图、总量/平均、当前模型 |
| GET | `/api/sessions` | 历史列表（`mode=all|live|mock`、`limit`、`offset`） |
| GET | `/api/sessions/{id}` | 单场摘要 + 完整转写 + 术语纠错 |
| POST | `/api/sessions/end` | 前端主动结束上报（`{ interviewId }`），区分正常结束与中断 |
| GET | `/status` | Runner 状态与可用传输 |
| POST | `/start` | 建立会话（Pipecat 官方协议）；`body.mode` 选择管道 |
| POST | `/api/offer` | SmallWebRTC 信令 |

`body.mode` 决定服务端管道：

| mode | 管道 | 用途 |
| --- | --- | --- |
| `live`（默认） | STT → LLM → 文本输出（无 TTS） | 实时面试的面试官一路 |
| `listen` | 仅 STT | 实时面试的麦克风一路，只回传转写 |

实时面试的两路 body 带同一个 `interviewId`（前端每次开始面试生成），`live` 另带 `profileId`；
后端据此把两路写进同一场会话。`mock` 模式已随模拟面试模块移除，旧客户端传 `mock` 会按 `live` 处理。

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

## pipecat 精简

`pipecat/` 原本是上游仓库的完整克隆（250MB，其中 197MB 是 git 历史），实际用到的只是很小一部分。
清理以「本项目 import 得到的模块」为准：从 `server.py`、`app/`、`tests/` 出发做静态可达性分析
（含函数内的延迟导入），716 个模块里保留 273 个。

- **删掉的**：没用到的厂商服务（Google / AWS / Azure / xAI / Groq / …）、`cli`、`flows`、
  `classifiers`、`extensions`、没被 runner 引用的 transports（websocket client 等）、
  `workers` 里的 llm / ui / proxy 子包，以及仓库级的 `examples/`、`docs/`、`tests/`、`evals/`、
  `scripts/`、CI 配置等。工作区从 54MB 降到 19MB
- **保留的**：正文用到的服务与基类（OpenAI / Anthropic / Qwen / MiniMax / Deepgram / Cartesia /
  ElevenLabs）、smallwebrtc 传输、runner、`pipecat.tests.utils`（项目测试在用），
  以及 `audio/vad/data`、`audio/turn/smart_turn/data` 里的 Silero VAD / Smart Turn v3 ONNX 模型——
  这两个目录是按路径加载的运行时资源，没有 import 引用，不能按可达性删
- **备份**：`backups/pipecat-before-cleanup-20261101.zip`（29MB，已在 `.gitignore` 里）；
  `pipecat/` 自己的仓库也留了标签 `pipecat-before-cleanup-20261101`，精简本身提在本地分支
  `local/cleanup-20261101` 上（这个克隆指向上游，推不上去）
- **还原**：`git -C pipecat checkout pipecat-before-cleanup-20261101 -- .`，或者解压备份覆盖
- **换机器**：仍按原方式 `pip install -e pipecat`；以后要 `git pull` 上游更新，
  先切回 `main` 再合并，别把这条本地分支推上去
