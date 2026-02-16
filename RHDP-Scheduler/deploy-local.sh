#!/usr/bin/env bash
# deploy-local.sh - Build and run RHDP-Scheduler in Podman locally
#
# Usage:
#   ./deploy-local.sh              # build + run (default)
#   ./deploy-local.sh build        # build image only
#   ./deploy-local.sh run          # run existing image
#   ./deploy-local.sh stop         # stop + remove container
#   ./deploy-local.sh logs         # tail container logs
#   ./deploy-local.sh status       # show container status
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE="localhost/rhdp-scheduler:dev"
CONTAINER="rhdp-scheduler-dev"
PORT="${PORT:-8000}"
ACTION="${1:-all}"

# Pass host kubeconfig into the container for cluster operations
KUBECONFIG_HOST="${KUBECONFIG:-$HOME/.kube/config}"

build_image() {
  echo "=== Building image: $IMAGE ==="
  podman build \
    -f dockerfiles/Dockerfile \
    -t "$IMAGE" \
    --platform linux/amd64 \
    .
  echo "  Build complete."
  echo ""
}

stop_container() {
  if podman container exists "$CONTAINER" 2>/dev/null; then
    echo "=== Stopping container: $CONTAINER ==="
    podman stop "$CONTAINER" 2>/dev/null || true
    podman rm "$CONTAINER" 2>/dev/null || true
    echo "  Stopped."
  else
    echo "  Container '$CONTAINER' not running."
  fi
  echo ""
}

run_container() {
  stop_container

  echo "=== Starting container: $CONTAINER ==="
  echo "  Image: $IMAGE"
  echo "  Port:  http://localhost:$PORT"
  echo ""

  PODMAN_ARGS=(
    --name "$CONTAINER"
    -d
    -p "$PORT:8000"
    -e LOG_FORMAT=text
    -e LOG_LEVEL=DEBUG
    -e UVICORN_WORKERS=1
  )

  # Mount kubeconfig if it exists (for cluster operations from container)
  if [[ -f "$KUBECONFIG_HOST" ]]; then
    PODMAN_ARGS+=(-v "$KUBECONFIG_HOST:/app/.kube/config:ro,Z")
    PODMAN_ARGS+=(-e KUBECONFIG=/app/.kube/config)
    echo "  Kubeconfig: $KUBECONFIG_HOST (mounted read-only)"
  else
    echo "  Kubeconfig: not found (cluster operations disabled)"
  fi

  echo ""
  podman run "${PODMAN_ARGS[@]}" "$IMAGE"

  # Wait for health
  echo "  Waiting for health check..."
  for i in $(seq 1 20); do
    if curl -sf "http://localhost:$PORT/api/health" &>/dev/null; then
      echo "  Healthy after ${i}s"
      echo ""
      curl -s "http://localhost:$PORT/api/health" | python3 -m json.tool 2>/dev/null || true
      echo ""
      echo "==========================================================="
      echo "  RHDP-Scheduler running locally"
      echo "  URL: http://localhost:$PORT"
      echo "  Logs: ./deploy-local.sh logs"
      echo "  Stop: ./deploy-local.sh stop"
      echo "==========================================================="
      return 0
    fi
    sleep 1
  done
  echo "  WARNING: Health check not passing after 20s"
  echo "  Check logs: podman logs $CONTAINER"
  return 1
}

show_status() {
  if podman container exists "$CONTAINER" 2>/dev/null; then
    podman ps --filter "name=$CONTAINER" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    curl -s "http://localhost:$PORT/api/health" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  Not responding"
  else
    echo "  Container '$CONTAINER' is not running."
  fi
}

show_logs() {
  podman logs -f "$CONTAINER" 2>&1
}

case "$ACTION" in
  build)
    build_image
    ;;
  run)
    run_container
    ;;
  stop)
    stop_container
    ;;
  logs)
    show_logs
    ;;
  status)
    show_status
    ;;
  all|"")
    build_image
    run_container
    ;;
  *)
    echo "Usage: $0 [build|run|stop|logs|status]"
    exit 1
    ;;
esac
