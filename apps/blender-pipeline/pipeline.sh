#!/usr/bin/env bash
# Cross-platform wrapper (Git Bash / WSL / Linux / macOS).
# Windows: set BLENDER_BIN to blender.exe, or add Blender to PATH.
# MODE / SMOKE_MODE: billboard (default) | rigged — passed as --mode to png_to_glb.
# SEED (S3-C #63): integer 0..2147483647, default 0 — passed as --seed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PNG_TO_GLB="${SCRIPT_DIR}/png_to_glb.py"
# Docs/CI pin: Blender 5.2.3 LTS (scripts tolerate >= 4.2)
BLENDER_BIN="${BLENDER_BIN:-blender}"
MODE="${SMOKE_MODE:-${MODE:-billboard}}"
SEED="${SEED:-0}"

if [[ $# -lt 2 ]]; then
  echo "Usage: BLENDER_BIN=/path/to/blender [MODE=billboard|rigged] $0 <in.png> <out.glb>" >&2
  exit 1
fi

IN_PNG="$1"
OUT_GLB="$2"

if ! command -v "${BLENDER_BIN}" >/dev/null 2>&1 && [[ ! -x "${BLENDER_BIN}" ]]; then
  echo "ERROR: Blender binary not found: ${BLENDER_BIN}" >&2
  echo "Install Blender 5.2.3 LTS (recommended) or any >= 4.2." >&2
  echo "Set BLENDER_BIN to the absolute path of the blender executable." >&2
  echo "Windows example: set BLENDER_BIN=C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" >&2
  exit 127
fi

if [[ ! -f "${IN_PNG}" ]]; then
  echo "ERROR: input not found: ${IN_PNG}" >&2
  exit 1
fi

case "${MODE}" in
  billboard|rigged) ;;
  *)
    echo "ERROR: MODE must be billboard|rigged (got: ${MODE})" >&2
    exit 1
    ;;
esac

if [[ ! "${SEED}" =~ ^[0-9]+$ ]] || (( ${#SEED} > 10 )) || (( 10#${SEED} > 2147483647 )); then
  echo "ERROR: SEED must be an integer 0..2147483647 (got: ${SEED})" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUT_GLB}")"

exec "${BLENDER_BIN}" --background --python "${PNG_TO_GLB}" -- "${IN_PNG}" "${OUT_GLB}" --mode "${MODE}" --seed "$((10#${SEED}))"
