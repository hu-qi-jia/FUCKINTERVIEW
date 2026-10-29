# 问答库设计

> 状态：已实现（2026-10-29）。本文档记录最终采用的方案，实现时修正过的结论已在正文里标出。
> 范围：本期只做**页面 + 检索 API**；实时面试接入放在下一期。

## 1. 目标与边界

**它是什么**：一份本地问答库。你可以导入（xlsx / csv / md）或手动新增问答对，页面里能按语义、关键词、分类标签三种方式检索，编辑自动保存。

**它给谁用**：最终服务于实时面试——面试官问一句，命中库里的问题就把你写好的答案原样贴出来（不经 LLM 改写）。本期只把检索能力做出来，不接语音链路。

**明确不做**：
- 不做长文档切分、不调用 LLM 自动生成问答对（只接受已经成对的 QA）
- 不支持 docx / pdf 导入
- 不把面试档案（`profiles.json`）迁进 SQLite，两套存储并存
- 不做多用户 / 权限

## 2. 存储布局

```
<data_dir>/
  profiles.json        现有面试档案，本期不动
  qa.db                问答库（+ qa.db-wal / qa.db-shm）
  imports/             导入原始文件归档（可选，用于追溯）

config/
  settings.json
  models/              embedding 模型缓存，可配置
```

`qa.db` 跟随 `data_dir`，和 `profiles.json` 同住——只为迁移/备份方便，**与检索能力无关**。按档案隔离靠表里的 `profile_id` 字段。

模型目录单独配置（`settings.storage.model_dir`，默认 `config/models`），因为它是二进制资产，不该跟着用户数据迁移。

**切换数据目录**：`qa.db` 不能用 `shutil.copy2`（WAL 模式下文件复制会得到不一致快照），必须用 `VACUUM INTO` 或 SQLite 在线备份 API，先关连接、搬完再开。

## 3. 表结构

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- 库级元数据：schema 版本、当前 embedding 模型与维度
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- schema_version = '1'
-- embedding_model = 'BAAI/bge-small-zh-v1.5'
-- embedding_dim   = '512'

