#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./packages/assistant/package.json').version")
npx typedoc --name "Gaunt Sloth Assistant - v${VERSION}"
rm -r ../gaunt-sloth-assistant.github.io/docs
cp -r docs-generated ../gaunt-sloth-assistant.github.io/docs
