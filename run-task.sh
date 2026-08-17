#!/bin/bash
# run-task.sh —— 心跳运行器
# 用法: --watch "描述" 启动 | --stop 停止
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$SCRIPT_DIR/task-progress.log"
PID_FILE="$SCRIPT_DIR/.task-heartbeat.pid"
ts() { date +%H:%M:%S; }
heartbeat_loop() {
  local step="$1" start="$2"
  while true; do
    sleep 5
    echo "[$(ts)] ${step}（$(( $(date +%s) - start ))s）" >> "$LOG"
  done
}
case "${1:-}" in
  --watch)
    STEP="${2:?用法: --watch \"描述\" | --stop}"
    [ -f "$PID_FILE" ] && kill "$(cat "$PID_FILE")" 2>/dev/null
    START=$(date +%s)
    echo "[$(ts)] === 开始：${STEP} ===" >> "$LOG"
    heartbeat_loop "$STEP" "$START" &
    echo $! > "$PID_FILE"
    disown 2>/dev/null || true
    exit 0
    ;;
  --stop)
    if [ -f "$PID_FILE" ]; then
      kill "$(cat "$PID_FILE")" 2>/dev/null
      rm -f "$PID_FILE"
      echo "[$(ts)] ✓ 已停止" >> "$LOG"
    fi
    exit 0
    ;;
  *) echo "用法: --watch \"描述\" | --stop" >&2; exit 1 ;;
esac
