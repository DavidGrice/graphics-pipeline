#!/usr/bin/env bash
# Vertical slice: inbox PNG → GLB → register (Express must be up for POST).
# SMOKE_LIVE=1 → real Blender only (BLENDER_BIN fail-closed; never demo GLB).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SLUG="${1:-hero-billboard}"
API="${API:-http://127.0.0.1:8787}"
SMOKE_LIVE="${SMOKE_LIVE:-0}"
BLENDER_BIN="${BLENDER_BIN:-blender}"

# Find newest inbox PNG for slug, or create demo via smoke
INBOX_DIR="${REPO}/data/inbox/${SLUG}"
mkdir -p "${INBOX_DIR}"
PNG="$(ls -1t "${INBOX_DIR}"/*.png 2>/dev/null | head -1 || true)"
if [[ -z "${PNG}" ]]; then
  if [[ "${SMOKE_LIVE}" == "1" ]]; then
    echo "ERROR: SMOKE_LIVE=1 requires a real inbox PNG under ${INBOX_DIR}" >&2
    echo "Export from Krita MCP first (no --demo-png)." >&2
    exit 1
  fi
  echo "No inbox PNG for ${SLUG}; writing demo PNG via mcp-krita smoke…"
  (cd "${REPO}" && npm run smoke:demo -w @graphics-pipeline/mcp-krita -- --slug="${SLUG}" >/dev/null)
  PNG="$(ls -1t "${INBOX_DIR}"/*.png | head -1)"
fi

ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
OUT_DIR="${REPO}/data/assets/${ID}"
mkdir -p "${OUT_DIR}"
OUT_GLB="${OUT_DIR}/model.glb"
cp -f "${PNG}" "${OUT_DIR}/preview.png"

blender_ok=0
if command -v "${BLENDER_BIN}" >/dev/null 2>&1 || [[ -x "${BLENDER_BIN}" ]]; then
  blender_ok=1
fi

if [[ "${SMOKE_LIVE}" == "1" ]]; then
  if [[ "${blender_ok}" -ne 1 ]]; then
    echo "ERROR: SMOKE_LIVE=1 — Blender binary not found: ${BLENDER_BIN}" >&2
    echo "Install Blender 5.2.3 LTS and set BLENDER_BIN (fail-closed; no demo GLB)." >&2
    echo "Windows example: set BLENDER_BIN=C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" >&2
    exit 127
  fi
  "${SCRIPT_DIR}/pipeline.sh" "${PNG}" "${OUT_GLB}"
elif [[ "${blender_ok}" -eq 1 ]]; then
  "${SCRIPT_DIR}/pipeline.sh" "${PNG}" "${OUT_GLB}"
else
  echo "WARN: Blender not found — using make_demo_glb.mjs (DEMO ONLY)" >&2
  node "${SCRIPT_DIR}/make_demo_glb.mjs" "${OUT_GLB}"
fi

node "${SCRIPT_DIR}/register_asset.mjs" \
  --id="${ID}" \
  --slug="${SLUG}" \
  --glb="${OUT_GLB}" \
  --preview="${OUT_DIR}/preview.png" \
  --source="${PNG}" \
  --api="${API}" \
  --armature \
  --weights

echo "MVP asset id=${ID} slug=${SLUG}"
