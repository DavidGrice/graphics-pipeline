# S3-B-D1 — actionMap + rotate/scale gizmos + snap wire

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E1 · Tester T1.2/T1.3/T1.7  
**Brief:** `/workspace/sprint3b-brief.md` (rebind when R1 lands) · Companion: `docs/sprint3b-d2-pack-license-openapi.md`  
**Status:** Cut-draft — **R1 pending rebind**  
**Cut:** `/workspace/sprint3b-cut.md` · **Base:** `0f21a43` · **Pack:** `enhancement/s3b-growth-t2`

---

## 1. actionMap editor (#91)

Edit `importMeta.actionMap` **before** register (and via PATCH when allowed).

```
┌─ actionMap ─────────────────────────────────────────┐
│  Source clip          → Dest (allowlist)            │
│  Mixamo|Jumping       → [jump ▾]                    │
│  Custom|Wave_01       → [wave ▾]         [Remove]   │
│  [+ Add mapping]                         [Save]     │
└─────────────────────────────────────────────────────┘
```

| Rule | Detail |
|------|--------|
| Dest values | ∈ clip allowlist (idle/walk/run/jump + optionals) |
| Unknown dest | reject |
| Round-trip | edit → Save/register → reload shows same map |
| Probe wins | cannot forge clips that GLB lacks |

---

## 2. Rotate / scale gizmos (#25)

Extends S3-A translate-only:

| Mode | Behavior |
|------|----------|
| Translate | existing #24 |
| Rotate | euler rad XYZ on selected |
| Scale | uniform or per-axis; default identity |
| Persist | **Save only** (same dirty→2xx as S3-A #23) |
| Hidden / no selection | gizmos disabled |

Mode toggle: Translate | Rotate | Scale (one active).

---

## 3. Snap-to-grid (#30)

| Control | Behavior |
|---------|----------|
| Snap on/off | authoring aid; default off |
| Grid size | e.g. 0.25 / 0.5 / 1.0 world units |
| Applies to | translate (and optionally scale steps) while dragging |
| Persist | snapped values written on Save — not a separate field |

---

## 4. Handoffs / AC

| To | Use |
|----|-----|
| E1 | #91 · #25 · #30 |
| Tester T1.2/T1.3 | actionMap round-trip · gizmos+snap persist |

| Cut AC | This doc |
|--------|----------|
| T1.2 | §1 |
| T1.3 | §2–§3 |
| T1.7 | this file on **pack** |

**Locks:** room-only · Tester opens PR · no `*-docs` branch.
