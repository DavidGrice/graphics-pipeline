# Windows setup — live smoke (copy-paste)

**OS:** Windows 10/11 · **Pin:** Blender **5.2.3** · **Repo tip:** work from `dev` / active topic branch

---

## 1. Install

| Tool | Exact expectation |
|------|-------------------|
| Node 20+ | `node -v` |
| Git (+ Git Bash optional) | for `run_mvp.sh` fallback |
| Blender 5.2.3 | Official installer — `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` |
| Krita | GUI + Python plugins enabled |
| Mongo | optional |

**Do not** use Microsoft Store `blender-launcher.exe`.

---

## 2. Env (PowerShell, repo root)

```powershell
cd <repo-root>
npm ci
npm run build:schema
npm run build -w @graphics-pipeline/mcp-krita

$env:BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
& $env:BLENDER_BIN --version
# expect: Blender 5.2.x
```

### Bridge

```powershell
# Default vendor (krita-mcp on 9797)
$env:BRIDGE = "vendor"
# Firstparty after Import Python Plugin:
# $env:BRIDGE = "firstparty"
# $env:KRITA_FP_PORT = "19876"
# optional: $env:KRITA_FP_TOKEN = "..."
```

---

## 3. Firstparty plugin (S2-B)

```powershell
.\apps\krita-plugin\pack.ps1
# → apps\krita-plugin\graphics_fp_bridge.zip
# fallback: .\apps\krita-plugin\unpack-b64.ps1
```

1. Open **Krita** → **Import Python Plugin** → select `graphics_fp_bridge.zip`.  
2. Enable **Graphics FP Bridge** in Python Plugin Manager; restart if needed.  
3. Set `BRIDGE=firstparty` as above.  
4. Expect: `GET http://127.0.0.1:19876/health` → `{ "ok": true, ... }`.

Expand-Archive → `%APPDATA%\krita\pykrita\` is **fallback only**.

---

## 4. World API + smoke

```powershell
# terminal A
npm run dev -w @graphics-pipeline/world-builder
# http://127.0.0.1:8787/api/health → ok

# terminal B — S2-A live (billboard)
$env:SMOKE_LIVE = "1"
.\apps\blender-pipeline\smoke_live.ps1 s2a-smoke
```

### S2-C rigged (headless after inbox PNG exists)

```powershell
& $env:BLENDER_BIN --background --python apps/blender-pipeline/png_to_glb.py -- `
  data\inbox\s2c-rigged\in.png data\assets\tmp\model.glb --mode rigged
# expect Actions: idle + walk + run; armature + weights
```

Or: `$env:SMOKE_MODE = "rigged"` if scripts accept it (see Engineer tip README).

---

## 5. Expected outputs

| Step | Pass signal |
|------|-------------|
| `health` (vendor) | ok / HTTP on `:9797` (401 = up) |
| `health` (firstparty) | ok on `:19876` |
| `export_png` | file under `data\inbox\{slug}\*.png` |
| billboard GLB | Action `spin` |
| rigged GLB | Actions `idle` + `walk` + `run`; skins/weights true |
| register | asset id + `clips` + `rig` on API |

---

## 6. Fail-closed checks

```powershell
# bad blender
$env:BLENDER_BIN = "C:\nope\blender.exe"
.\apps\blender-pipeline\smoke_live.ps1 s2a-smoke
# expect exit 127 / non-zero; no demo GLB
```

Quit Krita → facade `health` must be **red**.
