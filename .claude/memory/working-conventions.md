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

- 长命令（如 `flutter build`）：直接执行，执行前后各写一条进度行到 `task-progress.log`
- 需要每 5 秒持续心跳时：`./run-task.sh --watch "描述"` 启动、`./run-task.sh --stop` 停止（心跳描述须与当前操作一致）
- 快速写代码阶段**不用**后台心跳，改为每写一个文件就写一条准确的进度行
- **格式**：`task-progress.log` 每行 `[HH:MM:SS]` + 步骤描述 + 耗时/结果，**中文汇报**，禁止把原始命令输出当进度写入
- 步骤描述必须**具体到当前文件/操作**（如「写 wear_service.dart 事务」），禁止宽泛描述（如「编写数据层」）

**Why:** 用户希望在任务执行全程都有可见的进度反馈。
