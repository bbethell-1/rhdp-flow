#!/usr/bin/env bash
# deploy.sh - Deploy RHDP-Scheduler to remote OpenShift via Kustomize
#
# Deployment options:
#   1. ./dev.sh               — Vite dev servers (hot-reload, for development)
#   2. ./deploy-local.sh      — Podman container (for local integration testing)
#   3. ./deploy.sh [dev|prod] — Remote OpenShift cluster (this script, for staging/production)
#
# Usage:
#   ./deploy.sh [dev|prod]           # full deploy (default: dev)
#   ./deploy.sh [dev|prod] dry-run   # render manifests only
#   ./deploy.sh [dev|prod] rollback  # rollback to previous deployment
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV="${1:-dev}"
DRY_RUN="${2:-}"

# Environment config
case "$ENV" in
  dev)
    NAMESPACE="rhdp-scheduler-dev"
    OVERLAY="openshift/overlays/dev"
    ;;
  prod)
    NAMESPACE="rhdp-scheduler"
    OVERLAY="openshift/overlays/prod"
    ;;
  *)
    echo "Usage: $0 [dev|prod] [dry-run]"
    exit 1
    ;;
esac

echo "==========================================================="
echo "  RHDP-Scheduler - Deploy to OpenShift ($ENV)"
echo "  Namespace: $NAMESPACE"
echo "  Overlay:   $OVERLAY"
echo "==========================================================="

# Dry-run mode - just render and exit
if [[ "$DRY_RUN" == "dry-run" ]]; then
  echo ""
  echo "> Rendering Kustomize manifests (dry-run)..."
  oc kustomize "$OVERLAY"
  exit 0
fi

