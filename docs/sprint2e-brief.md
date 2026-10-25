# S2-E-R1 — Contract brief (scene stub · importMeta UI · Mixamo polish · soft-env)

**Cut:** Leader `/workspace/sprint2e-cut.md` · 2026-10-25  
**Base:** `origin/dev` @ `26eaac1` (PR #33 S2-D CLOSED)  
**Pack branch:** `enhancement/s2e-scene-importmeta` → `dev`  
**Consumers:** Designer D1/D2 · Engineer E1–E4 · Tester T1.1–T1.7  
**Locks:** `BRIDGE=vendor|firstparty` unchanged · GLB for clips · OBJ static-only · probe fills `clips`/`rig`/`stage` · no media in git · no demo fallback · Graphics room only  
**Additive on:** S2-C-R1 + S2-D-R1 (`idle`/`walk`/`run`, allowlist, humanoid gates, `importMeta`)

---

## 1. `stage:scene` — asset graph stub

### Purpose
Minimal multi-asset **scene record** (not a world editor). Lets register store a graph of child asset refs for later composition.

### Schema (additive)

```ts
stage: "mvp-billboard" | "rigged" | "scene";

// When stage === "scene":
scene?: {
  version: 1;                    // bump only on breaking graph changes
  nodes: SceneNode[];            // ≥1 required
  rootId?: string;               // default = nodes[0].id
};

type SceneNode = {
  id: string;                    // unique within scene
  assetId: string;               // existing registered asset id OR slug resolve
  transform?: {
    position?: [number, number, number];
    rotation?: [number, number, number]; // euler radians
    scale?: [number, number, number];
  };
  defaultClip?: string;          // must ∈ child’s probed clips if child has clips
};
```

### Validation (fail-closed)

| Rule | Reject when |
|------|-------------|
| V1 | `stage=scene` and (`scene` missing OR `nodes.length < 1`) |
| V2 | Duplicate `nodes[].id` |
| V3 | `rootId` set but not in `nodes[].id` |
| V4 | Child `assetId` unknown / unresolved at register time |
| V5 | Child asset is itself `stage=scene` (no nested scenes in S2-E) |
| V6 | `defaultClip` not in child `clips[]` (when child has clips) |
| V7 | Claiming `stage=scene` with single-asset `formats.glb` as if it were a mesh scene **without** `scene.nodes` |

### Honesty vs other stages

- Billboard / rigged rules **unchanged**.  
- A scene does **not** inherit `rig.*` from children at the scene root — root `rig` should be `{hasArmature:false,hasWeights:false}` unless later cut defines aggregate (out of scope).  
- Scene `clips[]` at root: prefer `[]` (playback is per-node).

### Engineer bind (E3)

Register accepts valid scene JSON; dishonest/incomplete → non-zero / schema error. Viewer may list nodes (read-only) — full editor = out of scope.

---

## 2. `importMeta` UI fields (viewer + register)

### Display contract (E1 + D1)

When `importMeta` **present**, surface at least:

| Field | UI label | Notes |
|-------|----------|-------|
| `source` | Source | `mixamo` \| `fbx` \| `png_pipeline` \| `unknown` |
| `originalFilename` | Original file | omit row if absent |
| `actionMap` | Action map | show as `src → dest` rows; empty map = hide section |
| `boneMapStub` | Bone map | monospace stub id |
| `characterTypeHint` | Type hint | badge secondary; **not** a substitute for `characterType` |
| `humanoidPngApproved` | PNG humanoid approved | show only if `true` |

When `importMeta` **absent**: no panel crash; no empty “undefined” rows — panel hidden or “No import metadata”.

### Rules

- UI is **read-only** in S2-E (no edit/`actionMap` authoring in viewer).  
- Probed `clips`/`rig`/`stage` remain SoT; UI must not invent `importMeta`.  
- Dishonest `characterType` still rejected by S2-D schema (unchanged).

---

## 3. Mixamo alias table — delta (E2 + D2)

### S2-D baseline (keep)

| Source Action | Contract |
|---------------|----------|
| `Idle` / `Idle_A` | `idle` |
| `Walking` / `Walk` | `walk` |
| `Running` / `Run` | `run` |

### S2-E expansion (minimum +1 path)

Add **at least one** of:

**A) Extra aliases (required ∪ allowlist dest):**

| Source (examples) | Dest |
|-------------------|------|
| `Jogging` / `Jog` | `run` |
| `Walk_Forward` / `walk_fwd` | `walk` |
| `Idle_Neutral` | `idle` |
| `Jump` / `Jumping` | `jump` |
| `Wave` / `Waving` | `wave` |
| `Tpose` / `T-Pose` / `bind` | **strip** (not in allowlist — do not map to idle) |

**B) Second synth/fixture path:** second Mixamo-*named* input under `/tmp` (not git) remapped via `import_fbx.sh` — proves alias table beyond Idle/Walk/Run trio.

Done-when: LIMITS.md updated with new aliases **or** 2nd fixture recipe; T1.3 sees evidence. No licensed Mixamo media in repo.

### Remap rules (unchanged honesty)

- `actionMap` values ∈ required ∪ allowlist ∪ `{spin}`.  
- Fail-closed if remapped result missing `idle`/`walk`.  
- `run` required for `stage=rigged` (S2-D); map Jogging→run OK.

---

## 4. Soft-env / `:8787` demo-seed rules (E4)

### Problem
Live API `:8787` without seeded demo asset made some S2-C tests soft-fail / flake when API up but empty.

### Contract

| Condition | Required behavior |
|-----------|-------------------|
| API down / unreachable | Tests that need API **skip** (or mark pending) with clear reason — **not** fail |
| API up, no demo seed | Prefer **auto-seed** fixture asset **or** skip demos that require seed — **not** intermittent fail |
| `SMOKE_LIVE` / explicit live | Fail-closed on missing Blender/Krita as today |
| Unit/schema (`test:s1` core) | Green **without** `:8787` and without Blender |

Document in README or `docs/setup-*.md`: how to seed locally (`register_asset` / seed script) and which tests skip vs require API.

---

## 5. Engineer / Designer bind summary

| Slice | Bind |
|-------|------|
| E1 | Viewer/register show `importMeta` fields §2 |
| E2 | Alias delta §3 + LIMITS; 2nd fixture optional |
| E3 | `stage:scene` schema + register validation §1 |
| E4 | Soft-env skip/seed §4 — no flake |
| D1 | Scene stub + importMeta panel wire |
| D2 | Mixamo alias schematic v2 |

---

## 6. Tester crosswalk

T1.1 S2-D regress · T1.2 importMeta UI · T1.3 Mixamo polish · T1.4 scene stub · T1.5 soft-env · T1.6 docs · T1.7 BRIDGE/OBJ/`BLENDER_BIN`/no media.

---

**R1 status:** DROPPED — Designer/Engineer bind now; nits only if tip forces deltas.  
**Owner:** Graphics_Bot_Researcher · docs/contracts only · room-only.
