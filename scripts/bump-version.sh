#!/usr/bin/env bash
# bump-version.sh - Increment semantic version across all source files.
# Usage: ./scripts/bump-version.sh [major|minor|patch]
# Reads VERSION, increments the requested component, writes to:
#   VERSION, frontend/package.json, api/server.py
# Prints the new version to stdout.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BUMP_TYPE="${1:-patch}"

# Validate argument
case "$BUMP_TYPE" in
  major|minor|patch) ;;
  *) echo "Usage: $0 [major|minor|patch]" >&2; exit 1 ;;
esac

# Read current version
VERSION_FILE="$PROJECT_DIR/VERSION"
if [[ ! -f "$VERSION_FILE" ]]; then
  echo "Error: VERSION file not found at $VERSION_FILE" >&2
  exit 1
fi

CURRENT="$(tr -d '[:space:]' < "$VERSION_FILE")"

# Parse semver components
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# Validate parsed values are integers
if ! [[ "$MAJOR" =~ ^[0-9]+$ && "$MINOR" =~ ^[0-9]+$ && "$PATCH" =~ ^[0-9]+$ ]]; then
  echo "Error: VERSION file contains invalid semver: $CURRENT" >&2
  exit 1
fi

# Increment
case "$BUMP_TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

# Write VERSION file
echo "$NEW_VERSION" > "$VERSION_FILE"

# Update frontend/package.json
PACKAGE_JSON="$PROJECT_DIR/frontend/package.json"
if [[ -f "$PACKAGE_JSON" ]]; then
  sed -i.bak "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"
  rm -f "$PACKAGE_JSON.bak"
fi

# Update api/server.py
SERVER_PY="$PROJECT_DIR/api/server.py"
if [[ -f "$SERVER_PY" ]]; then
  sed -i.bak "s/version=\"$CURRENT\"/version=\"$NEW_VERSION\"/" "$SERVER_PY"
  rm -f "$SERVER_PY.bak"
fi

echo "$NEW_VERSION"
