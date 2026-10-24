#!/usr/bin/env python3
"""
png_to_glb.py — Sprint 1 MVP Blender headless pipeline

CI / docs pin: Blender 5.2.3 LTS. Scripts tolerate bpy.app.version >= (4, 2, 0).

Usage:
  blender --background --python png_to_glb.py -- <in.png> <out.glb>
  # or via pipeline.sh / BLENDER_BIN

No EEVEE / Cycles stills — geometry + materials + GLB export only.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

MIN_VERSION = (4, 2, 0)
PINNED_DOCS_VERSION = "5.2.3"  # CI / README pin (LTS)


def _require_bpy():
    try:
        import bpy  # type: ignore
    except ImportError as exc:
        print(
            "ERROR: bpy is not available. Run with Blender (docs pin "
            f"{PINNED_DOCS_VERSION} LTS, supported range >= 4.2):\n"
            "  blender --background --python png_to_glb.py -- <in.png> <out.glb>\n"
            "Or set BLENDER_BIN and use apps/blender-pipeline/pipeline.sh",
            file=sys.stderr,
        )
        raise SystemExit(2) from exc
    return bpy


def _check_version(bpy) -> None:
    ver = tuple(bpy.app.version)
    if ver < MIN_VERSION:
        print(
            f"ERROR: Need Blender >= 4.2, got {bpy.app.version_string} "
            f"(docs/CI pin {PINNED_DOCS_VERSION} LTS).",
            file=sys.stderr,
        )
        raise SystemExit(2)
    print(
        f"Blender {bpy.app.version_string} (docs pin {PINNED_DOCS_VERSION}; "
        f"supported >= 4.2)"
    )


def _argv_after_double_dash(argv: list[str]) -> list[str]:
    if "--" in argv:
        return argv[argv.index("--") + 1 :]
    return argv[1:]


def _call_op_tolerant(op, **kwargs):
    """Call bpy operator; drop unknown kwargs on TypeError (version drift)."""
    try:
        return op(**kwargs)
    except TypeError:
        # Strip kwargs one-by-one until call succeeds or empty
        keys = list(kwargs.keys())
        for i in range(len(keys)):
            trimmed = {k: kwargs[k] for k in keys[: len(keys) - i - 1]}
            # Actually try removing each key that might be bad — simpler: binary drop
            pass
        # Progressive: try without optional keys known to drift
        optional = (
            "alpha_mode",
            "use_transparency",
            "shader",
            "size_mode",
            "height",
            "align",
            "relative",
            "align_axis",
            "export_apply",
            "export_yup",
        )
        working = dict(kwargs)
        last_err: Exception | None = None
        for key in optional:
            try:
                return op(**working)
            except TypeError as err:
                last_err = err
                working.pop(key, None)
        try:
            return op(**working)
        except TypeError as err:
            raise err from last_err


def _import_mesh_plane(bpy, png_path: Path):
    """Prefer built-in import_as_mesh_planes (4.2+ / 5.x); no legacy addon enable."""
    op = getattr(bpy.ops.image, "import_as_mesh_planes", None)
    if op is None:
        print(
            f"ERROR: import_as_mesh_planes missing; Blender {bpy.app.version} "
            "unsupported (<4.2?).",
            file=sys.stderr,
        )
        raise SystemExit(3)

    before = set(bpy.data.objects)
    try:
        _call_op_tolerant(
            op,
            filepath=str(png_path),
            files=[{"name": png_path.name}],
            directory=str(png_path.parent),
            relative=False,
            size_mode="ABSOLUTE",
            height=1.0,
            align="WORLD",
            use_transparency=True,
            shader="PRINCIPLED",
        )
    except Exception as primary:
        # Manual plane + image texture fallback (still no EEVEE)
        try:
            bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0.0, 0.0, 0.0))
            obj = bpy.context.active_object
            img = bpy.data.images.load(str(png_path))
            mat = bpy.data.materials.new(name="PngPlaneMat")
            mat.use_nodes = True
            nodes = mat.node_tree.nodes
            links = mat.node_tree.links
            nodes.clear()
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = img
            bsdf = nodes.new("ShaderNodeBsdfPrincipled")
            out = nodes.new("ShaderNodeOutputMaterial")
            links.new(tex.outputs.get("Color"), bsdf.inputs.get("Base Color"))
            if "Alpha" in tex.outputs and "Alpha" in bsdf.inputs:
                links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            links.new(bsdf.outputs.get("BSDF"), out.inputs.get("Surface"))
            if obj.data.materials:
                obj.data.materials[0] = mat
            else:
                obj.data.materials.append(mat)
            print(
                f"WARN: import_as_mesh_planes failed ({primary}); "
                "used manual plane fallback.",
                file=sys.stderr,
            )
            return obj
        except Exception as fallback_err:
            print(
                f"ERROR: failed to import PNG as mesh plane: {primary}\n"
                f"Fallback also failed: {fallback_err}",
                file=sys.stderr,
            )
            raise SystemExit(3) from fallback_err

    created = list(set(bpy.data.objects) - before)
    if created:
        return created[0]
    obj = bpy.context.active_object
    if obj is None:
        print("ERROR: mesh plane import produced no object.", file=sys.stderr)
        raise SystemExit(3)
    return obj


def _clear_scene(bpy) -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.actions, bpy.data.armatures):
        for item in list(block):
            block.remove(item)


def _add_spin_action(bpy, obj, action_name: str = "spin") -> None:
    """Trivial Y-axis spin 0→90° with ≥2 keyframes. Optional ARMATURE_AUTO."""
    obj.rotation_mode = "XYZ"
    if obj.animation_data is None:
        obj.animation_data_create()

    action = bpy.data.actions.new(name=action_name)
    obj.animation_data.action = action

    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.keyframe_insert(data_path="rotation_euler", frame=1, index=1)
    obj.rotation_euler = (0.0, math.radians(90.0), 0.0)
    obj.keyframe_insert(data_path="rotation_euler", frame=40, index=1)

    try:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.armature_add(enter_editmode=False, location=obj.location)
        arm = bpy.context.active_object
        arm.name = "Armature"
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    except Exception as rig_err:
        print(
            f"WARN: optional armature/auto-weights skipped: {rig_err}",
            file=sys.stderr,
        )


def _export_glb(bpy, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gltf = getattr(bpy.ops.export_scene, "gltf", None)
    if gltf is None:
        print("ERROR: export_scene.gltf missing on this Blender build.", file=sys.stderr)
        raise SystemExit(4)

    kwargs = dict(
        filepath=str(out_path),
        export_format="GLB",
        export_animations=True,
        export_skins=True,
        export_yup=True,
        export_apply=False,
    )
    try:
        _call_op_tolerant(gltf, **kwargs)
    except Exception as exc:
        # Fallback: filepath .glb may infer binary if export_format enum differs
        try:
            gltf(
                filepath=str(out_path),
                export_animations=True,
                export_skins=True,
            )
        except Exception as exc2:
            print(f"ERROR: GLB export failed: {exc} / {exc2}", file=sys.stderr)
            raise SystemExit(4) from exc2


def main() -> None:
    bpy = _require_bpy()
    _check_version(bpy)

    caps = {
        "mesh_plane": hasattr(bpy.ops.image, "import_as_mesh_planes"),
        "gltf": hasattr(bpy.ops.export_scene, "gltf"),
    }
    if not caps["mesh_plane"] or not caps["gltf"]:
        print(f"ERROR: missing capabilities: {caps}", file=sys.stderr)
        raise SystemExit(2)

    args = _argv_after_double_dash(sys.argv)
    if len(args) < 2:
        print(
            "Usage: blender --background --python png_to_glb.py -- <in.png> <out.glb>",
            file=sys.stderr,
        )
        raise SystemExit(1)

    in_png = Path(args[0]).expanduser().resolve()
    out_glb = Path(args[1]).expanduser().resolve()

    if not in_png.is_file():
        print(f"ERROR: input PNG not found: {in_png}", file=sys.stderr)
        raise SystemExit(1)

    _clear_scene(bpy)
    plane = _import_mesh_plane(bpy, in_png)
    _add_spin_action(bpy, plane, action_name="spin")
    _export_glb(bpy, out_glb)
    print(f"OK: wrote {out_glb} (Action=spin)")


if __name__ == "__main__":
    main()
