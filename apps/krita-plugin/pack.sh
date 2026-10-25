#!/usr/bin/env bash
# Build graphics_fp_bridge.zip for Windows pykrita install.
# Unzip into %APPDATA%\krita\pykrita\ → graphics_fp_bridge/ + graphics_fp_bridge.desktop
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/graphics_fp_bridge.zip"
python3 - <<PY
import zipfile
from pathlib import Path
root = Path("$ROOT")
out = root / "graphics_fp_bridge.zip"
if out.exists():
    out.unlink()
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    zf.write(root / "graphics_fp_bridge" / "__init__.py", "graphics_fp_bridge/__init__.py")
    zf.write(root / "graphics_fp_bridge.desktop", "graphics_fp_bridge.desktop")
print("Wrote", out)
print("Entries:", ", ".join(zipfile.ZipFile(out).namelist()))
PY
