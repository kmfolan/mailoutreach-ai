#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${NODE_BIN:-node}"

cd "$PROJECT_ROOT"
exec "$NODE_BIN" "$PROJECT_ROOT/server/src/index.js"
