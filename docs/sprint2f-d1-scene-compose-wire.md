# S2-F-D1 — Scene compose wire (viewer)

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E2 · Tester T1.3/T1.4/T1.6  
**Brief:** `/workspace/sprint2f-brief.md` · Companion: `docs/sprint2f-d2-resolve-reject-matrix.md`  
**Status:** **R1-bound** · Leader cut  
**Cut:** `/workspace/sprint2f-cut.md` · **Base:** `origin/dev` @ `7d988d4` · Branch: `enhancement/s2f-docs`

---

## 1. Compose surface (read-only)

```
┌─ Scene compose ─────────────────────────────────────┐
│  stage:scene · v1 · root:n0 · nodes:2               │
│  Viewport: child GLBs @ transforms                  │
│    [n0 billboard]          [n1 rigged ▶ idle]       │
│  Nodes                                              │
│  ★ n0  slug/id  stage=mvp-billboard  clip=spin      │
│    n1  slug/id  stage=rigged         clip=idle   ▶  │
└─────────────────────────────────────────────────────┘
```

| Element | Behavior |
|---------|----------|
| Node list | id · assetId/slug · child stage badge · defaultClip |
| Order | `order` if present else array order; ★ = `rootId` |
| Select node | Highlight; show transform readouts |
| Transform | `position`/`rotation` (euler rad XYZ)/`scale` — defaults identity |
| Play | Active child’s `defaultClip` or selected clip |
| Missing GLB | Node error badge — **no demo fallback mesh** |
| Nested | Cannot appear if V5 enforced at register |

Out of scope: drag gizmos, save transforms, world lighting.

---

## 2. Load / playback

1. Fetch scene (`stage=scene`).  
2. Resolve each child → load `formats.glb`.  
3. Apply transform (defaults `[0,0,0]` / `[0,0,0]` / `[1,1,1]`).  
4. `defaultClip` set → play that Action; else child `clipUx.defaultClip`; else first clip / static.

| Case | Behavior |
|------|----------|
| `defaultClip` ∈ child clips | Play |
| `defaultClip` ∉ child clips | **Reject at register (V6b)** — viewer never sees |
| Missing child / corrupt | **Reject V4/V8** — no placeholder |
| Nested scene child | **Reject V5** |

Scene root: `clips[]=[]`, `rig` false/false — no aggregate playback.

---

## 3. Fixture shape (E3)

```ts
{
  stage: "scene",
  characterType: "unknown", // not humanoid
  clips: [],
  rig: { hasArmature: false, hasWeights: false },
  scene: {
    version: 1,
    rootId: "n0",
    nodes: [
      { id: "n0", assetId: "<registered-id>", transform: { position: [0,0,0] }, defaultClip: "spin" },
      { id: "n1", assetId: "<second-id>", transform: { position: [2,0,0] }, defaultClip: "idle" }
    ]
  }
}
```

≥2 known children; no `data/**` media — use prior fixtures / register helpers.

---

## 4. Handoffs / AC

| To | Use |
|----|-----|
| E2 | §1–§2 compose |
| E3 | §3 fixture + `tests/s2f-*` |
| Tester | T1.3 / T1.4 / T1.6 |

| Cut AC | This doc |
|--------|----------|
| T1.3 | compose ≥2 children |
| T1.4 | defaultClip honesty |
| T1.6 | this file |

**Locks:** room-only · Engineer opens PR after FULL PASS · BRIDGE unchanged.
