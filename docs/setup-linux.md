# Linux setup — box / local E2E (copy-paste)

**Audience:** agents on the Graphics box · CI-adjacent headless · **not** a substitute for Windows Krita-GUI quirks  
**Pin:** Blender **5.2.3**

---

## 1. Paths (this box)

| Tool | Path / note |
|------|-------------|
| Blender 5.2.3 | `BLENDER_BIN=/home/box/tools/blender` (symlink) **or** `/home/box/blender-5.2.3/blender` |
| Repo | `/workspace/graphics-pipeline` (or clone path) |
| Krita | Leader installing — document exact binary + `~/.local/share/krita/pykrita/` once live |
| Node | 20+ via nvm/system |

Verify Blender:

```bash
export BLENDER_BIN=/home/box/tools/blender
"$BLENDER_BIN" --version
# expect Blender 5.2.3
```

---

## 2. Bootstrap

```bash
cd /workspace/graphics-pipeline   # or your clone
git fetch origin && git checkout enhancement/s2c-rigged-pipeline   # or tip SHA under test
npm ci
npm run build:schema
npm run build -w @graphics-pipeline/mcp-krita
npm run test:s1    # expect green without Krita/Blender
```

---

## 3. Headless PNG → GLB (no Krita)

Use any PNG (fixture or prior inbox):

```bash
export BLENDER_BIN=/home/box/tools/blender
mkdir -p /tmp/s2c-smoke data/inbox/s2c-rigged
# drop or copy a PNG:
# cp /path/to/sample.png data/inbox/s2c-rigged/sample.png

"$BLENDER_BIN" --background --python apps/blender-pipeline/png_to_glb.py -- \
  data/inbox/s2c-rigged/sample.png /tmp/s2c-smoke/billboard.glb --mode billboard
# expect Action spin; no armature

"$BLENDER_BIN" --background --python apps/blender-pipeline/png_to_glb.py -- \
  data/inbox/s2c-rigged/sample.png /tmp/s2c-smoke/rigged.glb --mode rigged
# expect Actions idle + walk; armature + weights
```

Env alternate: `MODE=rigged` / `SMOKE_MODE=rigged` (see `png_to_glb.py` header).

Fail-closed:

```bash
BLENDER_BIN=/nonexistent/blender \
  "$BLENDER_BIN" --background --python apps/blender-pipeline/png_to_glb.py -- \
  in.png out.glb --mode billboard
# must non-zero; or scripts that resolve BLENDER_BIN exit 127
```

---

## 4. Krita bridge on Linux (when GUI/plugin ready)

```bash
export BRIDGE=vendor          # probe 127.0.0.1:9797
# or
export BRIDGE=firstparty
export KRITA_FP_PORT=19876
# pack zip: bash apps/krita-plugin/pack.sh
# Install plugin into ~/.local/share/krita/pykrita/ (or Krita Import if available)
```

Then: facade `health` → `export_png` → inbox → §3 Blender modes → register on `:8787`.

```bash
npm run dev -w @graphics-pipeline/world-builder
# curl -s http://127.0.0.1:8787/api/health
```

---

## 5. Expected outputs

| Mode | Pass |
|------|------|
| billboard | GLB plays/`spin`; `hasArmature` false |
| rigged | `idle` + `walk`; skins/weights true |
| unit tests | `npm run test:s1` (+ `test:s2b` / `test:s2c` when present) green **without** live Krita |

---

## 6. What stays on Windows

Krita GUI Import Python Plugin quirks, Store-launcher traps, `smoke_live.ps1` PowerShell — see [`setup-windows.md`](setup-windows.md). Linux owns headless Blender + CI unit gates.
