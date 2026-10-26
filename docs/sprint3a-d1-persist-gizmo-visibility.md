# S3-A-D1 — Scene persist + gizmo + visibility wire

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E1 · Tester T1.2/T1.3/T1.8  
**Brief:** `/workspace/sprint3a-brief.md` (**R1 bound**) · Companion: `docs/sprint3a-d2-tags-search-chrome.md`  
**Status:** Bound to R1  
**Cut:** `/workspace/sprint3a-cut.md` · **Base:** `a8b32c8` · **Pack:** `enhancement/s3a-growth-t1`

---

## 1. Author surface delta (on S2-G scene author)

```
┌─ Scene author / viewer ─────────────────────────────┐
│  [Select: n1]  visible:[✓]  [Save]                  │
│  ★ translate gizmo on selected (axes)               │
│  n0  visible ✓   …                                  │
│  n1  visible ✓ ← selected · gizmo live              │
│  n2  visible ✗   (hidden in compose, still in graph)│
└─────────────────────────────────────────────────────┘
```

| Control | Behavior | Persist |
|---------|----------|---------|
| Select node | enables translate gizmo (#24) | draft only |
| Translate gizmo | drag updates local `transform.position` | **Save only** (#23) |
| Visibility toggle (#33) | `nodes[].visible?: boolean` default `true` | Save |
| Save | PATCH/PUT full `scene` v1 | re-run V4–V8 + V4a; fail-closed |

### Field wire

```ts
nodes[].transform?: { position?: [n,n,n], rotation?: [n,n,n], scale?: [n,n,n] }
nodes[].visible?: boolean  // default true; false = hide, not delete
```

---

## 2. Rules (R1 §1)

| Rule | Detail |
|------|--------|
| Gizmo scope | **Translate only** on selected; rotate/scale = out (#25 later) |
| No selection / hidden | gizmo **disabled** |
| Hidden nodes | still in graph · count for V1 · still V4 resolve |
| Save honesty | error surfaces; **no** “saved” if local-only drift |
| Ids | unchanged nodes keep ids; no silent reorder |

---

## 3. Handoffs / AC

| To | Use |
|----|-----|
| E1 | #23 Save · #24 gizmo · #33 visible |
| Tester T1.2/T1.3 | gizmo+Save persist · hide without delete |

| Cut AC | This doc |
|--------|----------|
| T1.2 | §1–§2 persist+gizmo |
| T1.3 | §1 visibility |
| T1.8 | this file on **pack** |

**Locks:** room-only · Tester opens PR after FULL PASS · BRIDGE unchanged · no `*-docs` branch.
