# S2-C-C3 — Viewer wire (clip picker + rig badges)

**Role:** Graphics_Bot_Designer  
**Extends:** `docs/sprint1-viewer-wireframe.md`  
**Consumes:** D1 clips/rig fields

---

## Layout

```
┌─────────────────────────────────────────────┐
│ Asset: {name} / {slug}     stage badge      │
│ [ Armature ] [ Weights ] [ Billboard|Rigged ]│
├──────────────────┬──────────────────────────┤
│                  │ Clips                    │
│   R3F canvas     │ ○ idle                   │
│                  │ ○ walk                   │
│                  │ ○ …                      │
│                  │ [Play] [Pause] [Loop]    │
└──────────────────┴──────────────────────────┘
```

## States

| State | Behavior |
|-------|----------|
| Loaded rigged | Clip list from `clips[]`; default select `idle` |
| Loaded billboard | Show `spin` (or sole clip); badge Billboard |
| Playing | Highlight active clip; Action switches on select |
| Empty clips | Empty-state copy — **no** demo GLB fallback |
| Missing GLB | Error + path hint |

## AC (align Tester)

Selecting `idle` vs `walk` switches Action; badges match `rig` + `stage`; no hard-coded spin-only UI for rigged.
