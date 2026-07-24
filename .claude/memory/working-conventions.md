---
name: working-conventions
description: 排查、操作、凭证、Git、工具使用及 Memory 管理准则
metadata:
  type: feedback
---

## 通用准则

- 先验证再诊断；查配置先项目后系统；验证通过再汇报
- 简单操作直接执行，破坏性/歧义才确认
- 环境变量（`$`）视同密码，禁止 echo/拼入，判空用 `-z`；不猜测凭证
- 慎用会打印敏感信息的命令——`git remote -v` 等可能直接暴露 token，应先评估输出再决定是否执行
- Git commit 覆盖 `git diff --stat` 全部变更
- Glob "No files found" ≠ 目录不存在，确认目录用 Read
- Shell 是 Git Bash（POSIX sh），非 PowerShell，路径用 `/`
- 移动文件：新位置写入后必须删除旧文件

## Memory 管理

- 合并优先：同类主题更新已有文件，全新主题才新建，避免碎片化
- 写后同步 MEMORY.md 索引
- 默认项目 `.claude/memory/`，「系统目录」才写全局

## 进度反馈

- 执行多步骤任务时，每完成一个关键步骤在对话中输出当前完成百分比（如"进度 30%"，不需要精确，大致感觉即可）

**Why:** 用户希望对所有持久化记忆有审核权，也希望在任务执行过程中有可见的进度反馈。
