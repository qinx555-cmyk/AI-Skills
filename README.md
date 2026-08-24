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
