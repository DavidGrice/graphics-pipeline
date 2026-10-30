# S2-G-D1 — Scene authoring wire

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E2 · Tester T1.2/T1.3/T1.6  
**Brief:** `/workspace/sprint2g-brief.md` (**R1 bound**) · Companion: `docs/sprint2g-d2-jump-allowlist.md`  
**Status:** Bound to R1  
**Cut:** `/workspace/sprint2g-cut.md` · **Base:** `origin/dev` @ `c16d72c` · Branch: `enhancement/s2g-scene-author-jump`

---

## 1. Author surface (register + viewer)

Minimal CRUD on `scene.nodes` — not a world editor. Builds on S2-F compose (read-only → editable).

```
┌─ Scene author ──────────────────────────────────────┐
│  stage:scene · v1 · root:[n0 ▾]                     │
│  [+ Add node]                                        │
│                                                     │
│  ★ n0  asset:[slug-or-id ▾]  [Resolve ✓ → uuid]     │
│       pos [0,0,0]  rot [0,0,0]  scale [1,1,1]       │
│       defaultClip:[spin ▾]           [Remove]       │
│    n1  asset:[npc-slug ▾]    [Resolve ✓ → uuid]     │
│       pos [2,0,0]  …  defaultClip:[idle|jump ▾]     │
│       [Remove]                                      │
│  [Save / Register]                                   │
└─────────────────────────────────────────────────────┘
```

| Control | Persist | Rules |
|---------|---------|-------|
| Add node | new `nodes[]` entry | client UUID `id` ok; empty asset → block save |
| Remove node | drop entry | `nodes.length < 1` → **V1**; if removed was `rootId` → first remaining or clear |
| asset picker | `assetId` | **id OR unique slug**; list **non-scene only** (`stage!=="scene"`) |
| Transform | position/rotation/scale | defaults identity; euler rad XYZ |
| defaultClip | optional | must ∈ resolved child `clips[]` or empty (**V6b**) |
| Set root | `rootId` | must ∈ node ids |
| Reorder | array order / optional `order` | compose uses array order unless `order` set |
| Save | register/update | full V1–V8 + **V4a**; **no silent strip** |

Nested `stage=scene` children: Resolve ✗ (**V5**). No gizmos that write without Save.

### Field wire (R1 §2)

```ts
scene: {
  version: 1,
  rootId?: string,
  nodes: Array<{
    id: string,
    assetId: string,          // id OR slug at input
    transform?: { position?: [n,n,n], rotation?: [n,n,n], scale?: [n,n,n] },
    defaultClip?: string
  }>
}
```

---

## 2. Slug resolve (UI notes) — V4 / V4a

| Input | UI |
|-------|-----|
| Canonical UUID/id | Resolve ✓ when found |
| Unique slug | Resolve ✓ → show **canonical id** + child stage badge |
| Ambiguous slug (>1) | Resolve ✗ **V4a** — name the slug; **do not pick first** |
| Unknown (0 matches) | Resolve ✗ **V4** |
| Child stage=scene | Resolve ✗ **V5** |
| Corrupt / missing stage | Resolve ✗ **V8** |

**Persist:** prefer normalize stored `assetId` → canonical `id` (R1); UI may still display slug. If storing slug raw, re-resolve on every load (must stay unique).

Show child stage + available clips after resolve so defaultClip dropdown is honest (incl. `jump` when probed).

---

## 3. Handoffs / AC

| To | Use |
|----|-----|
| E1 | Slug + V4a behind picker; normalize→id |
| E2 | CRUD wire §1 + field wire |
| Tester T1.2/T1.3 | slug accept · V4a reject · add ≥2 nodes persist |

| Cut AC | This doc |
|--------|----------|
| T1.2 | §2 slug / V4a |
| T1.3 | §1 authoring |
| T1.6 | this file |

**Locks:** room-only · Tester opens PR after FULL PASS · BRIDGE unchanged.
