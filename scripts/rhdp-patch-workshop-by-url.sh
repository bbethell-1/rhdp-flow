#!/usr/bin/env bash
# Usage: pass workshop URLs (GUID is taken from end of path), e.g.:
#   ./rhdp-patch-workshop-by-url.sh \
#     "https://catalog.demo.redhat.com/workshop/rpesgx" \
#     "https://catalog.demo.redhat.com/workshop/nyzngh"
# Or pipe/redirect:
#   echo "https://catalog.demo.redhat.com/workshop/abc123" | ./rhdp-patch-workshop-by-url.sh
# Add --dry-run to list RCs that would be patched without patching.

set -e
NAMESPACE="${NAMESPACE:-user-mferrari-redhat-com}"
DRY_RUN=

urls=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    *)         urls+=("$1"); shift ;;
  esac
done

if [[ ${#urls[@]} -eq 0 ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"
    line="${line// /}"
    [[ -n "$line" ]] && urls+=("$line")
  done
fi

for url in "${urls[@]}"; do
  guid="${url%/}"
  guid="${guid##*/}"
  [[ -z "$guid" ]] && { echo "Skip (no guid): $url"; continue; }
  echo "Workshop ID: $guid (namespace: $NAMESPACE)"
  for RC in $(oc get resourceclaim -n "$NAMESPACE" -l "babylon.gpte.redhat.com/workshop-id=$guid" -o name 2>/dev/null); do
    if [[ -n "$DRY_RUN" ]]; then
      echo "  [dry-run] would patch: $RC"
    else
      oc patch -n "$NAMESPACE" --type=merge --patch='{"metadata":{"labels":{"touch":"now"}}}' "$RC"
    fi
  done
done
