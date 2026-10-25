# S2-E-D1 — Scene stub + importMeta badge/panel wire

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E1/E3 · Tester T1.2/T1.4/T1.6  
**Brief:** `/workspace/sprint2e-brief.md` · Companion: `docs/sprint2e-d2-mixamo-alias-v2.md`  
**Status:** **R1-bound** · Leader cut  
**Cut:** `/workspace/sprint2e-cut.md` · **Base:** `origin/dev` @ `26eaac1` · Branch: `enhancement/s2e-docs`

---

## 1. importMeta panel (viewer + register)

When `importMeta` **present**, surface fields below (read-only). When **absent**: hide panel or single line “No import metadata” — **no crash, no undefined rows**.

```
┌─ Import ────────────────────────────────────────────┐
│  Source: mixamo                                      │
│  Original file: Walking.fbx                          │
│  Bone map: mixamo-biped-v1                           │
│  Type hint: humanoid          (≠ characterType SoT)  │
│  PNG humanoid approved: yes   (only if true)         │
│  Action map:                                         │
│    Idle → idle                                       │
│    Walking → walk                                    │
│    Jogging → run                                     │
└──────────────────────────────────────────────────────┘
```

| Field | UI label | Notes |
|-------|----------|-------|
| `source` | Source | `mixamo` \| `fbx` \| `png_pipeline` \| `unknown` |
| `originalFilename` | Original file | omit row if absent |
| `actionMap` | Action map | `src → dest` rows; hide section if empty |
| `boneMapStub` | Bone map | monospace stub |
| `characterTypeHint` | Type hint | secondary; **not** honesty badge |
| `humanoidPngApproved` | PNG humanoid approved | show **only if** `true` |

Rules: UI read-only · never invent `importMeta` · probed `clips`/`rig`/`stage` remain SoT · S2-D dishonest `characterType` reject unchanged.

---

## 2. `stage:scene` stub wire

Minimal multi-asset graph — **not** a world editor.

```
┌─ Scene (stub) ──────────────────────────────────────┐
│  stage: scene · version: 1 · nodes: 2                │
│  root: node-a                                        │
│  [node-a] assetId=bench-01  transform…  clip —       │
│  [node-b] assetId=npc-02    transform…  defaultClip=idle │
└──────────────────────────────────────────────────────┘
```

### Schema (R1)

```ts
stage: "mvp-billboard" | "rigged" | "scene";
scene?: {
  version: 1;
  nodes: SceneNode[];   // ≥1
  rootId?: string;      // default nodes[0].id
};
type SceneNode = {
  id: string;
  assetId: string;
  transform?: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  };
  defaultClip?: string; // ∈ child clips if child has clips
};
```

### Reject table (fail-closed)

| ID | Reject when |
|----|-------------|
| V1 | `stage=scene` and (`scene` missing OR `nodes.length < 1`) |
| V2 | Duplicate `nodes[].id` |
| V3 | `rootId` not in `nodes[].id` |
| V4 | Unknown / unresolved `assetId` |
| V5 | Nested scene child (`stage=scene`) |
| V6 | `defaultClip` ∉ child `clips[]` |
| V7 | `stage=scene` without `scene.nodes` (glb-as-scene lie) |

Honesty: scene root `rig` = false/false; root `clips[]` prefer `[]` (playback per-node). Viewer: list nodes / open child — no spatial editor.

---

## 3. Soft-env note (E4 / T1.5)

| Condition | Behavior |
|-----------|----------|
| API down | Skip/pending with reason — **not** fail |
| API up, no demo seed | Auto-seed **or** skip demos — **not** flake |
| Unit/schema | Green without `:8787` / Blender |
| Live smoke | Fail-closed `BLENDER_BIN` as today |

Point cold readers at setup docs + seed recipe (Engineer).

---

## 4. Handoffs / AC

| To | Use |
|----|-----|
| E1 | §1 panel |
| E3 | §2 schema + rejects |
| E4 | §3 soft-env |
| Tester | T1.2 / T1.4 / T1.5 / T1.6 |

| Cut AC | This doc |
|--------|----------|
| T1.2 | §1 |
| T1.4 | §2 |
| T1.5 | §3 |
| T1.6 | this file |

**Locks:** BRIDGE unchanged · no `data/**` media · room-only.
