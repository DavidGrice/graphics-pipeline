# blender-pipeline

Headless PNG → GLB (mesh plane + Action `spin`). **No EEVEE.**

| Item | Value |
|------|-------|
| Docs / CI pin | **Blender 5.2.3 LTS** |
| Supported range | **≥ 4.2** (`bpy.app.version`) |
| Binary | `BLENDER_BIN` env, else `blender` on PATH |

```bash
export BLENDER_BIN=/path/to/blender   # optional
./pipeline.sh /path/in.png /path/out.glb

# equivalent — args AFTER --
"${BLENDER_BIN:-blender}" --background --python png_to_glb.py -- in.png out.glb
```

Version check:

```bash
"${BLENDER_BIN:-blender}" --background --python blender_version.py
```

OBJ is **not** an animated output path (GLB only for clips/skins).

## Orchestration

```bash
./run_mvp.sh hero-billboard
# → inbox PNG (or smoke demo) → pipeline.sh | make_demo_glb.mjs → register_asset.mjs
```

`make_demo_glb.mjs` is **DEMO ONLY** when Blender is absent. CI should pin Blender **5.2.3 LTS** and run `png_to_glb.py`.
