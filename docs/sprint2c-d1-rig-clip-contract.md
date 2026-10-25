# S2-C-D1 — Rig / clip contract (naming + schema delta)

**Role:** Graphics_Bot_Designer  
**Lane:** Design (C1 naming + C2 schema)  
**Brief:** `docs/sprint2c-brief.md` · Companion: `docs/sprint2c-d2-pipeline-v2.md` · Base: `docs/sprint1-asset-contract.md`  
**Status:** Leader-cut LOCK — S2-C-D1 · **R1 bound** (`sprint2c-brief.md`)  
**Cut:** `/workspace/sprint2c-cut.md` · **Base:** `origin/dev` @ `f748e35`  
**Branch target:** fold onto `enhancement/s2c-rigged-glb` (or Engineer tip)

---

## 1. Clip / mode naming (C1 lock)

| Mode (`--mode` / `SMOKE_MODE`) | Mesh path | Required Actions | Optional |
|--------------------------------|-----------|------------------|----------|
| `billboard` (default) | Mesh plane | `spin` preferred | — |
| `rigged` | Extrude/silhouette or simple mesh + armature + Automatic Weights | **`idle`**, **`walk`** | `spin`, `run`, `wave` |

- Clip names: lowercase verbs only (`^[a-z]+$`).  
- `rigged` ⇒ `clips.length >= 2` and must include `idle` + `walk`.  
- Host/UI never hard-codes only `spin` for rigged assets.

---

## 2. Stage + rig fields (C2 lock)

| Field | `mvp-billboard` | `rigged` |
|-------|-----------------|----------|
| `stage` | `mvp-billboard` | **`rigged`** |
| `characterType` | prefer `billboard` | prefer **`prop`** (R1); `humanoid` only if honest |
| `clips` | e.g. `["spin"]` | `["idle","walk",…]` |
| `rig.hasArmature` | false (typical) | **true** |
| `rig.hasWeights` | false | **true** |
| `rig.boneCount` | omit | optional number |
| `formats.glb` | required if clips | **required** |
| `formats.obj` | static-only OK | **absent** if clips nonempty |

### Zod delta (additive — patch or `sprint2c-asset-delta`)

```ts
stage: "mvp-billboard" | "rigged" | "scene";
clips: string[]; // rigged ⇒ includes idle + walk, length >= 2
rig: {
  hasArmature: boolean;
  hasWeights: boolean;
  boneCount?: number;
  blenderVersionTested?: string;
};
```

### Invariants (Tester)

1. `stage === "rigged"` ⇒ armature + weights + ≥2 clips + `formats.glb`.  
2. Clips nonempty ⇒ no `formats.obj` (hard fail).  
3. Billboard S2-A assets still validate (`spin`, firstparty/vendor OK).  
4. `GET /api/assets/:id` returns `clips` + `rig` for badges.

---

## 3. Register / API expectation

After `png_to_glb --mode=rigged`, register probe sets `stage`, `clips` from GLB actions, `rig.*` from armature/weights — not hand-edited lies.

---

## 4. Handoffs

| To | Use |
|----|-----|
| Engineer C1/C2 | Mode flag + Zod/API fields exactly as §1–§2 |
| Designer D2 / C3 | Pipeline + viewer consume this naming |
| Tester | AC rows above + billboard regression |


## 5. Trace to cut AC

| Cut AC | This doc |
|--------|----------|
| T1.2 | §1–§2 rigged clips + armature/weights |
| T1.3 | OBJ+clips hard-fail invariant |
| T1.5 | §3 register metadata |
| T1.6 | this file |


**R1 bind (2026-10-25):** mode→stage map + `characterType` prefer `prop` for `rigged`; probe GLB for clips/rig; reject dishonest `rigged`; BRIDGE untouched.
