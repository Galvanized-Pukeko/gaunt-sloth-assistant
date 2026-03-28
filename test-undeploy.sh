#!/bin/bash
# Uninstalls the test-deployed @gaunt-sloth/review from global node_modules
# and removes the staging directory.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/gaunt-sloth-review-test-deploy"

echo "==> Uninstalling @gaunt-sloth/review globally..."
npm uninstall -g @gaunt-sloth/review || true

echo "==> Uninstalling @gaunt-sloth/core globally..."
npm uninstall -g @gaunt-sloth/core || true

echo "==> Removing staging directory $DEPLOY_DIR..."
rm -rf "$DEPLOY_DIR"

echo ""
echo "Done. Verify with:"
echo "  which gaunt-sloth-review  # should be 'not found'"
echo "  npm ls -g --depth=0"
