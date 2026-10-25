# Sprint 2-C — Design prep (dense pack, pre-cut)

**Role:** Graphics_Bot_Designer  
**Status:** Local prep — awaiting Researcher C brief + Leader cut  
**Depends:** S2-B firstparty bridge merging (`ca90d31` → `dev`); S2-A live path green  
**Locks:** GLB canonical · billboard still default · `stage: mvp-billboard → rigged` · no OBJ+clips · Blender ≥4.2 / pin 5.2.3 · inbox paths unchanged

---

## Why dense C (product slices)

Leader: jam-pack, not one tiny spike. Design lanes below map to **3–5 shippable product slices** (align with Researcher’s brief when it lands).

| Slice | Product outcome | Design artifacts | Likely owners |
|-------|-----------------|------------------|---------------|
| **C1 Rig contract** | Asset schema/viewer show real armature + ≥2 clips | D1: `characterType` / `clips[]` / `rig.*` lock | Designer → Engineer → Tester |
| **C2 Pipeline v2** | PNG → mesh (plane\|extrude) → armature → Actions → GLB | D2: schematic + mode flag `billboard\|rigged` | Designer → Engineer |
| **C3 Viewer UX** | Clip picker + rig badges from metadata (not hard-coded `spin`) | Wireframe + empty/error states | Designer → Engineer |
| **C4 Inbox/register UX** | Clear slug→asset flow; fail states when bridge/Blender red | One-pager flows (firstparty+vendor) | Designer → Engineer |
| **C5 Throughput** | Batch or re-run smoke without demo fallthrough; CI still Linux-green | Sequence for `MODE=rigged` smoke | Engineer (+ Design AC notes) |

**Out of C (hold):** full Rigify humanoid / Mixamo matrix (Sprint 3+) · promoting ladder unless Leader cuts.

---

## D1 draft — Rig / clip contract (extends S1)

### Stage progression

| `stage` | Meaning | Required |
|---------|---------|----------|
| `mvp-billboard` | Mesh plane + trivial Action(s) e.g. `spin` | S1/A — keep green |
| `rigged` | Mesh + armature + weights + ≥2 named clips | **C ship** |
| `scene` | Reserved | Out |

### Zod deltas (additive)

```ts
characterType: "billboard" | "prop" | "humanoid" | "unknown"
// C ships: billboard|prop may be stage=rigged; humanoid still soft-reserved
stage: "mvp-billboard" | "rigged" | "scene"
clips: string[]  // lowercase verbs; rigged ⇒ length >= 2, include idle + walk (or idle + spin)
rig: {
  hasArmature: boolean;   // rigged ⇒ true
  hasWeights: boolean;    // rigged ⇒ true
  boneCount?: number;     // informational
  blenderVersionTested?: string;
}
formats.glb: string       // required if clips.length > 0
// formats.obj forbidden when clips.length > 0 (hard fail — existing)
```

### Clip naming (Design lock)

| Required for `rigged` | Optional |
|-----------------------|----------|
| `idle`, `walk` | `spin`, `run`, `wave` |

Playback: R3F uses clip names from GLB/actions; UI lists `clips[]` from Mongo — no hard-coded `spin` only.

### Invariants (Tester)

1. `stage=rigged` ⇒ `rig.hasArmature && rig.hasWeights && clips.length >= 2 && formats.glb`.  
2. OBJ + any clips ⇒ hard fail (unchanged).  
3. `billboard` path with `stage=mvp-billboard` still passes S1/A AC (regression).  
4. Firstparty/vendor bridge unchanged — C is Blender/viewer/schema only.

---

## D2 draft — Pipeline schematic v2

```
PNG inbox (S1/A/B paths)
    │
    ▼
png_to_glb.py  MODE=billboard|rigged  (default billboard)
    │
    ├─ billboard → Mesh Plane + Action(s) → GLB
    │
    └─ rigged → silhouette/extrude OR simple mesh
                 → Armature + Automatic Weights
                 → Actions idle + walk (+ optional)
                 → GLB (skins + clips)
    ▼
data/assets/{id}/model.glb + preview.png
    ▼
API register (stage, rig, clips)
    ▼
R3F: clip list + rig badges
```

Fail-closed: bad MODE / Blender down / missing weights when MODE=rigged → non-zero; no silent billboard substitute when MODE=rigged.

---

## C3 Viewer wireframe (sketch)

| State | UI |
|-------|-----|
| Asset selected | Canvas + clip dropdown from `clips[]` |
| Playing | Active clip name; loop toggle |
| Rigged | Badges: Armature · Weights · boneCount? |
| Billboard | Badge: Billboard / mvp |
| Error | Missing GLB / empty clips — actionable copy |

---

## Handoffs when Leader cuts

1. Researcher brief → map slices C1–C5 to final IDs.  
2. Designer locks D1+D2 (+ C3 wire) in one docs pack.  
3. Engineer parallel: `MODE=rigged` in `png_to_glb.py` + viewer clip UI.  
4. Tester: AC matrix = rigged ship + billboard regression + bridge untouched.

**No PR** until Leader cuts C and B is on `dev`.
