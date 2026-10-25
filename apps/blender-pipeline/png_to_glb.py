#!/usr/bin/env python3
"""
png_to_glb.py — PNG → GLB headless pipeline (S2-C/S2-D: --mode billboard|rigged; rigged clips idle+walk+run)

CI / docs pin: Blender 5.2.3 LTS. Scripts tolerate bpy.app.version >= (4, 2, 0).

Usage:
  blender --background --python png_to_glb.py -- <in.png> <out.glb> [--mode billboard|rigged]
  # MODE / SMOKE_MODE env also accepted (default: billboard)
  # or via pipeline.sh / BLENDER_BIN

No EEVEE / Cycles stills — geometry + materials + GLB export only.
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path

MIN_VERSION = (4, 2, 0)
PINNED_DOCS_VERSION = "5.2.3"  # CI / README pin (LTS)
VALID_MODES = ("billboard", "rigged")


def _require_bpy():
    try:
        import bpy  # type: ignore
    except ImportError as exc:
        print(
            "ERROR: bpy is not available. Run with Blender (docs pin "
            f"{PINNED_DOCS_VERSION} LTS, supported range >= 4.2):\n"
            "  blender --background --python png_to_glb.py -- "
            "<in.png> <out.glb> [--mode billboard|rigged]\n"
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


def _parse_mode_and_paths(args: list[str]) -> tuple[str, Path, Path]:
    """Parse --mode / MODE / SMOKE_MODE and positional in.png out.glb."""
    mode = (
        os.environ.get("SMOKE_MODE")
        or os.environ.get("MODE")
        or "billboard"
    ).strip().lower()
    positional: list[str] = []
    i = 0
    while i < len(args):
        tok = args[i]
        if tok == "--mode" and i + 1 < len(args):
            mode = args[i + 1].strip().lower()
            i += 2
            continue
        if tok.startswith("--mode="):
            mode = tok.split("=", 1)[1].strip().lower()
            i += 1
            continue
        positional.append(tok)
        i += 1

    if mode not in VALID_MODES:
        print(
            f"ERROR: invalid mode {mode!r}; expected billboard|rigged",
            file=sys.stderr,
        )
        raise SystemExit(1)
    if len(positional) < 2:
        print(
            "Usage: blender --background --python png_to_glb.py -- "
            "<in.png> <out.glb> [--mode billboard|rigged]",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return mode, Path(positional[0]).expanduser().resolve(), Path(
        positional[1]
    ).expanduser().resolve()


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
    try:
        had_errors = bool(data.validate(verbose=True, clean_customdata=True))
    except TypeError:
        try:
            had_errors = bool(data.validate(verbose=True))
        except Exception:
            had_errors = False
    if had_errors:
        try:
            data.validate(verbose=False, clean_customdata=True)
        except Exception:
            pass
    if len(data.polygons) < 1 or len(data.vertices) < 3:
        return False
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
    """Billboard: Y-axis spin 0→90° with ≥2 keyframes. No armature (contract)."""
    obj.rotation_mode = "XYZ"
    action = bpy.data.actions.new(name=action_name)
    _assign_action(bpy, obj, action)

    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.keyframe_insert(data_path="rotation_euler", frame=1, index=1)
    obj.rotation_euler = (0.0, math.radians(90.0), 0.0)
    obj.keyframe_insert(data_path="rotation_euler", frame=40, index=1)


def _ensure_pose_mode(bpy, arm) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    if bpy.context.mode != "POSE":
        bpy.ops.object.mode_set(mode="POSE")


def _object_mode(bpy) -> None:
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def _build_rigged_armature(bpy, mesh_obj):
    """
    Mesh + armature + real vertex weights (no Rigify/Mixamo).
    Manual weights avoid ARMATURE_AUTO plane corruption on Blender 5.2.
    """
    _object_mode(bpy)
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    loc = tuple(mesh_obj.location)

    bpy.ops.object.armature_add(enter_editmode=True, location=loc)
    arm = bpy.context.active_object
    arm.name = "Armature"
    arm_data = arm.data
    arm_data.name = "ArmatureData"

    # Two bones: root + tip (named for vertex groups)
    edit_bones = arm_data.edit_bones
    root = edit_bones[0]
    root.name = "root"
    root.head = (0.0, 0.0, 0.0)
    root.tail = (0.0, 0.0, 0.6)
    tip = edit_bones.new("tip")
    tip.head = root.tail
    tip.tail = (0.0, 0.0, 1.2)
    tip.parent = root
    tip.use_connect = True

    bpy.ops.object.mode_set(mode="OBJECT")

    # Parent with empty groups matching bone names, then paint weights manually.
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    try:
        bpy.ops.object.parent_set(type="ARMATURE_NAME", keep_transform=True)
    except TypeError:
        bpy.ops.object.parent_set(type="ARMATURE_NAME")

    # Ensure vertex groups exist and assign weights.
    mesh = mesh_obj.data
    vg_root = mesh_obj.vertex_groups.get("root") or mesh_obj.vertex_groups.new(name="root")
    vg_tip = mesh_obj.vertex_groups.get("tip") or mesh_obj.vertex_groups.new(name="tip")

    # Split by local Z: lower half → root, upper → tip (plane in XY → use Y).
    for v in mesh.vertices:
        # Plane is XY; use Y as "height" for billboard-like split.
        if v.co.y >= 0.0:
            vg_tip.add([v.index], 1.0, "REPLACE")
            vg_root.add([v.index], 0.0, "REPLACE")
        else:
            vg_root.add([v.index], 1.0, "REPLACE")
            vg_tip.add([v.index], 0.0, "REPLACE")

    # Armature modifier if parent_set did not add one.
    has_arm_mod = any(m.type == "ARMATURE" for m in mesh_obj.modifiers)
    if not has_arm_mod:
        mod = mesh_obj.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = arm

    if not _mesh_is_exportable(mesh_obj):
        raise RuntimeError("mesh invalid after rig/weights")

    if not mesh_obj.vertex_groups:
        raise RuntimeError("rigged mode requires vertex groups (weights)")

    print(
        f"OK: armature={arm.name} bones=root,tip "
        f"vgroups={len(mesh_obj.vertex_groups)}"
    )
    return arm


def _keyframe_bone(pbone, frame: int, *, loc=None, rot=None) -> None:
    if loc is not None:
        pbone.location = loc
        pbone.keyframe_insert(data_path="location", frame=frame)
    if rot is not None:
        pbone.rotation_mode = "XYZ"
        pbone.rotation_euler = rot
        pbone.keyframe_insert(data_path="rotation_euler", frame=frame)


def _clear_pose(pb_root, pb_tip) -> None:
    for pb in (pb_root, pb_tip):
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_euler = (0.0, 0.0, 0.0)


def _add_rigged_clip_actions(bpy, arm) -> None:
    """Actions named exactly idle, walk, and run on the armature (S2-D)."""
    _ensure_pose_mode(bpy, arm)
    pb_root = arm.pose.bones.get("root")
    pb_tip = arm.pose.bones.get("tip")
    if pb_root is None or pb_tip is None:
        raise RuntimeError("expected pose bones root and tip")

    # --- idle: gentle tip sway ---
    idle = bpy.data.actions.new(name="idle")
    _assign_action(bpy, arm, idle)
    _keyframe_bone(pb_tip, 1, rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_root, 1, rot=(0.0, 0.0, 0.0), loc=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_tip, 20, rot=(0.0, math.radians(8.0), 0.0))
    _keyframe_bone(pb_tip, 40, rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_root, 40, rot=(0.0, 0.0, 0.0), loc=(0.0, 0.0, 0.0))

    _clear_pose(pb_root, pb_tip)

    # --- walk: root bob + tip lean ---
    walk = bpy.data.actions.new(name="walk")
    _assign_action(bpy, arm, walk)
    _keyframe_bone(pb_root, 1, loc=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_tip, 1, rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_root, 10, loc=(0.0, 0.0, 0.08), rot=(0.0, 0.0, math.radians(6.0)))
    _keyframe_bone(pb_tip, 10, rot=(math.radians(12.0), 0.0, 0.0))
    _keyframe_bone(pb_root, 20, loc=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_tip, 20, rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_root, 30, loc=(0.0, 0.0, 0.08), rot=(0.0, 0.0, math.radians(-6.0)))
    _keyframe_bone(pb_tip, 30, rot=(math.radians(-12.0), 0.0, 0.0))
    _keyframe_bone(pb_root, 40, loc=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_tip, 40, rot=(0.0, 0.0, 0.0))

    _clear_pose(pb_root, pb_tip)

    # --- run: faster cycle, bigger root bob + tip lean (distinct from walk) ---
    run = bpy.data.actions.new(name="run")
    _assign_action(bpy, arm, run)
    _keyframe_bone(pb_root, 1, loc=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_tip, 1, rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_root, 6, loc=(0.0, 0.0, 0.16), rot=(0.0, 0.0, math.radians(12.0)))
    _keyframe_bone(pb_tip, 6, rot=(math.radians(22.0), 0.0, math.radians(4.0)))
    _keyframe_bone(pb_root, 12, loc=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_tip, 12, rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_root, 18, loc=(0.0, 0.0, 0.16), rot=(0.0, 0.0, math.radians(-12.0)))
    _keyframe_bone(pb_tip, 18, rot=(math.radians(-22.0), 0.0, math.radians(-4.0)))
    _keyframe_bone(pb_root, 24, loc=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0))
    _keyframe_bone(pb_tip, 24, rot=(0.0, 0.0, 0.0))

    # Leave run as active (all three Actions exist in bpy.data.actions for export).
    _object_mode(bpy)
    print("OK: Actions idle + walk + run on armature")


def _export_glb(bpy, out_path: Path) -> None:
    """Atomic write via sibling *.tmp.glb (must end in .glb for the exporter)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_name(out_path.stem + ".tmp.glb")
    if tmp_path.exists():
        tmp_path.unlink()
    gltf = getattr(bpy.ops.export_scene, "gltf", None)
    if gltf is None:
        print("ERROR: export_scene.gltf missing on this Blender build.", file=sys.stderr)
        raise SystemExit(4)

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
        if result is not None and "FINISHED" not in result and "CANCELLED" in result:
            print(f"ERROR: GLB export cancelled: {result}", file=sys.stderr)
            raise SystemExit(4)
        if not tmp_path.is_file() or tmp_path.stat().st_size < 12:
            print(
                f"ERROR: GLB export produced empty/partial file: {tmp_path}",
                file=sys.stderr,
            )
            raise SystemExit(4)
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
    mode, in_png, out_glb = _parse_mode_and_paths(args)

    if not in_png.is_file():
        print(f"ERROR: input PNG not found: {in_png}", file=sys.stderr)
        raise SystemExit(1)

    print(f"mode={mode}")
    _clear_scene(bpy)
    plane = _import_mesh_plane(bpy, in_png)

    if mode == "billboard":
        _add_spin_action(bpy, plane, action_name="spin")
        action_note = "Action=spin"
    else:
        arm = _build_rigged_armature(bpy, plane)
        _add_rigged_clip_actions(bpy, arm)
        action_note = "Actions=idle,walk,run armature=yes weights=yes"

    if not _mesh_is_exportable(plane):
        print("ERROR: mesh became invalid after animation/rig steps.", file=sys.stderr)
        raise SystemExit(4)
    _export_glb(bpy, out_glb)
    print(f"OK: wrote {out_glb} mode={mode} ({action_note})")


if __name__ == "__main__":
    main()
