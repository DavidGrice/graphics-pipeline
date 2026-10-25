#!/usr/bin/env bash
# Build graphics_fp_bridge.zip for Krita Import Python Plugin.
# Must include explicit graphics_fp_bridge/ dir entry + forward-slash paths
# (Krita plugin_importer looks for namelist dir entries ending in name/).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/graphics_fp_bridge.zip"
python3 - <<PY
import zipfile
from pathlib import Path
from zipfile import ZipInfo, ZIP_DEFLATED
root = Path("$ROOT")
out = root / "graphics_fp_bridge.zip"
if out.exists():
    out.unlink()
with zipfile.ZipFile(out, "w", compression=ZIP_DEFLATED) as zf:
    info = ZipInfo("graphics_fp_bridge/")
    info.external_attr = 0o40755 << 16
    zf.writestr(info, b"")
    zf.write(root / "graphics_fp_bridge" / "__init__.py", "graphics_fp_bridge/__init__.py")
    zf.write(root / "graphics_fp_bridge.desktop", "graphics_fp_bridge.desktop")
print("Wrote", out)
print("Entries:", ", ".join(zipfile.ZipFile(out).namelist()))
PY