-- 导入批次：支持整批撤销、避免同一文件重复导入
CREATE TABLE imports (
  id         INTEGER PRIMARY KEY,
  source     TEXT NOT NULL,           -- 文件名
  format     TEXT NOT NULL,           -- xlsx | csv | md | manual
  file_hash  TEXT,                    -- sha256(文件内容)，用于「这个文件已经导过」提示
  inserted   INTEGER NOT NULL DEFAULT 0,
  updated    INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 一条问答
CREATE TABLE qa (
  id           INTEGER PRIMARY KEY,
  profile_id   TEXT,                  -- NULL = 全局；本期不使用，为将来按档案隔离预留
  question     TEXT NOT NULL,         -- 主问题，原文
  question_key TEXT NOT NULL,         -- 归一化后（去空白/全半角/标点/大小写），用于去重
  answer       TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT '',      -- 自由文本分类，'' = 未分类
  type         TEXT NOT NULL DEFAULT 'general'
               CHECK (type IN ('general','behavioral','knowledge','project')),
  proficiency  INTEGER NOT NULL DEFAULT 3 CHECK (proficiency BETWEEN 1 AND 5), -- 界面已不使用
  enabled      INTEGER NOT NULL DEFAULT 1,                                    -- 界面已不使用
  source       TEXT NOT NULL DEFAULT 'manual', -- manual | import
  import_id    INTEGER REFERENCES imports(id) ON DELETE SET NULL,
  source_ref   TEXT,                           -- 例如 'qa.xlsx#12' 或 'qa.md#行为面试/自我介绍'
  content_rev  INTEGER NOT NULL DEFAULT 0,     -- 内容每改一次 +1；向量落后即过期
  index_status TEXT NOT NULL DEFAULT 'pending'
               CHECK (index_status IN ('pending','indexing','ready','failed')),
  index_error  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX qa_question_key ON qa(question_key);
CREATE INDEX qa_type         ON qa(type, enabled);
CREATE INDEX qa_category     ON qa(category);
CREATE INDEX qa_profile      ON qa(profile_id);
CREATE INDEX qa_index_status ON qa(index_status);
CREATE INDEX qa_import       ON qa(import_id);

-- 别名问法：同一个答案的不同入口
CREATE TABLE qa_aliases (
  id       INTEGER PRIMARY KEY,
  qa_id    INTEGER NOT NULL REFERENCES qa(id) ON DELETE CASCADE,
  text     TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX qa_aliases_qa ON qa_aliases(qa_id);

-- 标签：多选，用于浏览筛选
CREATE TABLE qa_tags (
  qa_id INTEGER NOT NULL REFERENCES qa(id) ON DELETE CASCADE,
  tag   TEXT NOT NULL,
  PRIMARY KEY (qa_id, tag)
);
CREATE INDEX qa_tags_tag ON qa_tags(tag);

-- 向量：一条 QA 最多三类（主问题 / 每个别名 / 答案）
CREATE TABLE qa_vectors (
  id          INTEGER PRIMARY KEY,
  qa_id       INTEGER NOT NULL REFERENCES qa(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('question','alias','answer')),
  ref_id      INTEGER,               -- kind='alias' 时指向 qa_aliases.id，其余为 NULL
  text        TEXT NOT NULL,         -- 被向量化的原文（便于排查）
  model       TEXT NOT NULL,
  dim         INTEGER NOT NULL,
  vector      BLOB NOT NULL,         -- float32 小端，已 L2 归一化
  content_rev INTEGER NOT NULL,      -- 写入时 qa.content_rev 的快照
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX qa_vectors_key ON qa_vectors(qa_id, kind, COALESCE(ref_id, 0));
CREATE INDEX qa_vectors_model ON qa_vectors(model);

-- 关键词检索：trigram 分词器，中文按字符三元组切，无需 jieba
CREATE VIRTUAL TABLE qa_fts USING fts5(
  question, answer, aliases, tags,
  tokenize = 'trigram'
);  -- rowid = qa.id，同一事务内手工维护
```

### 两个保留但不再使用的列

`proficiency`（熟练度）和 `enabled`（是否参与检索）在第一版实现后从界面上撤掉了：
熟练度不参与任何排序、筛选或检索加权，只是装饰；而「是否参与检索」在个人使用的问答库里
没有真实场景——写进库里的就是要在面试时用到的。

两列**保留在表里**，不加迁移：默认值让新数据天然可用，将来真要做「只复习不熟的」或
「临时停用一条」时不用改表。前端已经不再读写它们，后端仍按 `enabled = 1` 过滤。

### 为什么向量的 `kind` 要分三类

- `question` / `alias` 参与检索：查询永远是「一个问题」，检索键就该是问题侧。
- `answer` **不参与实时检索**，只服务两件事：页面里「我写过关于缓存的内容吗」这类答案侧搜索；导入时做近似重复检测。
- **不把问题 + 答案拼成一段再向量化**：答案字数通常是问题的十几倍，会把向量拖向答案语义空间，问题侧的区分度反而下降。

### 已知限制：trigram 的 3 字符下限

FTS5 的 `trigram` 分词器要求查询串至少 3 个字符，中文两字词（「缓存」「并发」）匹配不到。兜底方案：长度 < 3 的查询改走 `LIKE '%q%'` 全表扫描——几千条量级下是毫秒级，可以接受。

### 为什么不用 chromadb / faiss

几千到几万条的量级下，numpy 做一次矩阵乘只要 1–3ms。多一个外部索引库就多一份「记录和向量可能脱节」的风险，以及一份依赖维护成本。当前 venv 里的 chromadb 是历史遗留，项目并未声明它。

## 4. 写入与索引

### 内容版本

`qa.content_rev` 每次内容变更 +1。后台 worker 补算完向量后，`qa_vectors.content_rev` 与之对齐；两者不等即为过期，界面上显示「待索引」。

### 后台索引 worker

- 单线程，进程内常驻，从队列取 `(qa_id, content_rev)`
- 保存只写库、立即返回，不阻塞界面；导入 500 条也不会卡
- 批量导入时一次性 `embed(batch)`，几百条/秒
- 失败写 `index_status='failed'` + `index_error`，页面可单条重试
- 页面显示「索引中 n 条 / 失败 m 条」

### 模型

- `fastembed` + `BAAI/bge-small-zh-v1.5`（512 维，24M 参数，ONNX fp32 约 95MB）
- **不依赖 torch**：依赖只有 onnxruntime（已有 1.31.1）+ tokenizers + huggingface-hub
- 常驻内存（单例懒加载，约 200MB RSS），用完不卸载——冷启 1–2 秒对「导入即搜」伤害更大
- 下载走 `HF_ENDPOINT=https://hf-mirror.com`（HuggingFace 直连不通，镜像 200）；失败时给明确提示并支持手动放置模型目录
- 内存吃紧时可换 `Xenova/bge-small-zh-v1.5` 的 int8 量化版（约 24MB）

**查询侧不加指令前缀**（实测结论）。bge 官方给的 `为这个句子生成表示以用于检索相关文章：` 前缀是为「短查询 vs 长文档」的非对称检索设计的；我们的检索是问题对问题、同分布，实测加上前缀反而把同义问题的相似度从 0.823 压到 0.703，整体分数下移。所以两侧都不加。

实测参考值（bge-small-zh-v1.5）：同义问法 0.823、相关问法 0.467、无关 0.324；512 维；模型 91MB；缓存加载 0.2s；批量 64 条 0.03s。

模型名与维度存在 `meta` 表；换模型需要重建全部向量（页面提供「重建全部索引」）。

## 5. 检索流程

```
查询串
  ├─ embed(query + 指令前缀) ............ 20–40ms
  │    └─ 余弦相似度（numpy 暴力，内存缓存） 1–3ms  → top 50
  └─ FTS5 trigram（或 <3 字符时 LIKE）... 1–5ms   → top 50
        ↓
    RRF 融合（k=60）→ top N
        ↓
    返回原文 + 相似度 + 命中方式 + 命中的是哪句话
```

用 RRF 而不是加权分数，是因为余弦和 BM25 的量纲不同，归一化容易出玄学问题；RRF 只用排名，稳定且无需调参。

### 命中之后怎么用（下一期）

- `type in ('general','behavioral','knowledge')` 且余弦 ≥ 0.75 → **原文直出**，不经过 LLM
- `type = 'project'` → **永远走 LLM + 档案**，库里的条目只当参考，不直接贴
- 未命中 → LLM + 档案（档案本来就是全量塞进 system prompt 的，不存在「档案检索不到」这一步）

阈值为配置项，页面展示相似度方便校准。

## 6. 导入格式

### 6.1 表格（xlsx / csv）

固定列，列名按表头匹配（顺序无关，缺列按默认值）：

| 列 | 必填 | 说明 |
| --- | --- | --- |
| 问题 | 是 | 主问题 |
| 答案 | 是 | 答案正文，可多行 |
| 别名 | 否 | 多个用 `\|` 或 `;` 分隔 |
| 标签 | 否 | 多个用 `,` 或 `;` 分隔 |
| 分类 | 否 | 自由文本，空 = 未分类 |
| 类型 | 否 | `通用` / `行为面` / `知识` / `项目技术`，也接受 `general` 等英文枚举，空 = 通用 |

读 xlsx 用 `openpyxl`（纯 Python，约 1MB，不需要 pandas）。

> 早期设计的「熟练度」列已从模板和界面移除：它没有任何功能在读（不参与排序、筛选和检索），
> 留着只是让每条记录多一个装饰字段。老文件里带这一列仍能正常导入，值被忽略。

### 6.2 Markdown

```markdown
# 行为面试                       ← 一级标题 = 分类（可省略，默认「未分类」）

## 请做一下自我介绍                ← 二级标题 = 主问题
> 别名: 简单介绍一下你自己; 介绍一下自己
> 标签: 通用, 开场

答案正文，可以多行、可以有空行。

## 你为什么离开上一家公司
...
```

解析规则：

- `##` 之后到下一个 `##` / `#` 之前是答案正文
- 紧跟标题的 `> 别名:` / `> 标签:` / `> 类型:` 算元数据；不在白名单里的 `>` 行一律按正文处理
  （`> 熟练度:` 仍被识别，但值被忽略）
- `类型` 从「分类」映射（分类名含「行为」→ `behavioral`，含「项目」→ `project`，含「知识/原理」→ `knowledge`，否则 `general`）；md 里也可写 `> 类型: 项目技术` 覆盖

### 6.3 模板下载

页面里三个按钮直接下载（模板文件随前端构建产物内嵌，不依赖后端）：

- `qa-template.xlsx`
- `qa-template.csv`
- `qa-template.md`

### 6.4 校验

- 问题为空 → 该行跳过，记入错误列表（不静默丢弃）
- 答案为空 → 同上
- 类型非法 → 回落到默认值并在预览里标黄
- 预览页汇总：有效 N 行 / 错误 M 行，错误可导出

## 7. 去重与重复导入

判定顺序：

1. `question_key` 完全相同 → 视为同一题
   - 内容有差异 → **更新**（保留 `id`、`import_id` 更新为新批次）
   - 内容完全相同 → **跳过**
2. `question_key` 不同、但问题侧余弦 > 0.95 → 列为「疑似重复」，**只提示不合并**，由你决定
3. 其余 → **新增**

导入前先出预览（新增 / 更新 / 跳过 / 疑似重复四类计数），确认后才落库。预览阶段已经算完向量，确认时复用，不重复计算。

`imports.file_hash` 命中时提示「这个文件导入过，是否继续」。

**撤销的语义**：撤销只删除这一批**新增**的条目；被更新过的老条目保留更新后的内容
（`update_qa` 不改 `import_id`，所以老条目的归属批次不会被这一批抢走）。

## 8. API 形状

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/qa/facets` | 分类 / 标签清单，给筛选器用 |
| GET | `/api/qa` | 列表，支持 `q / category / type / tag / status / limit / offset` |
| POST | `/api/qa` | 新增，返回后进索引队列 |
| GET | `/api/qa/{id}` | 单条 |
| PATCH | `/api/qa/{id}` | 部分更新，`content_rev` +1 |
| DELETE | `/api/qa/{id}` | 删除 |
| POST | `/api/qa/bulk-delete` | 批量删除 |
| POST | `/api/qa/search` | `{q, limit, types[], categories[], tags[], profileId?}` |
| POST | `/api/qa/import/preview` | multipart 上传，返回预览 + 一次性 token |
| POST | `/api/qa/import/commit` | `{token, mode: "merge" | "append"}` |
| DELETE | `/api/qa/imports/{id}` | 撤销整批 |
| GET | `/api/qa/stats` | 总数 / 各状态计数 / 索引进度 |
| POST | `/api/qa/reindex` | `{scope: "all" | "failed" | "stale"}` |

模板下载**不走后端**：三个文件放在 `web/client/public/`，由前端静态托管。

`/api/qa/search` 返回：

```json
{
  "results": [
    {
      "id": 12,
      "question": "请做一下自我介绍",
      "answer": "……",
      "aliases": ["简单介绍一下你自己"],
      "tags": ["通用", "开场"],
      "category": "行为面试",
      "type": "behavioral",
      "proficiency": 4,
      "score": 0.86,
      "matchedText": "简单介绍一下你自己",
      "matchedBy": ["vector", "keyword"]
    }
  ]
}
```

## 9. 设置页新增

**通用设置 → 存储**：在现有「数据目录」下面增加「模型目录」（默认 `config/models`）。

**模型配置 → 向量（新的一段）**：
- 模型名（默认 `BAAI/bge-small-zh-v1.5`）
- 当前索引条数 / 模型维度
- 「重建全部索引」按钮 + 进度

## 10. 页面交互

1. 列表 = 搜索框 + 分类/类型/标签筛选 + 索引状态标识，每页 50 滚动加载；
   三个筛选器固定宽度（`w-32`），选中项字数不同也不会让右侧按钮横跳
2. 编辑 = 点开一行展开或右侧抽屉，问题/答案/别名/标签/分类/类型都可改，**800ms 防抖自动保存**
3. 导入 = 选文件 → 预览（新增/更新/跳过/疑似重复）→ 确认 → 进度（写库 + 后台索引）；
   确认后可「撤销新增」，删掉这一批新加的条目（已存在、只是被更新的条目保留更新后的内容）
4. 底部固定一条状态栏：左「共 N 条 / 已索引 M 条」（有筛选时改成「筛选出 X / N 条」），
   右「批量选择」；进入批量选择后同一条栏切换成「已选 N 条 + 全选本页 + 删除所选 + 退出」，
   列表滚动时始终可见
5. 「导入 / 新建问答」放在顶部标签栏右侧，和面试档案的「新建档案」同一位置；
   进入导入页后同一个按钮变成「返回问答库」；手动新增同样进后台索引队列
6. 文案走 `i18n/index.ts` 的 `zh` / `en` 两份

## 11. 待定 / 风险

- **内存水位**：机器 16GB 但当前可用仅 0.7GB，模型常驻 200MB 有压力。缓解：默认 fp32，设置里可切 int8；启动前检查可用内存并给出提示。
- **首次下载**：95MB 走镜像，需要网络。离线场景只能手动放模型目录，文档里要写清楚目录结构。
- **检索质量阈值 0.75** 是经验值，需要在真实数据上校准；页面上显示相似度就是为了让你调。
- **档案与库的关系**（`profile_id`）本期不使用，字段留着是为了避免将来做隔离时迁移数据。
