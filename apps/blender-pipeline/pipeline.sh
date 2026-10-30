#!/usr/bin/env bash
# Cross-platform wrapper (Git Bash / WSL / Linux / macOS).
# Windows: set BLENDER_BIN to blender.exe, or add Blender to PATH.
# MODE / SMOKE_MODE: billboard (default) | rigged — passed as --mode to png_to_glb.
# SEED (S3-C #63): integer 0..2147483647, default 0 — passed as --seed.
# Non-integer / out-of-range SEED → exit 2 (R1 HARDEN).
# MAX_GLB_MB (S3-D #76): exported GLB larger than the cap → exit 4 GLB_TOO_LARGE.
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
  exit 2
fi

# S3-D #76 — MAX_GLB_MB (default 100, integer >= 1); invalid → exit 2 (fail-closed).
MAX_GLB_MB="${MAX_GLB_MB:-100}"
if [[ ! "${MAX_GLB_MB}" =~ ^[0-9]+$ ]] || (( ${#MAX_GLB_MB} > 7 )) || (( 10#${MAX_GLB_MB} < 1 )); then
  echo "ERROR: MAX_GLB_MB must be an integer >= 1 (got: ${MAX_GLB_MB})" >&2
  exit 2
fi

mkdir -p "$(dirname "${OUT_GLB}")"

# S3-E #66 — integer wall-clock ms (GNU date %3N; second resolution where unsupported).
now_ms() {
  local t
  t="$(date +%s%3N 2>/dev/null || true)"
  if [[ "${t}" =~ ^[0-9]+$ ]]; then echo "${t}"; else echo $(( $(date +%s) * 1000 )); fi
}
EXPORT_T0="$(now_ms)"

# Blender's exit status propagates (set -e); then the export size gate.
"${BLENDER_BIN}" --background --python "${PNG_TO_GLB}" -- "${IN_PNG}" "${OUT_GLB}" --mode "${MODE}" --seed "$((10#${SEED}))"

if [[ -f "${OUT_GLB}" ]]; then
  GLB_BYTES="$(wc -c < "${OUT_GLB}" | tr -d ' ')"
  MAX_BYTES=$(( 10#${MAX_GLB_MB} * 1024 * 1024 ))
  if (( GLB_BYTES > MAX_BYTES )); then
    echo "ERROR GLB_TOO_LARGE: ${GLB_BYTES} bytes > ${MAX_BYTES} (MAX_GLB_MB=${MAX_GLB_MB})" >&2
    exit 4
  fi
  # S3-E #66 — timings.json beside the exported GLB (fixed key set; register_asset.mjs fills
  # probe/copy/register when it registers this GLB). Never part of goldens (hashes are GLB-only).
  EXPORT_MS=$(( $(now_ms) - EXPORT_T0 ))
  printf '{"stages":{"export":%d,"probe":null,"copy":null,"register":null},"totalMs":%d,"probeCache":null}\n' \
    "${EXPORT_MS}" "${EXPORT_MS}" > "$(dirname "${OUT_GLB}")/timings.json"
fi
