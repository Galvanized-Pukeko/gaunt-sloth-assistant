#!/usr/bin/env bash
# Publish the synced @gaunt-sloth/* packages in topological order.
#
# Defaults to the local Verdaccio at http://localhost:4873.
# To publish to npmjs:  REGISTRY=https://registry.npmjs.org ./publish-all.sh
#
# Versions must already be in sync — run `npm run release:bump` first.

set -euo pipefail

REGISTRY="${REGISTRY:-http://localhost:4873}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Topological order: tools → core (depends on tools? no, but bundled together) → api → review.
# core is published first since api/review/tools all depend on it.
ORDER=(core tools api review)

echo "Publishing @gaunt-sloth/* to ${REGISTRY}"
for pkg in "${ORDER[@]}"; do
  version="$(node -p "require('${ROOT}/packages/${pkg}/package.json').version")"
  echo "==> @gaunt-sloth/${pkg}@${version}"
  (cd "${ROOT}/packages/${pkg}" && npm publish --registry "${REGISTRY}")
done
echo "Done."
