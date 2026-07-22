---
name: working-conventions
description: 排查、操作、凭证、Git、工具使用及 Memory 管理准则
metadata:
  type: feedback
---

## 通用准则

- 先验证再诊断；查配置先项目后系统；验证通过再汇报
- 简单操作直接执行，破坏性/歧义才确认
- 绝不猜测凭证；掩码输出；禁止 echo/拼入命令
- Git commit 覆盖 `git diff --stat` 全部变更
- Glob "No files found" ≠ 目录不存在，确认目录用 Read
- Shell 是 Git Bash（POSIX sh），非 PowerShell，路径用 `/`
- 移动文件：新位置写入后必须删除旧文件

## Memory 管理

- 合并优先：同类主题更新已有文件，全新主题才新建，避免碎片化
- 写后同步 MEMORY.md 索引
- 默认项目 `.claude/memory/`，「系统目录」才写全局

**Why:** 用户希望对所有持久化记忆有审核权。
