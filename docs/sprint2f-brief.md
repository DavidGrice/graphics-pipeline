# S2-F-R1 — Contract brief (scene resolve + compose viewer)

**Cut:** Leader `/workspace/sprint2f-cut.md` · 2026-10-25  
**Base:** `origin/dev` @ `7d988d4` (PR #34/#35 S2-E CLOSED)  
**Pack branch:** `enhancement/s2f-scene-compose` → `dev`  
**Consumers:** Designer D1/D2 · Engineer E1–E4 · Tester T1.1–T1.7  
**Locks:** BRIDGE unchanged · probe SoT for clips/rig/stage · no media in git · no demo fallback · room-only · **Engineer opens PR→dev after Tester FULL PASS**  
**Additive on:** S2-E-R1 scene stub (`scene.version`/`nodes`/`rootId`) — V4 was API-deferred; **S2-F makes V4 hard**

---

## 1. Register-time child resolve (V4 hard)

### Resolve target
Each `scene.nodes[].assetId` must resolve to an **already registered** asset at register (or update) time.

| Accept as `assetId` | Meaning |
|---------------------|---------|
| UUID / canonical `id` | Exact match in asset store |
| Stable `slug` | Resolve via slug→id if API supports; must be unique |

### Reject matrix (hard)

| Code | Condition | HTTP / CLI |
|------|-----------|------------|
| **V4** | Any `assetId` unresolved (unknown id/slug) | reject — no partial scene |
| **V5** | Resolved child has `stage === "scene"` | reject — **no nested scenes** |
| V1–V3, V6–V7 | Unchanged from S2-E-R1 | reject |
| **V6b** | `defaultClip` set and ∉ child’s probed `clips[]` | reject |
| **V8** | Child `stage` missing / corrupt record | reject (treat as unresolved) |

### Soft → hard (D2 narrative)

| S2-E | S2-F |
|------|------|
| Schema notes “API enforces assetId” | Register **must** resolve before persist |
| Missing child might 200 + broken viewer | Missing child → **fail-closed** |

### Honesty

- Do **not** auto-create placeholder children.  
- Do **not** strip unknown nodes silently.  
- Scene root still: `rig` false/false, `clips[]` = `[]`, no `characterType: humanoid` at root (S2-E).

---

## 2. Compose viewer fields (E2 + D1)

### Load path
1. Fetch scene asset (`stage=scene`).  
2. For each node (order = `order` if present else array order; focus `rootId` first optional): resolve child asset → load `formats.glb` (or static path).  
3. Apply `transform` (defaults identity).  
4. If `defaultClip` set → play that Action on child; else child idle/default from S2-D `clipUx` if present; else first clip / static.

### Transform contract (unchanged shape)

```ts
transform?: {
  position?: [number, number, number]; // default [0,0,0]
  rotation?: [number, number, number]; // euler radians XYZ; default [0,0,0]
  scale?: [number, number, number];    // default [1,1,1]
}
```

### UI wire (read-only compose in S2-F)

| Element | Behavior |
|---------|----------|
| Node list | id · assetId/slug · stage badge of child · defaultClip |
| Select node | Highlight in viewport; show transform readouts |
| Play | Active child’s `defaultClip` or selected clip |
| Missing GLB | Node error badge — **no demo fallback mesh** |
| Nested attempt | Cannot appear if register enforced V5 |

Out of scope: drag gizmos, save transforms back, world lighting editor.

---

## 3. Fixture shape (E3)

### Minimum scene fixture (tests / box)

```ts
{
  stage: "scene",
  characterType: "unknown", // or "prop" — not humanoid
  clips: [],
  rig: { hasArmature: false, hasWeights: false },
  scene: {
    version: 1,
    rootId: "n0",
    nodes: [
      {
        id: "n0",
        assetId: "<registered-billboard-or-rigged-id>",
        transform: { position: [0, 0, 0] },
        defaultClip: "spin" // only if child has spin; else omit / use idle
      },
      {
        id: "n1",
        assetId: "<second-registered-id>",
        transform: { position: [2, 0, 0], scale: [1, 1, 1] },
        defaultClip: "idle" // iff child rigged with idle
      }
    ]
  }
}
```

### Test cases (`tests/s2f-*`)

| Case | Expect |
|------|--------|
| ≥2 known children | accept |
| Unknown `assetId` | V4 reject |
| Child `stage=scene` | V5 reject |
| `defaultClip` not in child clips | V6b reject |
| S2-E schema cases | still green |
| No committed PNG/GLB under `data/**` | use prior fixtures / synth / register helpers |

---

## 4. Honesty vs nested (summary)

| Allowed | Forbidden |
|---------|-----------|
| Scene of billboard + rigged (+ prop) children | Scene of scenes |
| Resolve by id or unique slug | Silent drop of bad nodes |
| Per-node `defaultClip` ∈ child clips | Inventing clips / demo GLB |
| Compose transforms in viewer | Persisting viewer edits (S2-F) |

---

## 5. Engineer / Designer bind

| Slice | Bind |
|-------|------|
| E1 | Register resolve V4 (+ V5/V6b enforcement at API) |
| E2 | Viewer compose transforms + defaultClip play |
| E3 | `tests/s2f-*` + docs/LIMITS fold |
| E4 | S2-E regress / soft-env / no BRIDGE churn |
| D1 | Compose wire (node list → transform → clip) |
| D2 | Soft→hard resolve/reject matrix schematic |

---

## 6. Tester crosswalk

T1.1 S2-E regress · T1.2 V4 unknown reject · T1.3 ≥2 children + compose · T1.4 defaultClip honesty · T1.5 V5 nested · T1.6 docs · T1.7 BRIDGE/OBJ/`BLENDER_BIN`/no media.

---

**R1 status:** DROPPED — Designer/Engineer bind now.  
**Owner:** Graphics_Bot_Researcher · docs/contracts only · room-only.
