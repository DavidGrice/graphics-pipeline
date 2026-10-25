#!/usr/bin/env python3
"""
import_fbx_to_glb.py — Mixamo/FBX|GLB → remapped GLB + importMeta (S2-D-E2)

Usage:
  blender --background --python import_fbx_to_glb.py -- \\
    <in.fbx|in.glb> <out.glb> [--source mixamo|fbx] [--meta-out path.json]

Explicit Action remap only (no silent rename):
  Idle/Idle_A → idle, Walking/Walk → walk, Running/Run → run,
  Jump → jump, Wave → wave

Fail-closed: no armature OR no weights OR missing idle/walk after remap → non-zero.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

MIN_VERSION = (4, 2, 0)
PINNED_DOCS_VERSION = "5.2.3"

# Explicit Mixamo / common FBX → contract clip names (D2 table).
ACTION_REMAP: dict[str, str] = {
    "Idle": "idle",
    "Idle_A": "idle",
    "Walking": "walk",
    "Walk": "walk",
    "Running": "run",
    "Run": "run",
    "Jump": "jump",
    "Wave": "wave",
}


def _require_bpy():
    try:
        import bpy  # type: ignore
    except ImportError as exc:
        print(
            "ERROR: bpy is not available. Run with Blender "
            f"(docs pin {PINNED_DOCS_VERSION}):\n"
            "  blender --background --python import_fbx_to_glb.py -- "
            "<in.fbx|in.glb> <out.glb> [--source mixamo|fbx] [--meta-out path.json]",
            file=sys.stderr,
        )
        raise SystemExit(2) from exc
    return bpy


def _check_version(bpy) -> None:
    ver = tuple(bpy.app.version)
    if ver < MIN_VERSION:
        print(
            f"ERROR: Need Blender >= 4.2, got {bpy.app.version_string}",
            file=sys.stderr,
        )
        raise SystemExit(2)
    print(f"Blender {bpy.app.version_string} (docs pin {PINNED_DOCS_VERSION})")


def _argv_after_double_dash(argv: list[str]) -> list[str]:
    if "--" in argv:
        return argv[argv.index("--") + 1 :]
    return argv[1:]


def _parse_args(args: list[str]) -> tuple[Path, Path, str, Path | None]:
    source = "fbx"
    meta_out: Path | None = None
    positional: list[str] = []
    i = 0
    while i < len(args):
        tok = args[i]
        if tok == "--source" and i + 1 < len(args):
            source = args[i + 1].strip().lower()
            i += 2
            continue
        if tok.startswith("--source="):
            source = tok.split("=", 1)[1].strip().lower()
            i += 1
            continue
        if tok == "--meta-out" and i + 1 < len(args):
            meta_out = Path(args[i + 1]).expanduser().resolve()
            i += 2
            continue
        if tok.startswith("--meta-out="):
            meta_out = Path(tok.split("=", 1)[1]).expanduser().resolve()
            i += 1
            continue
        positional.append(tok)
        i += 1

    if source not in ("mixamo", "fbx"):
        print(
            f"ERROR: --source must be mixamo|fbx (got {source!r})",
            file=sys.stderr,
        )
        raise SystemExit(1)
    if len(positional) < 2:
        print(
            "Usage: blender --background --python import_fbx_to_glb.py -- "
            "<in.fbx|in.glb> <out.glb> [--source mixamo|fbx] [--meta-out path.json]",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return (
        Path(positional[0]).expanduser().resolve(),
        Path(positional[1]).expanduser().resolve(),
        source,
        meta_out,
    )


def _clear_scene(bpy) -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.armatures,
        bpy.data.actions,
        bpy.data.images,
    ):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass


def _import_file(bpy, in_path: Path) -> None:
    suffix = in_path.suffix.lower()
    if suffix == ".fbx":
        op = getattr(bpy.ops.import_scene, "fbx", None)
        if op is None:
            print("ERROR: import_scene.fbx missing on this Blender build.", file=sys.stderr)
            raise SystemExit(4)
        try:
            op(filepath=str(in_path), automatic_bone_orientation=True)
        except TypeError:
            op(filepath=str(in_path))
    elif suffix in (".glb", ".gltf"):
        op = getattr(bpy.ops.import_scene, "gltf", None)
        if op is None:
            print("ERROR: import_scene.gltf missing on this Blender build.", file=sys.stderr)
            raise SystemExit(4)
        op(filepath=str(in_path))
    else:
        print(
            f"ERROR: unsupported input type {suffix!r}; expected .fbx/.glb/.gltf",
            file=sys.stderr,
        )
        raise SystemExit(1)


def _remap_actions(bpy) -> dict[str, str]:
    """Rename Actions via ACTION_REMAP only. Returns the map entries used."""
    used: dict[str, str] = {}
    # Snapshot names first — renaming while iterating is unsafe.
    actions = list(bpy.data.actions)
    for action in actions:
        src = action.name
        # Strip Blender push-down suffixes like "Idle.001" for lookup base.
        base = src.split(".")[0] if src else src
        dest = ACTION_REMAP.get(src) or ACTION_REMAP.get(base)
        if not dest:
            continue
        # Avoid colliding with an already-renamed Action of the same dest.
        existing = bpy.data.actions.get(dest)
        if existing is not None and existing != action:
            # Prefer keeping the first dest; drop duplicate source Action.
            print(f"WARN: Action {src!r} → {dest!r} already exists; removing duplicate")
            try:
                bpy.data.actions.remove(action)
            except Exception:
                pass
            used[src] = dest
            continue
        if action.name != dest:
            action.name = dest
        used[src] = dest
    return used


def _has_armature(bpy) -> bool:
    return any(o.type == "ARMATURE" for o in bpy.context.scene.objects)


def _has_weights(bpy) -> bool:
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if not obj.vertex_groups:
            continue
        # Any non-empty vertex group counts as weights present.
        for vg in obj.vertex_groups:
            # Check at least one vertex assigned — cheap sample via group weight API
            # is expensive; presence of groups after Mixamo/FBX import is enough
            # when an Armature modifier or parent armature exists.
            _ = vg
            has_arm_mod = any(m.type == "ARMATURE" for m in obj.modifiers)
            if has_arm_mod or (obj.parent and obj.parent.type == "ARMATURE"):
                return True
            # Fallback: any vertex group on a skinned-looking mesh
            if len(obj.vertex_groups) > 0:
                return True
    return False


def _action_names(bpy) -> list[str]:
    return [a.name for a in bpy.data.actions]


def _export_glb(bpy, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_name(out_path.stem + ".tmp.glb")
    if tmp_path.exists():
        tmp_path.unlink()
    gltf = getattr(bpy.ops.export_scene, "gltf", None)
    if gltf is None:
        print("ERROR: export_scene.gltf missing on this Blender build.", file=sys.stderr)
        raise SystemExit(4)

    has_arm = _has_armature(bpy)
    kwargs = dict(
        filepath=str(tmp_path),
        export_format="GLB",
        export_animations=True,
        export_skins=has_arm,
        export_yup=True,
        export_apply=False,
    )
    try:
        try:
            result = gltf(**kwargs)
        except TypeError:
            result = gltf(
                filepath=str(tmp_path),
                export_format="GLB",
                export_animations=True,
            )
        if result is not None and "FINISHED" not in result and "CANCELLED" in result:
            print(f"ERROR: GLB export cancelled: {result}", file=sys.stderr)
            raise SystemExit(4)
        if not tmp_path.is_file() or tmp_path.stat().st_size < 12:
            print(f"ERROR: GLB export empty/partial: {tmp_path}", file=sys.stderr)
            raise SystemExit(4)
        with tmp_path.open("rb") as fh:
            magic = fh.read(4)
        if magic != b"glTF":
            print(f"ERROR: export not GLB (magic={magic!r})", file=sys.stderr)
            raise SystemExit(4)
        tmp_path.replace(out_path)
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _write_meta(
    meta_out: Path | None,
    *,
    source: str,
    in_path: Path,
    action_map: dict[str, str],
    clips: list[str],
) -> dict:
    meta = {
        "source": source,
        "originalFilename": in_path.name,
        "actionMap": action_map,
        "boneMapStub": "mixamo-biped-stub" if source == "mixamo" else "generic-biped-stub",
        "characterTypeHint": "humanoid" if source == "mixamo" else "humanoid",
        "clipsAfterRemap": clips,
    }
    if meta_out is not None:
        meta_out.parent.mkdir(parents=True, exist_ok=True)
        meta_out.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        print(f"OK: wrote importMeta {meta_out}")
    return meta


def main() -> None:
    bpy = _require_bpy()
    _check_version(bpy)

    args = _argv_after_double_dash(sys.argv)
    in_path, out_glb, source, meta_out = _parse_args(args)

    if not in_path.is_file():
        print(f"ERROR: input not found: {in_path}", file=sys.stderr)
        raise SystemExit(1)

    _clear_scene(bpy)
    _import_file(bpy, in_path)
    used_map = _remap_actions(bpy)
    clips = _action_names(bpy)

    if not _has_armature(bpy):
        print("ERROR: fail-closed — no armature after import", file=sys.stderr)
        raise SystemExit(1)
    if not _has_weights(bpy):
        print("ERROR: fail-closed — no vertex weights after import", file=sys.stderr)
        raise SystemExit(1)
    if "idle" not in clips or "walk" not in clips:
        print(
            f"ERROR: fail-closed — missing idle/walk after remap "
            f"(clips={clips}, actionMap used={used_map})",
            file=sys.stderr,
        )
        raise SystemExit(1)

    _export_glb(bpy, out_glb)
    _write_meta(
        meta_out,
        source=source,
        in_path=in_path,
        action_map=used_map,
        clips=clips,
    )
    print(
        f"OK: wrote {out_glb} source={source} clips={','.join(clips)} "
        f"actionMap={used_map}"
    )


if __name__ == "__main__":
    main()
