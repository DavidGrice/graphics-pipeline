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
        "export_skins",
        "export_animations",
        "export_materials",
        "use_selection",
    )
    working = dict(kwargs)
    last_err: Exception | None = None
    for _ in range(len(optional) + 1):
        try:
            return op(**working)
        except TypeError as err:
            last_err = err
            dropped = False
            for key in optional:
                if key in working:
                    working.pop(key)
                    dropped = True
                    break
            if not dropped:
                raise err from last_err
    raise TypeError("operator call failed after stripping kwargs") from last_err


def _mesh_is_exportable(obj) -> bool:
    """True when mesh has faces and validate reports no remaining corruption."""
    data = getattr(obj, "data", None)
    if data is None or not hasattr(data, "polygons"):
        return False
    if len(data.polygons) < 1 or len(data.vertices) < 3:
        return False
    try:
        data.update(calc_edges=True)
    except TypeError:
        try:
            data.update()
        except Exception:
            pass
    # validate() returns True if the mesh had errors (and may repair some).
    try:
        had_errors = bool(data.validate(verbose=True, clean_customdata=True))
    except TypeError:
        try:
            had_errors = bool(data.validate(verbose=True))
        except Exception:
            had_errors = False
    if had_errors:
        # One repair pass then re-check face count.
        try:
            data.validate(verbose=False, clean_customdata=True)
        except Exception:
            pass
    if len(data.polygons) < 1 or len(data.vertices) < 3:
        return False
    # Reject NaN coordinates (common after bad armature weights).
    for v in data.vertices:
        co = v.co
        if not (math.isfinite(co.x) and math.isfinite(co.y) and math.isfinite(co.z)):
            return False
    return True


def _make_textured_plane(bpy, png_path: Path):
    """Build a known-valid plane + Principled texture (reliable on Blender 5.2)."""
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0.0, 0.0, 0.0))
    obj = bpy.context.active_object
    if obj is None:
        raise RuntimeError("primitive_plane_add produced no active object")
    obj.name = "PngPlane"
    mesh = obj.data
    mesh.name = "PngPlaneMesh"
    try:
        mesh.update(calc_edges=True)
    except TypeError:
        mesh.update()
    mesh.validate(verbose=False)

    img = bpy.data.images.load(str(png_path))
    img.name = "PngSource"
    mat = bpy.data.materials.new(name="PngPlaneMat")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if "Alpha" in tex.outputs and "Alpha" in bsdf.inputs:
        links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        try:
            mat.blend_method = "HASHED"
        except Exception:
            pass
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mesh.materials.clear()
    mesh.materials.append(mat)

    if not _mesh_is_exportable(obj):
        raise RuntimeError("manual textured plane mesh is not exportable")
    return obj


def _import_mesh_plane(bpy, png_path: Path):
    """
    Prefer a manual plane (valid mesh on 5.2). import_as_mesh_planes often yields
    'Mesh <stem> is not valid' → empty GLB from the glTF exporter.
    """
    try:
        obj = _make_textured_plane(bpy, png_path)
        print("OK: built textured plane (manual path)")
        return obj
    except Exception as manual_err:
        print(
            f"WARN: manual plane failed ({manual_err}); trying import_as_mesh_planes",
            file=sys.stderr,
        )

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
        print(f"ERROR: failed to import PNG as mesh plane: {primary}", file=sys.stderr)
        raise SystemExit(3) from primary

    created = list(set(bpy.data.objects) - before)
    obj = created[0] if created else bpy.context.active_object
    if obj is None:
        print("ERROR: mesh plane import produced no object.", file=sys.stderr)
        raise SystemExit(3)
    if not _mesh_is_exportable(obj):
        print(
            f"ERROR: imported mesh '{getattr(obj.data, 'name', '?')}' is not valid "
            "for glTF export.",
            file=sys.stderr,
        )
        raise SystemExit(3)
    return obj


def _clear_scene(bpy) -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (
        bpy.data.actions,
        bpy.data.armatures,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
    ):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass


def _assign_action(bpy, obj, action) -> None:
    """Blender 5.x uses action slots; fall back to legacy assignment."""
    if obj.animation_data is None:
        obj.animation_data_create()
    ad = obj.animation_data
    try:
        ad.action = action
        return
    except Exception:
        pass
    # 5.0+ layered/slot API
    try:
        slot = action.slots.new(id_type="OBJECT", name="Object")
        ad.action = action
        if hasattr(ad, "action_slot"):
            ad.action_slot = slot
    except Exception as err:
        print(f"WARN: could not assign action cleanly: {err}", file=sys.stderr)
        try:
            ad.action = action
        except Exception:
            pass


