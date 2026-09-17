# 可选的研发平台接入示例

本文描述原平台的集成约定。平台代码、适配器、配置和 API 服务不随本仓库分发；独立使用切割脚本无需这些组件。

安装目录：`biomed-agent-platform/app/skills/rag-knowledge-chunking`。固定适配器为 `app/knowledge_chunking.py`，运行参数在 `app/knowledge_config/index-v1.json`。运行的是预装脚本，不接受上传文件指定脚本路径。

- `GET /api/knowledge/chunking-skill`：登录后查询安装版本、参数与限制。
- `GET /api/knowledge/versions/{vid}/chunk-preview`：依原文件权限检查，返回片段、来源范围、质量报告；不写索引。
- `POST /api/projects/{pid}/knowledge/files`：新增接受 `.md/.markdown`；UTF-8 解析；保留原件、版本及 SHA-256。
- `POST /api/projects/{pid}/knowledge/reindex`：复用项目管理者权限及现有请求体 `{"remote": false}`，新索引调用本 skill；远端模式依赖已有 Dify 配置。

界面路径：项目工作区 → 管理项目资料、版本与索引 → 上传并解析 / 预览 RAG 切割 → 更新项目索引。

旧索引的冻结配置、原件版本与引用继续保留，升级不会自动改写已启用索引。新建索引在成功后切换；失败保留旧索引。新片段 `source_spans` 包含每个来源块及 `[start,end)` 字符范围；合并片段的原 `id` 是首个来源锚点，完整多块定位以 `source_spans` 为准。

Markdown 管道不抓取外链、不执行代码；图片 URL 仅保留为文本。HTML 表格标记待核对。当前 PDF 需先在本地转换并校验为 Markdown，本次没有新增 PDF 上传解析能力。表格行保留现有列结构；复杂跨行表格的语义关联仍需对照原件确认。
