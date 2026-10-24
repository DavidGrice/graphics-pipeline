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


## S2-A Windows live smoke

Fail-closed path (no `make_demo_glb` substitute):

```powershell
$env:BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
$env:SMOKE_LIVE = "1"
# Krita GUI + MCP Bridge running; real PNG already in data/inbox/s2a-smoke/ (or export first)
.\apps\blender-pipeline\smoke_live.ps1 s2a-smoke
```

Git Bash / WSL: `SMOKE_LIVE=1 ./apps/blender-pipeline/smoke_live.sh s2a-smoke`

Health is **red** if the Krita MCP bridge (`127.0.0.1:9797`) is down. CI stays on the non-live / demo path without Windows.
