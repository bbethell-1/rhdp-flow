#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# deploy.sh — Deploy RHDP-Scheduler to OpenShift via Kustomize
#
# Usage:
#   ./deploy.sh [dev|prod]      # full deploy (default: dev)
#   ./deploy.sh [dev|prod] dry-run  # render manifests only
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV="${1:-dev}"
DRY_RUN="${2:-}"

# ── Environment config ──
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

echo "═══════════════════════════════════════════════════════════"
echo "  RHDP-Scheduler — Deploy to OpenShift ($ENV)"
echo "  Namespace: $NAMESPACE"
echo "  Overlay:   $OVERLAY"
echo "═══════════════════════════════════════════════════════════"

# ── Dry-run mode — just render and exit ──
if [[ "$DRY_RUN" == "dry-run" ]]; then
  echo ""
  echo "▸ Rendering Kustomize manifests (dry-run)..."
  oc kustomize "$OVERLAY"
  exit 0
fi

# ── Verify oc is connected ──
if ! oc whoami &>/dev/null; then
  echo "ERROR: Not logged in to OpenShift. Run 'oc login' first."
  exit 1
fi

CLUSTER=$(oc whoami --show-server)
USER=$(oc whoami)
echo ""
echo "▸ Cluster: $CLUSTER"
echo "▸ User:    $USER"
echo ""

# ── Step 1: Create namespace ──
echo "─── Step 1/7: Create namespace ───"
if oc get namespace "$NAMESPACE" &>/dev/null; then
  echo "  Namespace '$NAMESPACE' already exists."
else
  oc create namespace "$NAMESPACE"
  echo "  Created namespace '$NAMESPACE'."
fi
echo ""

# ── Step 2: Create ServiceAccount ──
echo "─── Step 2/7: Create ServiceAccount ───"
if ! oc get sa rhdp-scheduler -n "$NAMESPACE" &>/dev/null; then
  oc create sa rhdp-scheduler -n "$NAMESPACE"
  echo "  Created ServiceAccount 'rhdp-scheduler'."
else
  echo "  ServiceAccount 'rhdp-scheduler' already exists."
fi
echo ""

# ── Step 3: Create webhook secret ──
echo "─── Step 3/7: Create webhook secret ───"
if oc get secret rhdp-scheduler-webhook -n "$NAMESPACE" &>/dev/null; then
  echo "  Webhook secret already exists — reusing."
else
  WEBHOOK_SECRET=$(openssl rand -hex 20)
  oc create secret generic rhdp-scheduler-webhook \
    --from-literal=WebHookSecretKey="$WEBHOOK_SECRET" \
    -n "$NAMESPACE"
  echo "  Created webhook secret."
  echo "  Webhook URL: ${CLUSTER}/apis/build.openshift.io/v1/namespaces/${NAMESPACE}/buildconfigs/rhdp-scheduler/webhooks/${WEBHOOK_SECRET}/github"
fi
echo ""

# ── Step 4: Apply Kustomize manifests ──
echo "─── Step 4/7: Apply Kustomize manifests ───"
oc apply -k "$OVERLAY"
echo "  Manifests applied."
echo ""

# ── Step 5: Grant cluster-reader to ServiceAccount ──
echo "─── Step 5/7: Grant RBAC permissions ───"
# The SA needs to read/write workshop resources across namespaces
if ! oc get clusterrolebinding rhdp-scheduler-cluster-reader-"$ENV" &>/dev/null; then
  oc create clusterrolebinding rhdp-scheduler-cluster-reader-"$ENV" \
    --clusterrole=cluster-reader \
    --serviceaccount="$NAMESPACE:rhdp-scheduler"
  echo "  Granted cluster-reader to SA."
else
  echo "  ClusterRoleBinding already exists."
fi
echo ""

# ── Step 6: Trigger build and wait ──
echo "─── Step 6/7: Trigger build ───"
BUILD_NAME=$(oc start-build rhdp-scheduler -n "$NAMESPACE" -o name)
echo "  Started: $BUILD_NAME"
echo "  Waiting for build to complete..."
oc wait "$BUILD_NAME" --for=condition=Complete --timeout=600s -n "$NAMESPACE" || {
  echo "  ERROR: Build failed or timed out."
  oc logs "$BUILD_NAME" -n "$NAMESPACE" --tail=30
  exit 1
}
echo "  Build completed."
echo ""

# ── Step 7: Wait for rollout ──
echo "─── Step 7/7: Wait for rollout ───"
oc rollout restart deployment/rhdp-scheduler -n "$NAMESPACE"
oc rollout status deployment/rhdp-scheduler -n "$NAMESPACE" --timeout=120s
echo ""

# ── Done ──
ROUTE_HOST=$(oc get route rhdp-scheduler -n "$NAMESPACE" -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
echo "═══════════════════════════════════════════════════════════"
echo "  Deployment complete!"
if [[ -n "$ROUTE_HOST" ]]; then
  echo "  URL: https://$ROUTE_HOST"
fi
echo "═══════════════════════════════════════════════════════════"
