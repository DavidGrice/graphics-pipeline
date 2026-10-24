# Sprint 2-A — Windows live smoke checklist (Researcher)

**Audience:** User (Windows), Engineer, Tester, Designer  
**Repo tip:** work from **`dev`** @ `7002fb1`+ · live T1 **PASS** (Tester AC on `b7ebcb1` / #26)  
**Goal:** Real path (not demo GLB): **Krita GUI → `export_png` → `BLENDER_BIN` → GLB (`spin`) → R3F plays clip**.  
**CI:** stays green on Ubuntu **without** Krita/Blender (`npm run test:s1`).

Related: `docs/sprint2a-smoke-schematic.md` (**§2 install map — aligned**) · `docs/sprint2-cut-draft.md` §A · `docs/AGENT_GUIDE.md` · `docs/sprint1-asset-contract.md`.

---

## 0. Preconditions (install)

| # | Check | Notes |
|---|--------|------|
| 0.1 | Repo on **`dev`** | Clone `DavidGrice/graphics-pipeline` |
| 0.2 | Node LTS + npm | `npm ci` at root + workspaces |
| 0.3 | **Krita** GUI | Running; pykrita / krita-mcp under `%APPDATA%\krita\pykrita\` (vendor wrap); restart Krita after install |
| 0.4 | **Blender 5.2.3** | Typical: `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` |
| 0.5 | Mongo (local/docker) | API `/api/health` **ok** before smoke (schematic §2) |
| 0.6 | Bootstrap green | `npm run build:schema` → build mcp-krita → `typecheck` → `npm run test:s1` |

---

## 1. Env & paths (PowerShell)

```powershell
cd <repo-root>
$env:BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
# Confirm
& $env:BLENDER_BIN --version
```

| Path / var | Expect (schematic §2–§3) |
|------------|--------|
| `BLENDER_BIN` | Real `blender.exe`; unset/bad → **non-zero** + stderr names the var; **no** fallthrough to `make_demo_glb.mjs` on the live path |
| Inbox | `data/inbox/{slug}/{YYYYMMDD-HHMMSS}.png` — example slug `s2a-smoke` |
| Asset | `data/assets/{id}/model.glb` (+ `preview.png`); Action **`spin`** |
| Never | Commit under `data/**` or ship `.env` |

---

## 2. Fail-closed probes (before happy path)

| ID | Step | Pass |
|----|------|------|
| F1 | Krita **quit** → call facade **`health`** | **Fails** with clear “Krita down / unreachable” (not `ok: true`) |
| F2 | Unset or bogus `BLENDER_BIN` → live smoke / `png_to_glb.py` | **Non-zero**; stderr names `BLENDER_BIN`; **no** demo GLB substitute |
| F3 | Restore Krita + valid `BLENDER_BIN` | F1/F2 no longer apply; proceed to §3 |

---

## 3. Happy path — live PNG → GLB → viewer

| ID | Step | Pass |
|----|------|------|
| H1 | Start **Krita GUI** with a simple paint / document | GUI up |
| H2 | Start MCP host using `apps/mcp-krita` facade (`host-config.example.json` as template) | Host connects; tools list includes **`health`**, **`export_png`** |
| H3 | Call **`health`** | `{ ok: true, … }` (or documented success shape) |
| H4 | Call **`export_png`** (or Engineer’s scripted smoke) | PNG at `data/inbox/{slug}/{ts}.png` (slug e.g. `s2a-smoke`) |
| H5 | Run Blender pipeline | `& $env:BLENDER_BIN --background --python apps/blender-pipeline/png_to_glb.py -- <inbox.png> <out.glb>` (or `run_mvp.sh` / Engineer Windows equivalent) |
| H6 | Inspect `data/assets/{id}/model.glb` | Mesh + Action **`spin`**; not OBJ-for-anim; not demo GLB |
| H7 | Register / serve asset | Metadata matches `docs/sprint1-asset-contract.md`; file on disk under `data/assets/` |
| H8 | World-builder client (R3F) | Loads **this** GLB (not checked-in demo); clip plays |

---

## 4. DoD (Tester S2-A-T1)

- [x] **Live** Windows path signed off (real PNG→GLB, not demo asset alone)  
- [ ] `health` **red** when Krita down  
- [ ] `BLENDER_BIN` **fail-closed** when missing/wrong  
- [ ] GLB has playable Action; R3F plays clip  
- [ ] `npm run test:s1` still green; **no** media committed under `data/**`  
- [ ] CI on `dev` remains green **without** Windows/Krita/Blender on the runner  

**Out of A:** Rigify / custom bridge rewrite / multi-clip matrix (B/C).

---

## 5. Live Windows command (post-#25 + bug/s2a-win-smoke-exitcodes)

```powershell
# Full path required — bare "blender.exe" fails Test-Path; avoid Store blender-launcher.exe
$env:BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
# Krita GUI + MCP Bridge up; real PNG already in data\inbox\s2a-smoke\
# world API up: npm run dev:world → :8787
.\apps\blender-pipeline\smoke_live.ps1 s2a-smoke
```

**Pass signals:** `data/assets/{id}/model.glb` with Action `spin`; asset registered (e.g. `s2a-smoke`); script exit 0.  
**Known traps (fixed on #26):** `smoke_live.ps1` ParserError; Windows spawn `status: null` vs 127 (Git Bash helper); Store `blender-launcher.exe` rejected. API down → skips until `dev:world`.

---

## 6. Handoffs


| Role | Deliverable |
|------|-------------|
| Researcher (this doc) | Preconditions, env, fail-closed + happy path order |
| Designer | One-pager schematic: install paths → folders → arrows (S2-A-D1) |
| Engineer | Windows README/`BLENDER_BIN` polish; health red + Blender fail-closed wiring; smoke scripts — **branch OK, PR after T1 green** |
| Tester | Live AC against this checklist + Designer schematic |

When T1 passes, Leader may open PR → **`dev` only**, then later promote `dev`→`test`→`main`.