# Rollback mode - undo last deployment
if [[ "$DRY_RUN" == "rollback" ]]; then
  echo ""
  echo "> Rolling back deployment..."
  if ! oc whoami &>/dev/null; then
    echo "ERROR: Not logged in to OpenShift. Run 'oc login' first."
    exit 1
  fi
  oc rollout undo deployment/rhdp-scheduler -n "$NAMESPACE"
  oc rollout status deployment/rhdp-scheduler -n "$NAMESPACE" --timeout=120s
  ROUTE_HOST=$(oc get route rhdp-scheduler -n "$NAMESPACE" -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
  echo ""
  echo "==========================================================="
  echo "  Rollback complete!"
  if [[ -n "$ROUTE_HOST" ]]; then
    echo "  URL: https://$ROUTE_HOST"
  fi
  echo "==========================================================="
  exit 0
fi

# Verify oc is connected
if ! oc whoami &>/dev/null; then
  echo "ERROR: Not logged in to OpenShift. Run 'oc login' first."
  exit 1
fi

CLUSTER=$(oc whoami --show-server)
USER=$(oc whoami)
echo ""
echo "> Cluster: $CLUSTER"
echo "> User:    $USER"
echo ""

# Step 1: Create namespace
echo "--- Step 1/6: Create namespace ---"
if oc get namespace "$NAMESPACE" &>/dev/null; then
  echo "  Namespace '$NAMESPACE' already exists."
else
  oc create namespace "$NAMESPACE"
  echo "  Created namespace '$NAMESPACE'."
fi
echo ""

# Step 2: Create ServiceAccount
echo "--- Step 2/6: Create ServiceAccount ---"
if ! oc get sa rhdp-scheduler -n "$NAMESPACE" &>/dev/null; then
  oc create sa rhdp-scheduler -n "$NAMESPACE"
  echo "  Created ServiceAccount 'rhdp-scheduler'."
else
  echo "  ServiceAccount 'rhdp-scheduler' already exists."
fi
echo ""

# Step 3: Validate and apply Kustomize manifests
echo "--- Step 3/6: Apply Kustomize manifests ---"
echo "  Validating manifests (server dry-run)..."
if ! oc apply -k "$OVERLAY" --dry-run=server -o yaml >/dev/null 2>&1; then
  echo "  WARNING: Server-side dry-run found issues. Applying anyway..."
fi
oc apply -k "$OVERLAY"
echo "  Manifests applied."
echo ""

# Step 4: Grant least-privilege RBAC to ServiceAccount
echo "--- Step 4/6: Grant RBAC permissions ---"
# Migrate from legacy cluster-reader to custom rhdp-scheduler ClusterRole
if oc get clusterrolebinding rhdp-scheduler-cluster-reader-"$ENV" &>/dev/null; then
  echo "  Removing legacy cluster-reader binding..."
  oc delete clusterrolebinding rhdp-scheduler-cluster-reader-"$ENV" || true
fi
if ! oc get clusterrolebinding rhdp-scheduler-"$ENV" &>/dev/null; then
  oc create clusterrolebinding rhdp-scheduler-"$ENV" \
    --clusterrole=rhdp-scheduler \
    --serviceaccount="$NAMESPACE:rhdp-scheduler"
  echo "  Granted rhdp-scheduler ClusterRole to SA."
else
  echo "  ClusterRoleBinding already exists."
fi
echo ""

# Step 5: Trigger binary build from local source and wait
echo "--- Step 5/6: Build from local source ---"
echo "  Preparing clean build directory..."
BUILD_DIR="/tmp/rhdp-scheduler-build-$$"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
rsync -a --exclude='node_modules' --exclude='.git' --exclude='videos' \
  --exclude='*.png' --exclude='*.webm' --exclude='*.mp4' \
  --exclude='.claude' --exclude='.memory' --exclude='.playwright-mcp' \
  --exclude='__pycache__' --exclude='.venv' --exclude='tests' \
  --exclude='.mcp.json' --exclude='.pytest_cache' \
  "$SCRIPT_DIR/" "$BUILD_DIR/"
echo "  Uploading source from $BUILD_DIR ($(du -sh "$BUILD_DIR" | cut -f1))..."
oc start-build rhdp-scheduler --from-dir="$BUILD_DIR" -n "$NAMESPACE" --follow 2>&1 || true
rm -rf "$BUILD_DIR"
# Check the build status
LATEST_BUILD=$(oc get builds -n "$NAMESPACE" -l buildconfig=rhdp-scheduler --sort-by=.metadata.creationTimestamp -o name 2>/dev/null | tail -1)
if [[ -n "$LATEST_BUILD" ]]; then
  BUILD_PHASE=$(oc get "$LATEST_BUILD" -n "$NAMESPACE" -o jsonpath='{.status.phase}')
  echo "  Build status: $BUILD_PHASE"
  if [[ "$BUILD_PHASE" != "Complete" ]]; then
    echo "  ERROR: Build did not complete successfully."
    oc logs "$LATEST_BUILD" -n "$NAMESPACE" --tail=30
    exit 1
  fi
  echo "  Build completed."
else
  echo "  ERROR: No build found."
  exit 1
fi
echo ""

# Step 6: Wait for rollout (auto-rollback on failure)
echo "--- Step 6/6: Wait for rollout ---"
oc rollout restart deployment/rhdp-scheduler -n "$NAMESPACE"
if ! oc rollout status deployment/rhdp-scheduler -n "$NAMESPACE" --timeout=120s; then
  echo ""
  echo "  WARNING: Rollout failed. Attempting automatic rollback..."
  oc rollout undo deployment/rhdp-scheduler -n "$NAMESPACE"
  oc rollout status deployment/rhdp-scheduler -n "$NAMESPACE" --timeout=120s || true
  echo "  Rollback attempted. Run './deploy.sh $ENV rollback' to retry manually."
  exit 1
fi
echo ""

# Done
ROUTE_HOST=$(oc get route rhdp-scheduler -n "$NAMESPACE" -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
echo "==========================================================="
echo "  Deployment complete!"
if [[ -n "$ROUTE_HOST" ]]; then
  echo "  URL: https://$ROUTE_HOST"
fi
echo "==========================================================="
