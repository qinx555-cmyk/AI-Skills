# AI Skills 合集

面向 AI 项目开发、知识库 RAG、视频内容分析与医疗行业 FDE 的可复用 Skills。仓库沿用原名称 `ai-healthcare-FDE-skill`，原医疗 FDE Skill 的目录和内容保持不变。

| Skill | 用途 |
| --- | --- |
| [ai-healthcare-fde-skill](ai-healthcare-fde-skill/SKILL.md) | 原有医疗 AI FDE 项目设计与治理 |
| [ai-project-engineering](ai-project-engineering/SKILL.md) | Vibe Coding 项目记忆、需求核对、模块边界和行为验收，减少无依据的推断与错误修改 |
| [rag-knowledge-chunking](rag-knowledge-chunking/SKILL.md) | 清洗与结构切割，保留标题上下文、表格关系和来源范围 |
| [video-content-analysis](video-content-analysis/SKILL.md) | 解析短视频分享链接，交叉核对内容，生成拆解与落地方案 |

## 安装与调用

把需要的完整 Skill 目录复制到所用 Agent 的技能目录。例如 Codex 的 `$CODEX_HOME/skills`（未设置时通常为 `~/.codex/skills`）。如有同名目录，先备份并比较，不要直接覆盖。各 Skill 可单独安装。

```text
使用 $ai-project-engineering 帮我开发或修复这个项目，先核对实际入口、需求和模块边界。
使用 $rag-knowledge-chunking 切割这份 Markdown，输出片段和来源完整性报告。
使用 $video-content-analysis 分析这个视频链接，区分视频主张、外部证据和推断。
```

## 独立脚本

Python 3.10+，脚本只使用标准库。视频内容读取需要 Agent 的浏览器和网页搜索能力，链接脚本本身只解析跳转和候选 ID，不下载视频或转写音频。

```bash
python3 rag-knowledge-chunking/scripts/chunk.py input.md --out chunks
python3 video-content-analysis/scripts/resolve_video_link.py 'https://www.douyin.com/video/<视频ID>'
python3 video-content-analysis/scripts/md_to_html.py input.md output.html
python3 video-content-analysis/scripts/verify_html.py output.html
```

视频解析目录已内置 HTML 转换和校验脚本，不需要另外安装 `markdown-to-html`。转换器支持轻量 Markdown 和基础 Mermaid LR/TD 流程图，不是完整 CommonMark/Mermaid 引擎；复杂嵌套列表和 TD 分支布局需人工复核。只转换可信 Markdown，不能将它当作不可信内容清洗器。基础校验可能将代码中的 Markdown 标记误报为残留。

RAG 脚本接受经核对的 Markdown 或结构块 JSON，不自带 PDF/OCR、Embedding 或 Rerank。质量报告检查解析后文本的来源覆盖，不等于原件解析准确或检索质量达标。目录内平台接口文档仅为原集成示例，该平台不包含在本仓库中。

## 许可与来源

本次新增的三个 Skill 各自使用目录内的 MIT LICENSE，允许复制、修改和再分发；原医疗 FDE Skill 的许可状态保持不变。视频方法文档保留来源说明和实现边界，原视频、转录原文、私人资料、账号凭据与业务数据不包含在仓库中。第三方素材的权利归各自权利人所有。

---

## 原医疗 FDE Skill 说明

# ai-healthcare-FDE-skill

一个面向医院、药企、CRO、IVD 和医疗器械企业的 Codex Skill，用于把医疗 AI 需求转化为可运行、可验证、可审计、可复用的 FDE 项目。

本项目由文章《AI如何赋能医疗行业》整理而成，保留了文章中的核心框架：AI Native、五维准入、R1–R3 风险分层、Stage 0–7、Human-in-the-loop、Golden Dataset、Delta/Echo 行业反馈和数据隔离。原始 Word 文件未被修改，也未包含在仓库中。

## 能做什么

- 评估医疗 AI 项目是否应当启动；
- 映射真实业务流程并识别 AI 介入点；
- 制定 Baseline、KPI、Demo/PoC 和真实数据验证方案；
- 设计生产上线、审计、回滚和人工升级机制；
- 把客户项目经验抽象为可复用行业资产；
- 输出可直接填写的准入、Stage Gate、验证、验收和 Echo 评审模板。

## 使用方式

将 `ai-healthcare-fde-skill` 目录安装到 Codex Skills 目录，然后调用：

```text
$ai-healthcare-fde-skill 请评估一家 IVD 企业的研发实验记录自动化项目，并给出 Stage 0–7 实施方案。
```

Skill 内部名称按 Codex 规范使用全小写 `ai-healthcare-fde-skill`；GitHub 仓库名称保留为 `ai-healthcare-FDE-skill`。

## 重要边界

本 Skill 提供项目设计和治理方法，不替代医生、研发、RA/QA、隐私、法务或其他法定责任人的专业判断。AI 不应自动作出最终诊断、治疗、质量放行、CAPA 关闭或正式注册提交决定。
