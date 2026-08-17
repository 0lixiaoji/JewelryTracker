#!/bin/bash
# heartbeat.sh —— 实现「思考/编码期间每 5 秒向 task-progress.log 写一行进度」的后台心跳
#
# 用法: ./heartbeat.sh "<消息前缀>" <最长运行秒数>
#   每 5 秒向 task-progress.log 追加一行 "[HH:MM:SS] <消息前缀>（自动心跳）"
#   到达最长运行秒数后自停（防止残留）
#
# 说明: Claude 生成回复（思考）期间无法执行工具，只能由本独立进程持续写日志。

set -u
LOG="$(cd "$(dirname "$0")" && pwd)/task-progress.log"
MSG="${1:-正在编写代码...}"
MAX="${2:-600}"
END=$(( $(date +%s) + MAX ))
while [ "$(date +%s)" -lt "$END" ]; do
  echo "[$(date +%H:%M:%S)] $MSG（自动心跳）" >> "$LOG"
  sleep 5
done
