# Sprint 1 Acceptance Criteria — S1-T1–T3

**Role:** Graphics_Bot_Tester  
**Against:** `/workspace/sprint1-asset-contract.md` (+ blueprints / Researcher follow-ups)  
**Date:** 2026-10-24 (aligned to locked contract)  
**Locks:** MERN + R3F · all-OS (Windows smoke, Linux CI) · krita-mcp behind facade · GLB canonical for anim · Blender CI pin **5.2.3 LTS**, scripts ≥4.2 via bpy adapter

---

## Contract invariants (must hold)

1. If `clips.length > 0` → `formats.glb` required; `formats.obj` absent or ignored for playback.  
2. If only `formats.obj` → `clips` must be `[]`; `rig.hasArmature` / `hasWeights` false.  
3. Sprint 1 `characterType: "billboard"` → mesh-plane provenance + prefer ≥1 trivial clip (`spin`).  
4. Facade tools only: `health`, `export_png` — tests never assert vendor krita-mcp tool ids.  
5. No EEVEE dependency in headless MVP.

---

## S1-T1 — Stage AC (happy path)

### T1.1 Facade ↔ Krita → PNG
- Given Krita GUI + plugin bridge up
- When host calls facade `health` then `export_png`
- Then:
  - `health` → ok / krita running
  - `export_png` → `{ path, slug, ts }` and file at `data/inbox/{slug}/{YYYYMMDD-HHMMSS}.png`
  - PNG readable; RGBA preferred for billboard
  - Call site is `apps/mcp-krita/facade/` only

**Pass:** health OK + PNG on contract path  
**Fail:** vendor tool ids leaked, wrong path, silent success with no file

### T1.2 Blender headless PNG → GLB
- Given valid inbox PNG
- When `blender --background --python apps/blender-pipeline/png_to_glb.py -- <in.png> <out.glb>`
- Then:
  - Exit 0; `data/assets/{id}/model.glb` parseable glTF 2.0
  - ≥1 mesh (plane); ≥1 Action in `clips` (e.g. `spin`, ≥2 keyframes)
  - CI uses Blender **5.2.3**; script does not require EEVEE
  - Optional `rig.hasArmature` / `hasWeights` reflect export; `blenderVersionTested` set when known

**Pass:** GLB + clip names match metadata  
**Fail:** non-zero exit, zero animations, EEVEE-only path

### T1.3 Express + R3F
- Given `POST /api/assets` with contract document + files on disk
- Then:
  - Schema fields present (`stage`, `formats`, `rig`, `clips`)
  - `GET /api/assets/:id/file` streams GLB when `clips.length > 0`
  - R3F loads via `useGLTF`; clip list = `gltf.animations`; Play via `AnimationMixer`, no console errors

**Pass:** list → select → play  
**Fail:** path/metadata mismatch, 404 on file, crash on Play

---

## S1-T2 — Format gates

| Case | Expected |
|------|----------|
| Animated asset | `formats.glb` required; playback from GLB only |
| `clips.length > 0` + `formats.obj` | **Hard fail** reject at API/pipeline |
| Static OBJ only | `clips: []`, armature/weights false; not Sprint 1 viewer happy path |
| Corrupt GLB bytes | Error surfaced; no crash loop |
| FBX | Out of Sprint 1 (deferred) |

---

## S1-T3 — Errors / resilience

| ID | Condition | Expected |
|----|-----------|----------|
| T3.1 | Krita GUI down | `health` fails loud; no hang past host timeout; no stdout protocol corruption |
| T3.2 | No document open | `export_png` actionable error |
| T3.3 | Export timeout | ≥60s budget; clean failure |
| T3.4 | Missing inbox PNG | `png_to_glb` non-zero + stderr; no success on partial GLB |
| T3.5 | Blender missing | Clear not-found; CI documents 5.2.3 pin |
| T3.6 | Mongo down | 5xx / connection error — not empty success |
| T3.7 | GLB missing on disk | `GET .../file` → 404; viewer error state |
| T3.8 | Facade swap | T1–T3 assertions use facade fakes only — swap krita-mcp → first-party without rewriting tests |
| T3.9 | Windows path smoke | Path helpers; plugin dir note `%APPDATA%\krita\pykrita\` in setup docs checked |

---

## Definition of Done (Sprint 1 QA)

1. T1.1–T1.3 pass on clean clone with documented setup.  
2. T2 format gates automated.  
3. T3.1 + T3.4 automated; other T3 manual OK if checklisted.  
4. Results → `/workspace/sprint1-qa-results.md` when Eng hands off.

**Status:** AC locked to asset contract. **Blocked on** Engineer S1-E2–E4 for execution.
