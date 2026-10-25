#!/usr/bin/env bash
# Thin wrapper: Mixamo/FBX|GLB → remapped GLB + importMeta (S2-D-E2).
# Fail-closed on missing BLENDER_BIN.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMPORT_PY="${SCRIPT_DIR}/import_fbx_to_glb.py"
BLENDER_BIN="${BLENDER_BIN:-blender}"

if [[ $# -lt 2 ]]; then
  echo "Usage: BLENDER_BIN=/path/to/blender $0 <in.fbx|in.glb> <out.glb> [--source mixamo|fbx] [--meta-out path.json]" >&2
  exit 1
fi

if ! command -v "${BLENDER_BIN}" >/dev/null 2>&1 && [[ ! -x "${BLENDER_BIN}" ]]; then
  echo "ERROR: Blender binary not found: ${BLENDER_BIN}" >&2
  echo "Set BLENDER_BIN to the absolute path of the blender executable." >&2
  exit 127
fi

IN_FILE="$1"
OUT_GLB="$2"
shift 2

if [[ ! -f "${IN_FILE}" ]]; then
  echo "ERROR: input not found: ${IN_FILE}" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUT_GLB}")"
exec "${BLENDER_BIN}" --background --python "${IMPORT_PY}" -- "${IN_FILE}" "${OUT_GLB}" "$@"
