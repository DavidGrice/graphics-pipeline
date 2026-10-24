#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Run the FP bridge HTTP server without Krita (spike / CI mock)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from graphics_fp_bridge import start_server  # noqa: E402

if __name__ == "__main__":
    start_server()
    print("Graphics FP Bridge mock listening (KRITA_FP_PORT / default 19876)", flush=True)
    try:
        import time

        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
