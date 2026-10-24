# Sprint 2-A — Windows live-smoke schematic

**Role:** Graphics_Bot_Designer  
**Owner story:** S2-A-D1  
**Locks:** A→B→C · hold B/C until A DoD · pin Blender **5.2.3** · GLB + `spin` · no media in git  
**Companions:** `docs/sprint2-cut-draft.md` · `docs/sprint2a-windows-smoke-checklist.md` · Tester S2-A AC  
**Status:** Live Windows smoke **PASS** (asset `0d0ef649-…` / `s2a-smoke`). Bug #26 on `dev` @ `7002fb1`. Docs PR → `dev`.

---

## 1. Goal (one path)

```
Krita GUI (Windows) + MCP Bridge
    │  facade tools: health · export_png
    ▼
data/inbox/s2a-smoke/{YYYYMMDD-HHMMSS}.png
    │  smoke_live.ps1 → SMOKE_LIVE=1
    │  BLENDER_BIN = full path to blender.exe (not Store launcher)
    ▼
data/assets/{id}/model.glb   (+ preview.png)   # atomic .tmp → rename
    │  Action name: spin
    ▼
MERN API (:8787) + R3F viewer plays `spin` (not the demo GLB)
```

**DoD:** Tester signs live T1 on Windows. CI stays green on Linux **without** Krita/Blender.

---

## 2. Windows install map (one-pager)

| Piece | Expected location / note |
|-------|--------------------------|
| Repo | `DavidGrice/graphics-pipeline` on **`dev`** (post-merge tip) |
| Krita | GUI + MCP Bridge up; pykrita under `%APPDATA%\krita\pykrita\` |
| Blender **5.2.3** | Official installer: `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` — **not** Microsoft Store `blender-launcher.exe` |
| Git Bash | Preferred for `run_mvp.sh` path from `smoke_live.ps1` |
| Node | LTS; `npm ci` at repo root |
| World API | `npm run dev:world` → `/api/health` on **:8787** before register step |

**Env (PowerShell before smoke):**

```powershell
$env:BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"  # full path — bare name fails Test-Path
.\apps\blender-pipeline\smoke_live.ps1 s2a-smoke
```

Fail-closed: unset / bad / Store-launcher `BLENDER_BIN` → exit **127** (or non-zero) + clear error; **no** `make_demo_glb.mjs` fallthrough. `SMOKE_LIVE=1` makes Krita health red when bridge down.

---

## 3. Folder contract (runtime only)

```
data/
  inbox/s2a-smoke/{ts}.png     ← export_png / smoke inbox
  assets/{id}/
    model.glb                  ← real png_to_glb (Action spin); atomic write
    preview.png
```

- Never commit under `data/**`.
- Default slug: **`s2a-smoke`**.

---

## 4. Sequence (happy path)

| Step | Actor | Expect |
|------|-------|--------|
| 1 | `smoke_live.ps1` | sets `SMOKE_LIVE=1`; resolves full `BLENDER_BIN` |
| 2 | facade `health` | **ok** only if Krita MCP bridge reachable |
| 3 | inbox | real PNG under `data/inbox/s2a-smoke/` |
| 4 | `png_to_glb.py` via Blender | Mesh plane + Action `spin` → `model.glb` (atomic) |
| 5 | API :8787 | asset registered: `clips: ["spin"]`, `formats.glb` set |
| 6 | R3F viewer | plays **that** asset’s `spin` (not demo) |

---

## 5. Fail-closed matrix

| Fault | Required behavior |
|-------|-------------------|
| Krita / MCP bridge down | `health` **red**; smoke exits non-zero |
| `BLENDER_BIN` unset / bad path | exit **127**; stderr names the var; **no** demo GLB |
| Store `blender-launcher.exe` | rejected (exit 127) — require official `blender.exe` |
| Missing inbox PNG | pipeline non-zero; no partial success GLB |
| World API down | register step fails/skips clearly; not a silent pass |
| CI (Linux, no Krita) | `test:s1` / `test:s2a` green; live smoke **not** on Actions |

---

## 6. In / out of A

| In | Out (B/C) |
|----|-----------|
| Live Windows PNG→GLB→viewer | First-party Krita bridge (B) |
| Health red when Krita down | Rigify / real armature (C) |
| `BLENDER_BIN` + `SMOKE_LIVE` fail-closed | Promote `dev`→`test`→`main` until Leader cuts |

---

## 7. Docs PR plan (post-merge)

| Item | Path |
|------|------|
| This schematic | `docs/sprint2a-smoke-schematic.md` |
| Researcher checklist | `docs/sprint2a-windows-smoke-checklist.md` |

**Branch:** `docs/s2a-windows-smoke` → **`dev`**. One PR: this schematic + Researcher checklist.
