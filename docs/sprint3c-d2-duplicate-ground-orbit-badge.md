# S3-C-D2 — Duplicate node + ground/shadows + orbit bookmarks + CharacterType badge wire

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E3/E4 · Tester T1.5/T1.6/T1.7  
**Brief:** `/workspace/sprint3c-brief.md` (rebind when R1 lands) · Companion: `docs/sprint3c-d1-clip-blend-speed-hotkeys-overlay.md`  
**Status:** Cut-draft — **R1 pending rebind**  
**Cut:** `/workspace/sprint3c-cut.md` · **Base:** `9f1d809` · **Pack:** `enhancement/s3c-growth-t3`

---

## 1. Scene author delta

```
┌─ Scene author ────────────────────────────────────────┐
│ n1 selected  [Duplicate]  [Delete]                    │
│ View: [✓] Ground  [✓] Shadows                         │
│ Cameras: [Front ▾] [+ Save view] [Rename] [Delete]    │
│                                       ● unsaved  [Save]│
└──────────────────────────────────────────────────────┘
```

---

## 2. Duplicate node (#26)

| Rule | Proposed contract |
|------|-------------------|
| Source | selected node only |
| New id | fresh client UUID; never reuse source id |
| Copies | `assetId`, `transform`, `defaultClip`, `visible` |
| Offset | `position + [0.5, 0, 0]` (snapped to grid step if snap on, #30) |
| Selection | new node becomes selected |
| Persist | draft only → dirty until Save **2xx** (S3-A #23) |
| Gates | Save re-runs V4–V8 + V4a; hidden source duplicates as hidden |

---

## 3. Ground plane + shadows (#31)

| Rule | Proposed contract |
|------|-------------------|
| Fields | `scene.view?: { ground?: boolean; shadows?: boolean }` default `true` / `false` |
| Ground | plane at y=0, size ≥ scene bounds; does not count in stats (#83) |
| Shadows | renderer `shadowMap` + directional light `castShadow`; meshes cast/receive when on |
| Persist | Save with scene (author) · session toggle in non-scene viewer |
| Perf | shadows default off |

---

## 4. Orbit bookmarks (#32)

```ts
scene.cameras?: Array<{
  id: string;
  name: string;            // non-empty, unique per scene
  position: [n, n, n];
  target: [n, n, n];
  fov?: number;            // degrees, 10–120
}>;
```

| Rule | Detail |
|------|--------|
| Save view | capture current OrbitControls position + target |
| Select | animate or jump to view (no persist side-effect) |
| Limit | ≤ 16 per scene; over limit → **400** |
| Invalid | NaN / empty or duplicate name / fov out of range → **400** |
| Persist | with scene Save (dirty → 2xx) |
| Non-scene assets | out of scope this cut |

---

## 5. CharacterType badge in register list (#21)

| characterType | Badge |
|---------------|-------|
| `humanoid` | **Humanoid** (accent) |
| `prop` | **Prop** (neutral) |
| `unknown` / missing | **Unknown** (muted) |
| stage=`scene` | **Scene** (replaces characterType badge) |

- Value from **stored** asset (post-gate) — never from `importMeta.characterTypeHint`.  
- Badge filterable via existing search `characterType=` (#71).  
- Text label always present (not color-only).

---

## 6. Gates / tooling notes for E1/E4 (docs only)

| ID | Proposed contract |
|----|-------------------|
| #19 | GLB with **> 1 armature / skin root** → register **reject** (named error); billboard 0 armature OK |
| #63 | `png_to_glb --seed=<int>` → deterministic Actions; same seed + inputs + Blender version → same sha256 |
| #62r | goldens = real sha256 per mode under `testdata/golden/`; PLACEHOLDER string → **fail**; tamper → fail; sidecar records Blender version + seed |
| openapi | `/api/openapi.json` returns **JSON** `application/json`; YAML (if served) at `/api/openapi.yaml` `application/yaml`; source `docs/openapi.yaml` |

---

## 7. Handoffs / AC

| To | Use |
|----|-----|
| E3 | #26 · #31 · #32 |
| E4 | #19 · #21 · openapi |
| E1 | #62r · #63 (§6) |
| Tester T1.2/T1.3/T1.5/T1.6 | goldens · openapi · dup/ground/orbit · armature/badge/seed |

| Cut AC | This doc |
|--------|----------|
| T1.2/T1.3 | §6 |
| T1.5 | §2–§4 |
| T1.6 | §5–§6 |
| T1.7 | this file on **pack** |

**Locks:** room-only · Tester opens PR · no media in git · `BLENDER_BIN` fail-closed.
