#!/usr/bin/env bash
# Vertical slice: inbox PNG → GLB → register (Express must be up for POST).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SLUG="${1:-hero-billboard}"
API="${API:-http://127.0.0.1:8787}"
BLENDER_BIN="${BLENDER_BIN:-blender}"

# Find newest inbox PNG for slug, or create demo via smoke
INBOX_DIR="${REPO}/data/inbox/${SLUG}"
mkdir -p "${INBOX_DIR}"
PNG="$(ls -1t "${INBOX_DIR}"/*.png 2>/dev/null | head -1 || true)"
if [[ -z "${PNG}" ]]; then
  echo "No inbox PNG for ${SLUG}; writing demo PNG via mcp-krita smoke…"
  (cd "${REPO}" && npm run smoke:demo -w @graphics-pipeline/mcp-krita -- --slug="${SLUG}" >/dev/null)
  PNG="$(ls -1t "${INBOX_DIR}"/*.png | head -1)"
fi

ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
OUT_DIR="${REPO}/data/assets/${ID}"
mkdir -p "${OUT_DIR}"
OUT_GLB="${OUT_DIR}/model.glb"
cp -f "${PNG}" "${OUT_DIR}/preview.png"

if command -v "${BLENDER_BIN}" >/dev/null 2>&1 || [[ -x "${BLENDER_BIN}" ]]; then
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
