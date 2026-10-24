#!/usr/bin/env bash
# Cross-platform wrapper (Git Bash / WSL / Linux / macOS).
# Windows: set BLENDER_BIN to blender.exe, or add Blender to PATH.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PNG_TO_GLB="${SCRIPT_DIR}/png_to_glb.py"
# Docs/CI pin: Blender 5.2.3 LTS (scripts tolerate >= 4.2)
BLENDER_BIN="${BLENDER_BIN:-blender}"

if [[ $# -lt 2 ]]; then
  echo "Usage: BLENDER_BIN=/path/to/blender $0 <in.png> <out.glb>" >&2
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

mkdir -p "$(dirname "${OUT_GLB}")"

exec "${BLENDER_BIN}" --background --python "${PNG_TO_GLB}" -- "${IN_PNG}" "${OUT_GLB}"
