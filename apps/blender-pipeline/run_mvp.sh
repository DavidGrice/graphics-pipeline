#!/usr/bin/env bash
# Vertical slice: inbox PNG → GLB → register (Express must be up for POST).
# SMOKE_LIVE=1 → real Blender only (BLENDER_BIN fail-closed; never demo GLB).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# S3-C #63: --seed <int> / --seed=<int> (or SEED env, default 0) → pipeline.sh
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed) SEED="${2:-}"; shift 2 || { echo "ERROR: --seed requires a value" >&2; exit 2; } ;;
    --seed=*) SEED="${1#--seed=}"; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"
export SEED="${SEED:-0}"
SLUG="${1:-s2a-smoke}"
API="${API:-http://127.0.0.1:8787}"
SMOKE_LIVE="${SMOKE_LIVE:-0}"
BLENDER_BIN="${BLENDER_BIN:-blender}"

# S3-D #141 — slug must match the schema regex before it builds any path (bad → exit 2).
if [[ ! "${SLUG}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "ERROR PATH_OUTSIDE_INBOX: slug must match ^[a-z0-9]+(-[a-z0-9]+)*\$" >&2
  exit 2
fi

# Find newest inbox PNG for slug, or create demo via smoke
INBOX_ROOT="${REPO}/data/inbox"
INBOX_DIR="${INBOX_ROOT}/${SLUG}"
mkdir -p "${INBOX_DIR}"
# newest *.png by mtime, without parsing ls (SC2012); empty when there is none
newest_png() {
  local f best=""
  for f in "$1"/*.png; do
    [[ -e "${f}" ]] || continue
    if [[ -z "${best}" || "${f}" -nt "${best}" ]]; then best="${f}"; fi
  done
  printf '%s' "${best}"
}
PNG="$(newest_png "${INBOX_DIR}")"
# realpath containment: a symlinked slug dir or PNG escaping data/inbox → exit 2
inbox_guard() {
  local root real
  root="$(realpath "${INBOX_ROOT}")"
  real="$(realpath "$1")"
  if [[ "${real}" != "${root}/"* ]]; then
    echo "ERROR PATH_OUTSIDE_INBOX: inbox entry resolves outside data/inbox" >&2
    exit 2
  fi
}
inbox_guard "${INBOX_DIR}"
if [[ -n "${PNG}" ]]; then inbox_guard "${PNG}"; fi
if [[ -z "${PNG}" ]]; then
  if [[ "${SMOKE_LIVE}" == "1" ]]; then
    echo "ERROR: SMOKE_LIVE=1 requires a real inbox PNG under ${INBOX_DIR}" >&2
    echo "Export from Krita MCP first (no --demo-png)." >&2
    exit 1
  fi
  echo "No inbox PNG for ${SLUG}; writing demo PNG via mcp-krita smoke…"
  (cd "${REPO}" && npm run smoke:demo -w @graphics-pipeline/mcp-krita -- --slug="${SLUG}" >/dev/null)
  PNG="$(newest_png "${INBOX_DIR}")"
  if [[ -z "${PNG}" ]]; then
    echo "ERROR: smoke:demo wrote no PNG under the inbox" >&2
    exit 1
  fi
  inbox_guard "${PNG}"
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
    printf '%s\n' "Windows example: set BLENDER_BIN=C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" >&2
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
