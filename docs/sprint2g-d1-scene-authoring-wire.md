# S2-G-D1 — Scene authoring wire

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E2 · Tester T1.2/T1.3/T1.6  
**Brief:** `/workspace/sprint2g-brief.md` (rebind when R1 lands) · Companion: `docs/sprint2g-d2-jump-allowlist.md`  
**Status:** Cut-draft — **R1 pending rebind**  
**Cut:** `/workspace/sprint2g-cut.md` · **Base:** `origin/dev` @ `c16d72c` · Branch: `enhancement/s2g-docs`

---

## 1. Author surface (register + viewer)

Minimal CRUD on `scene.nodes` — not a world editor. Builds on S2-F compose (read-only → editable).

```
┌─ Scene author ──────────────────────────────────────┐
│  stage:scene · v1 · root:[n0 ▾]                     │
│  [+ Add node]                                        │
│                                                     │
│  ★ n0  asset:[slug-or-id ▾]  [Resolve ✓]            │
│       pos [0,0,0]  rot [0,0,0]  scale [1,1,1]       │
│       defaultClip:[spin ▾]           [Remove]       │
│    n1  asset:[npc-slug ▾]    [Resolve ✓]            │
│       pos [2,0,0]  …  defaultClip:[idle|jump ▾]     │
│       [Remove]                                      │
│  [Save / Register]                                   │
└─────────────────────────────────────────────────────┘
```

| Control | Persist | Rules |
|---------|---------|-------|
| Add node | new `nodes[]` entry | unique `id`; empty asset → block save |
| Remove node | drop entry | cannot leave `nodes.length < 1`; if remove root → pick new `rootId` |
| asset picker | `assetId` | **id OR registered slug** (E1); unknown → Resolve ✗ / block save (V4) |
| Transform | position/rotation/scale | defaults identity; euler rad XYZ |
| defaultClip | optional | must ∈ resolved child `clips[]` or empty |
| Set root | `rootId` | must ∈ node ids |
| Save | register/update | full V1–V8 matrix (S2-F + slug) |

Nested `stage=scene` children: Resolve ✗ (V5). No drag gizmos / lighting in S2-G.

---

## 2. Slug resolve (UI notes)

| Input | UI |
|-------|-----|
| Canonical UUID/id | Resolve ✓ when found |
| Unique slug | Resolve ✓ → show resolved id + child stage badge |
| Ambiguous / unknown | Resolve ✗ — name the bad value; **no silent strip** |
| Child stage=scene | Resolve ✗ nested |

Show child stage + available clips after resolve so defaultClip dropdown is honest.

---

## 3. Handoffs / AC

| To | Use |
|----|-----|
| E1 | Slug resolve behind picker |
| E2 | CRUD wire §1 |
| Tester T1.2/T1.3 | slug accept · add ≥2 nodes persist |

| Cut AC | This doc |
|--------|----------|
| T1.2 | §2 slug |
| T1.3 | §1 authoring |
| T1.6 | this file |

**Locks:** room-only · Engineer opens PR after FULL PASS · BRIDGE unchanged.
