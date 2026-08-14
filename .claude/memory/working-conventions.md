---
name: working-conventions
description: 排查、操作、凭证、Git、工具使用及 Memory 管理准则
metadata:
  type: feedback
---

## 通用准则

- 始终用中文回复用户
- 先验证再诊断；查配置先项目后系统；验证通过再汇报
- 简单操作直接执行，破坏性/歧义才确认
- 环境变量（`$`）视同密码，禁止 echo/拼入，判空用 `-z`；不猜测凭证
- 慎用会打印敏感信息的命令——`git remote -v` 等可能直接暴露 token，应先评估输出再决定是否执行
- Git commit 覆盖 `git diff --stat` 全部变更
- Glob "No files found" ≠ 目录不存在，确认目录用 Read
- Shell 是 Git Bash（POSIX sh），非 PowerShell，路径用 `/`
- 移动文件：新位置写入后必须删除旧文件

## APK 构建

- 每次构建 APK 前，先把 `frontend/public/sw.js` 的 `CACHE_NAME` 版本号 +1（如 jewelry-v6 → jewelry-v7）
- **Why:** 手机升级安装时保留 App 数据，旧 Service Worker 缓存仍在；若 sw.js 脚本未变，浏览器不会装新 SW，旧缓存一直生效，用户看到的是旧界面（v5→v6 即此教训）

## Memory 管理

- 记忆文件统一放项目 `.claude/memory/`，经 CLAUDE.md 顶部 `@import` 自动加载进每个会话
- 合并优先：同类主题更新已有文件，全新主题才新建，避免碎片化
- 新建/删除记忆文件后，同步更新 CLAUDE.md 的 `@import` 列表（即索引）

## 进度反馈

适用于**所有长时间运行的任务**：

- 用通用运行器 `./run-task.sh "步骤描述" <命令...>` 启动长任务：每 5 秒心跳一行进度到项目根目录 `task-progress.log`，命令原始输出重定向到 `task.stdout.log`
- 多步骤长任务写成薄脚本逐步骤调用 run-task.sh
- **格式要求**：`task-progress.log` 写入的是**中文进度汇报**（每行 `[HH:MM:SS]` + 当前步骤描述 + 耗时/结果），**禁止**把原始命令输出（stdout/stderr 重定向）当进度写进文件——那只是日志，不是汇报

**Why:** 用户希望对所有持久化记忆有审核权，也希望在任务执行过程中有可见的进度反馈。