def _add_spin_action(bpy, obj, action_name: str = "spin") -> None:
    """Trivial Y-axis spin 0→90° with ≥2 keyframes. Soft armature (no AUTO weights)."""
    obj.rotation_mode = "XYZ"
    action = bpy.data.actions.new(name=action_name)
    _assign_action(bpy, obj, action)

    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.keyframe_insert(data_path="rotation_euler", frame=1, index=1)
    obj.rotation_euler = (0.0, math.radians(90.0), 0.0)
    obj.keyframe_insert(data_path="rotation_euler", frame=40, index=1)

    # ARMATURE_AUTO often corrupts thin planes (invalid mesh → empty GLB).
    # Parent to a single bone without auto-weights; still marks armature present.
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
        bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)
        if not _mesh_is_exportable(obj):
            print(
                "WARN: mesh invalid after armature parent; clearing parent.",
                file=sys.stderr,
            )
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
            bpy.data.objects.remove(arm, do_unlink=True)
    except Exception as rig_err:
        print(
            f"WARN: optional armature skipped: {rig_err}",
            file=sys.stderr,
        )


def _export_glb(bpy, out_path: Path) -> None:
    """Atomic write via sibling *.tmp.glb (must end in .glb for the exporter)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Important: extension must be .glb — model.glb.tmp yields empty/partial files.
    tmp_path = out_path.with_name(out_path.stem + ".tmp.glb")
    if tmp_path.exists():
        tmp_path.unlink()
    gltf = getattr(bpy.ops.export_scene, "gltf", None)
    if gltf is None:
        print("ERROR: export_scene.gltf missing on this Blender build.", file=sys.stderr)
        raise SystemExit(4)

    # Ensure every mesh object is exportable before calling the exporter.
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and not _mesh_is_exportable(obj):
            print(
                f"ERROR: mesh '{obj.data.name}' is not valid for glTF export "
                f"(verts={len(obj.data.vertices)} faces={len(obj.data.polygons)}).",
                file=sys.stderr,
            )
            raise SystemExit(4)

    has_armature = any(o.type == "ARMATURE" for o in bpy.context.scene.objects)
    kwargs = dict(
        filepath=str(tmp_path),
        export_format="GLB",
        export_animations=True,
        export_skins=has_armature,
        export_yup=True,
        export_apply=False,
    )
    try:
        try:
            result = _call_op_tolerant(gltf, **kwargs)
        except Exception as exc:
            try:
                result = gltf(
                    filepath=str(tmp_path),
                    export_format="GLB",
                    export_animations=True,
                )
            except Exception as exc2:
                print(f"ERROR: GLB export failed: {exc} / {exc2}", file=sys.stderr)
                raise SystemExit(4) from exc2
        # Operators return {'FINISHED'} / {'CANCELLED'} set
        if result is not None and "FINISHED" not in result and "CANCELLED" in result:
            print(f"ERROR: GLB export cancelled: {result}", file=sys.stderr)
            raise SystemExit(4)
        if not tmp_path.is_file() or tmp_path.stat().st_size < 12:
            print(
                f"ERROR: GLB export produced empty/partial file: {tmp_path}",
                file=sys.stderr,
            )
            raise SystemExit(4)
        # Minimal GLB magic check
        with tmp_path.open("rb") as fh:
            magic = fh.read(4)
        if magic != b"glTF":
            print(
                f"ERROR: export did not write a GLB (magic={magic!r}): {tmp_path}",
                file=sys.stderr,
            )
            raise SystemExit(4)
        tmp_path.replace(out_path)
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def main() -> None:
    bpy = _require_bpy()
    _check_version(bpy)

    caps = {
        "gltf": hasattr(bpy.ops.export_scene, "gltf"),
    }
    if not caps["gltf"]:
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
    if not _mesh_is_exportable(plane):
        print("ERROR: mesh became invalid after animation/rig steps.", file=sys.stderr)
        raise SystemExit(4)
    _export_glb(bpy, out_glb)
    print(f"OK: wrote {out_glb} (Action=spin)")


if __name__ == "__main__":
    main()
