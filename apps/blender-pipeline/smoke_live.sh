#!/usr/bin/env bash
# S2-A Windows live smoke entrypoint: real PNG→GLB, fail-closed Blender + Krita health.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO}"

export SMOKE_LIVE=1
# Default health mode is bridge probe (red when Krita down)
unset KRITA_HEALTH_MODE || true

echo "[smoke_live] probing Krita bridge health…"
npm run build -w @graphics-pipeline/mcp-krita >/dev/null
if ! node --input-type=module -e "
  import { createKritaMcpAdapter } from './apps/mcp-krita/dist/index.js';
  const h = await createKritaMcpAdapter({ repoRoot: process.cwd() }).health();
  console.log(JSON.stringify(h, null, 2));
  if (!h.ok) process.exit(1);
"; then
  echo "ERROR: health red — Krita MCP bridge down. Start Krita + MCP Bridge." >&2
  exit 1
fi

exec "${SCRIPT_DIR}/run_mvp.sh" "$@"
