#!/usr/bin/env bash
# dev.sh - Start local Vite dev servers (frontend + backend)
#
# This is the fastest way to develop: hot-reload for both frontend and backend.
# No container build required.
#
# Deployment options:
#   1. ./dev.sh               — Vite dev servers (this script, for development)
#   2. ./deploy-local.sh      — Podman container (for local integration testing)
#   3. ./deploy.sh [dev|prod] — Remote OpenShift cluster (for staging/production)
#
# Usage:
#   ./dev.sh          # start both servers
#   ./dev.sh stop     # stop both servers
#   ./dev.sh status   # check if servers are running
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PORT=5500
FRONTEND_PORT=6500
ACTION="${1:-start}"

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo "=== Shutting down dev servers ==="
  # Send SIGTERM first for graceful shutdown
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi
  # Clean up any remaining processes on ports
  lsof -ti:"$BACKEND_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  lsof -ti:"$FRONTEND_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  echo "  Stopped."
}

stop_servers() {
  echo "=== Stopping dev servers ==="
  lsof -ti:"$BACKEND_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  lsof -ti:"$FRONTEND_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  echo "  Stopped."
}

start_servers() {
  stop_servers

  # Register cleanup on exit signals
  trap cleanup EXIT INT TERM

  echo ""
  echo "=== Starting Vite dev servers ==="
  echo "  Backend:  http://localhost:$BACKEND_PORT"
  echo "  Frontend: http://localhost:$FRONTEND_PORT"
  echo ""

  # Start backend
  uvicorn api.server:app --port "$BACKEND_PORT" --reload &
  BACKEND_PID=$!

  # Start frontend
  (cd "$SCRIPT_DIR/frontend" && npm run dev -- --port "$FRONTEND_PORT") &
  FRONTEND_PID=$!

  # Wait for both to be ready
  echo "  Waiting for servers..."
  for i in $(seq 1 15); do
    BACKEND_UP=false
    FRONTEND_UP=false
    curl -sf "http://localhost:$BACKEND_PORT/api/health" &>/dev/null && BACKEND_UP=true
    curl -sf -o /dev/null "http://localhost:$FRONTEND_PORT" &>/dev/null && FRONTEND_UP=true
    if $BACKEND_UP && $FRONTEND_UP; then
      echo ""
      echo "==========================================================="
      echo "  RHDP-Scheduler dev servers running"
      echo "  Open: http://localhost:$FRONTEND_PORT"
      echo "  API:  http://localhost:$BACKEND_PORT/api/health"
      echo "  Stop: Ctrl+C or ./dev.sh stop"
      echo "==========================================================="
      wait
      exit 0
    fi
    sleep 1
  done

  echo "  WARNING: Servers may not be fully ready. Check output above."
  wait
}

show_status() {
  echo "=== Dev server status ==="
  if lsof -ti:"$BACKEND_PORT" &>/dev/null; then
    echo "  Backend  (port $BACKEND_PORT): running"
    curl -s "http://localhost:$BACKEND_PORT/api/health" 2>/dev/null | python3 -m json.tool 2>/dev/null || true
  else
    echo "  Backend  (port $BACKEND_PORT): not running"
  fi
  if lsof -ti:"$FRONTEND_PORT" &>/dev/null; then
    echo "  Frontend (port $FRONTEND_PORT): running"
  else
    echo "  Frontend (port $FRONTEND_PORT): not running"
  fi
}

case "$ACTION" in
  start|"")
    start_servers
    ;;
  stop)
    stop_servers
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 [start|stop|status]"
    exit 1
    ;;
esac
