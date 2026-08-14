#!/bin/bash
# run-task.sh —— 通用长任务运行器
#
# 用法: ./run-task.sh "步骤描述" <命令...>
#   进度（中文汇报）每 5 秒心跳一行，写入进度日志
#   命令原始输出重定向到日志文件
#
# 多步骤长任务可写成薄脚本逐步骤调用本脚本。

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$SCRIPT_DIR/task-progress.log"
OUT="$SCRIPT_DIR/task.stdout.log"

STEP="${1:?用法: ./run-task.sh \"步骤描述\" <命令...>}"
shift

ts() { date +%H:%M:%S; }
START=$(date +%s)
elapsed() { echo "$(( $(date +%s) - START ))s"; }

# 心跳：每 5 秒追加一行当前步骤进度
heartbeat() {
  while true; do
    sleep 5
    echo "[$(ts)] 正在执行：${STEP}，累计耗时 $(elapsed)" >> "$LOG"
  done
}

echo "[$(ts)] === 开始：${STEP} ===" >> "$LOG"
heartbeat &
HB_PID=$!

"$@" >> "$OUT" 2>&1
RC=$?
kill "$HB_PID" 2>/dev/null

if [ "$RC" -eq 0 ]; then
  echo "[$(ts)] ✓ 完成：${STEP}，耗时 $(elapsed)" >> "$LOG"
else
  echo "[$(ts)] ✗ 失败：${STEP}（退出码 $RC），原始输出见 task.stdout.log" >> "$LOG"
fi
exit "$RC"
