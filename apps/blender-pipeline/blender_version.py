#!/usr/bin/env python3
"""Print Blender version (run inside Blender). Docs pin: 5.2.3 LTS."""

from __future__ import annotations

import sys

PINNED = "5.2.3"
MIN = (4, 2, 0)


def main() -> None:
    try:
        import bpy  # type: ignore
    except ImportError:
        print(
            "ERROR: bpy missing. Run:\n"
            "  blender --background --python blender_version.py\n"
            f"Docs/CI pin: Blender {PINNED} LTS (supported >= 4.2).",
            file=sys.stderr,
        )
        raise SystemExit(2)

    ver = tuple(bpy.app.version)
    print(bpy.app.version_string)
    print(f"bpy.app.version={ver}")
    print(f"docs_pin={PINNED}")
    print(f"supported_min={MIN}")
    if ver < MIN:
        print(f"WARN: below supported minimum {MIN}", file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
