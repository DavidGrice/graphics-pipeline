# S3-B-D1 — actionMap + rotate/scale gizmos + snap wire

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E1 · Tester T1.2/T1.3/T1.7  
**Brief:** `/workspace/sprint3b-brief.md` (**R1 bound**) · Companion: `docs/sprint3b-d2-pack-license-openapi.md`  
**Status:** Bound to R1  
**Cut:** `/workspace/sprint3b-cut.md` · **Base:** `0f21a43` · **Pack:** `enhancement/s3b-growth-t2`

---

## 1. actionMap editor (#91)

Editable `importMeta.actionMap` before register + durable via Save/PATCH (S2-E was read-only chips).

```
┌─ actionMap ─────────────────────────────────────────┐
│  Source clip          → Dest (allowlist)            │
│  Mixamo|Jumping       → [jump ▾]                    │
│  Custom|Wave_01       → [wave ▾]         [Remove]   │
│  [+ Add mapping]                         [Save]     │
└─────────────────────────────────────────────────────┘
```

```ts
importMeta?: {
  source: "mixamo" | "fbx" | "png_pipeline" | "unknown";
  actionMap?: Record<string, string>; // src Action → contract clip
  …
};
```

| Rule | Detail |
|------|--------|
| Dest | ∈ `CONTRACT_CLIP_NAMES` ∪ `emote_*` (`isContractClipName`) |
| Unknown / empty dest | **reject** 400 `importMeta.actionMap.<src>` |
| Empty `{}` | OK — hide rows |
| Missing `importMeta` | “No import metadata”; create draft only when user adds row + sets `source` |
| Src keys | free string; trim; reject empty |
| Duplicate dest | OK (many→one) |
| Probe | SoT for clips/rig/stage — **do not invent clips** |
| Persist | PATCH `{ importMeta }` merge (no wipe) or register-time body |
| Dirty | unsaved until **2xx** (same #23) |
| No auto-fill | dest not case-folded from src — explicit only |

---

## 2. Rotate / scale gizmos (#25)

Extends S3-A translate `TransformControls`:

| Mode | Edits | Persist |
|------|-------|---------|
| translate | position | Save only |
| rotate | rotation **radians** XYZ euler | Save only |
| scale | scale default `[1,1,1]` | Save only |

| Rule | Detail |
|------|--------|
| One mode active | toggle on selected **visible** node |
| Hidden / no selection | gizmo **disabled** |
| UI degrees | OK display; JSON writes **radians** |
| Scale ≤ 0 any axis | **reject** on Save (prefer over clamp) |
| Axes | commit all three of active mode — no silent drop |
| No auto-PATCH | on drag end |

Numeric inspector shares draft with gizmo.

---

## 3. Snap-to-grid (#30)

```ts
snap?: { enabled: boolean; step: number }; // default step 0.25; session-local OK
```

| Rule | Detail |
|------|--------|
| Off | free drag (S3-A) |
| On | quantize **translate** (+ numeric position) to `step` |
| Rotate snap | optional 15° nice-to-have |
| Scale snap | **out** |
| `step` | finite `> 0`; invalid → fall back `0.25` (no NaN) |
| Persist | snapped values on Save; prefs need not survive reload |
| Grid helper | align visual grid to `step` when feasible |

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
