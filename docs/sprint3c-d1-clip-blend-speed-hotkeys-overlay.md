# S3-C-D1 — Clip blend + timescale + hotkeys + wireframe/bone overlay wire

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E2 · Tester T1.4/T1.7  
**Brief:** `/workspace/sprint3c-brief.md` (rebind when R1 lands) · Companion: `docs/sprint3c-d2-duplicate-ground-orbit-badge.md`  
**Status:** Cut-draft — **R1 pending rebind**  
**Cut:** `/workspace/sprint3c-cut.md` · **Base:** `9f1d809` · **Pack:** `enhancement/s3c-growth-t3`

---

## 1. Viewer clip bar (delta on S2/S3 clipUx)

```
┌─ Clip bar ──────────────────────────────────────────────┐
│ [1 idle] [2 walk] [3 run] [4 jump] [5 wave] …  (≤ 9)    │
│ Blend: [0.25 s ▾]   Speed: [0.5× ─●──── 2×] 1.0×        │
│ Overlay: [ ] Wireframe  [ ] Bones                        │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Clip blend crossfade (#1)

| Rule | Proposed contract |
|------|-------------------|
| Mechanism | three.js `AnimationAction.crossFadeTo` / `fadeIn`+`fadeOut` between current and next clip |
| Duration | `blendMs` default **250**; allowed range **0–1000** ms; 0 = hard cut |
| Targets | only probed `clips[]` — no invented clips |
| Same clip | re-select = no-op (no fade restart) |
| Persist | `clipUx.blendMs?: number` via existing clip-ux PATCH; invalid / NaN / out of range → **400** |
| Scene nodes | per-node `defaultClip` unaffected; blend is viewer playback only |

---

## 3. Timescale (#2)

| Rule | Proposed contract |
|------|-------------------|
| Range | **0.5×–2.0×**, step 0.1, default **1.0** |
| Applies to | mixer `timeScale` of the active asset only |
| Persist | `clipUx.timeScale?: number` via clip-ux PATCH; out of range → **400** |
| Honesty | does **not** change `clipDurations` (probe SoT stays raw ms) |
| Display | UI may show effective length = `duration_ms / timeScale` labelled as effective |

Round-trip (T1.4): set blend + speed → PATCH 2xx → reload → same values in UI.

---

## 4. Hotkeys 1..9 (#80)

| Rule | Detail |
|------|--------|
| Map | key `n` → n-th clip in displayed clip order (clipUx order if set, else probe order) |
| > 9 clips | clips 10+ have no hotkey (click only) |
| Fewer clips | unmapped digits = no-op, no error |
| Focus | ignore while focus in input / textarea / select / contenteditable |
| Badge | show digit on each clip button |
| Blend | hotkey switch uses same crossfade as click (#1) |
| Scope | viewer only; not global to app shell |

---

## 5. Wireframe / bone overlay (#82)

| Toggle | Behavior |
|--------|----------|
| Wireframe | set `material.wireframe` on visible meshes; restore originals on off (no material leak) |
| Bones | `SkeletonHelper` on armature; hidden for billboard / no armature (toggle disabled with tooltip) |
| Persist | **session-only** (debug aid) — no schema field |
| Scenes | applies to all visible nodes; hidden nodes (#33) stay hidden |
| Stats | does not change tris/bones counts (#83) |

---

## 6. Handoffs / AC

| To | Use |
|----|-----|
| E2 | #1 · #2 · #80 · #82 |
| Tester T1.4 | blend+timescale round-trip · hotkeys 1..9 · wireframe/bones |

| Cut AC | This doc |
|--------|----------|
| T1.4 | §2–§5 |
| T1.7 | this file on **pack** |

**Locks:** room-only · Tester opens PR · no `*-docs` branch · probe wins.
