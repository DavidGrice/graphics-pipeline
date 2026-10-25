# Linux setup — box / local E2E (copy-paste)

**Audience:** agents on the Graphics box · CI-adjacent headless · **not** a substitute for Windows Krita-GUI quirks  
**Pin:** Blender **5.2.3** · Krita **5.2.9** (box)

---

## 1. Paths (this box)

| Tool | Path / note |
|------|-------------|
| Blender 5.2.3 | `BLENDER_BIN=/home/box/tools/blender` (symlink) **or** `/home/box/blender-5.2.3/blender` |
| Krita 5.2.9 | `/home/box/tools/krita` → `/usr/bin/krita` |
| pykrita | `/home/box/.local/share/krita/pykrita/` (`~/.local/share/krita/pykrita/`) |
| Repo | `/workspace/graphics-pipeline` (or clone path) |
| Node | 20+ via nvm/system |

Verify:

```bash
export BLENDER_BIN=/home/box/tools/blender
"$BLENDER_BIN" --version
# expect Blender 5.2.3

/home/box/tools/krita --version
# expect 5.2.x
ls /home/box/.local/share/krita/pykrita/
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
# expect Actions idle + walk + run; armature + weights
```

Env alternate: `MODE=rigged` / `SMOKE_MODE=rigged` (see `pipeline.sh` / `png_to_glb.py`).

Fail-closed:

```bash
# missing binary must fail (do not use make_demo_glb on live path)
test -x /home/box/tools/blender || echo "BLENDER_BIN missing"
```

---

## 4. Krita bridge on Linux (box)

```bash
# Vendor (default) — MCP krita-mcp / facade → 127.0.0.1:9797
export BRIDGE=vendor
export KRITA_MCP_PORT=9797

# Firstparty — graphics_fp_bridge in pykrita → :19876
export BRIDGE=firstparty
export KRITA_FP_PORT=19876
# Pack: bash apps/krita-plugin/pack.sh
# Install zip contents into /home/box/.local/share/krita/pykrita/graphics_fp_bridge/
# Enable plugin in Krita → full quit/restart → health on :19876
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
| billboard | GLB Action `spin`; skins=0; register `stage=mvp-billboard`; probed `rig.hasArmature=false` / `hasWeights=false` |
| rigged | Actions `idle` + `walk` + `run`; skins≥1; register `stage=rigged`; probed `rig.hasArmature=true` / `hasWeights=true` |
| unit tests | `npm run test:s1` (+ `test:s2b` / `test:s2c` when present) green **without** live Krita |

Register cold-readers: probe GLB for `clips` + `rig.*` — do not trust caller alone (R1).

---

## 6. What stays on Windows

Krita GUI Import Python Plugin quirks, Store-launcher traps, `smoke_live.ps1` PowerShell — see [`setup-windows.md`](setup-windows.md). Linux owns headless Blender + box Krita bridge + CI unit gates.

---

## 7. S2-D CI Blender smoke (Actions)

On PRs/pushes, job `blender-smoke` installs Blender **5.2.3** headless, sets `BLENDER_BIN`, and runs billboard + rigged rows with `S2D_CLIP_EXPECT` / `S2D_EXPECT_ARMATURE` / `S2D_EXPECT_WEIGHTS` / `S2D_STAGE_EXPECT` (see `apps/blender-pipeline/README.md`). Local equivalent:

```bash
export BLENDER_BIN=/home/box/tools/blender
node scripts/ensure-smoke-png.mjs
SMOKE_MODE=rigged S2D_CLIP_EXPECT=idle,walk,run S2D_EXPECT_ARMATURE=1 \
  S2D_EXPECT_WEIGHTS=1 S2D_STAGE_EXPECT=rigged \
  bash -c 'out=/tmp/s2d-r.glb; ./apps/blender-pipeline/pipeline.sh tests/fixtures/smoke-8x8.png "$out"; node scripts/s2d-assert-glb.mjs "$out"'
```
