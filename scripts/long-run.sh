#!/usr/bin/env bash
# Headless overnight loop. Run this INSIDE A CONTAINER for real autonomous work —
# an agent can otherwise touch your host. It calls stride repeatedly, each time in
# a fresh process, until the build is complete, a kill-switch appears, or a budget
# cap is hit.
#
# Usage: ./long-run.sh [project-dir]
# Env:
#   STRIDE_BIN       command to invoke stride (default: "stride")
#   STRIDE_MAX_LOOPS max iterations (default: 1000)
#   STRIDE_JOBS      concurrency for each run (default: 1)
set -euo pipefail

ROOT="${1:-.}"
BIN="${STRIDE_BIN:-stride}"
MAX="${STRIDE_MAX_LOOPS:-1000}"
JOBS="${STRIDE_JOBS:-1}"

i=0
while [ "$i" -lt "$MAX" ]; do
  if [ -f "$ROOT/AGENT_STOP" ]; then
    echo "AGENT_STOP present; halting."
    break
  fi
  out="$($BIN run --once -j "$JOBS" --cwd "$ROOT" 2>&1)" || true
  echo "$out"
  case "$out" in
    *complete*) echo "all features complete."; break ;;
    *no_ready_tasks*) echo "no ready tasks (blocked or done)."; break ;;
  esac
  i=$((i + 1))
done
