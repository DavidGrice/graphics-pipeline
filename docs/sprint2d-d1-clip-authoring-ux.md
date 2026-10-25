# S2-D-D1 — Clip-authoring UX wire

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E1 · Tester T1.2/T1.3/T1.4  
**Brief:** `/workspace/sprint2d-brief.md` (R1-bound, cut v2) · Companion: `docs/sprint2d-d2-mixamo-import-schematic.md`  
**Status:** R1-bound · Leader cut v2  
**Base:** `origin/dev` @ `269d0f6` · Branch: `enhancement/s2d-docs` (fold onto `enhancement/s2d-rigged-clips`)

---

## 1. Surface map (viewer + register)

```
┌─ Asset viewer (rigged) ─────────────────────────────────────┐
│  [stage:rigged] [Armature] [Weights] [characterType: prop]  │  ← badges
│                                                             │
│  3D viewport …                                              │
│                                                             │
│  Clips:  [idle ★]  walk  run  jump            [⟲ loop]     │
│          ▲ default                                          │
│  Timeline: |========●=======|  scrub 0–1 on ACTIVE only     │
│                                                             │
│  Author: [Reorder ↕] [Disable] [Set default] [Rename*]      │
│  *Rename = display alias only; Action name stays probe SoT  │
└─────────────────────────────────────────────────────────────┘

Empty clips → static empty-state card: "No clips on this asset"
             **NO demo / spin fallback** (S2-C lock)
```

| Control | Persist field | Rules |
|---------|---------------|-------|
| Default clip | `clipUx.defaultClip` | Must ∈ probed clips after allowlist filter; prefer `idle` |
| Order | `clipUx.order` | Permutation / subset of allowlisted probed clips |
| Disable | `clipUx.disabled` | Hide from picker; still in GLB; not playable until re-enabled |
| Rename (display) | optional UI-only label | **Never** rewrite Blender Action / `clips[]` silently |
| Loop | viewer local | Active clip only |
| Scrub | viewer local | Normalized 0–1 over active Action duration |

```ts
clipUx?: {
  defaultClip?: string;
  order?: string[];
  disabled?: string[];
}
```

---

## 2. Allowlist table (picker + register)

| Tier | Names | UX |
|------|-------|-----|
| Required (rigged) | `idle`, `walk`, `run` | Always shown if present; missing `idle`/`walk` → register reject; missing `run` → reject unless LIMITS |
| Optional allowlist | `jump`, `wave`, `attack`, `death`, `sit`, `emote_*` | Show in author list if probed |
| Billboard | `spin` | Billboard picker only; never on `mvp-billboard` as rigged allowlist |
| Unlisted | other Action names | **Strip from default/order UX**; may remain in raw probe for honesty (`unlisted`) |

Reject: claiming allowlist rigged clips on `mvp-billboard`. Silent Action rename forbidden — remaps only via `importMeta.actionMap` (D2).

---

## 3. Badge copy

| Badge | Source | Copy / color intent |
|-------|--------|---------------------|
| Stage | probed `stage` | `mvp-billboard` \| `rigged` |
| Armature | `rig.hasArmature` | On / Off — never invent |
| Weights | `rig.hasWeights` | On / Off |
| characterType | schema field | `billboard` \| `prop` \| `humanoid` \| `unknown` |

### `humanoid` badge — honesty gates (all required)

1. `stage === "rigged"`  
2. `rig.hasArmature && rig.hasWeights`  
3. Clips include `idle` + `walk` (+ `run` unless LIMITS)  
4. Provenance: `importMeta.source === "mixamo"` **OR** `boneMapStub` set **OR** explicit humanoid PNG flag (default **off**)  
5. Not a trivial plane/prop 2-bone rig from default `png_to_glb`

Fail → **reject** claim (prefer reject over auto-downgrade for S2-D). PNG rigged default badge: **`prop`**. Billboard mode: **`billboard`**.

---

## 4. Empty / error states

| State | UI |
|-------|-----|
| `clips.length === 0` | Static empty-state; no demo mesh/clip |
| All clips disabled | Empty-state + "Re-enable a clip" |
| `defaultClip` missing from probe | Fall back to `idle`, else first allowlisted |
| Dishonest `humanoid` | Register/schema error; badge not shown as humanoid |

---

## 5. Handoffs

| To | Use |
|----|-----|
| Engineer E1 | Persist `clipUx`; loop+scrub; allowlist filter; no demo fallback |
| Engineer E3 | humanoid gates §3 |
| Tester T1.2/T1.3/T1.4 | Allowlist · UX default/empty · badge honesty |
| Designer D2 | Mixamo path feeds badges via `importMeta` |

## 6. AC trace

| Cut AC | This doc |
|--------|----------|
| T1.2 | §2 allowlist / `run` |
| T1.3 | §1 wire + §4 empty-state |
| T1.4 | §3 humanoid gates / badge copy |
| T1.6 | this file on branch |

**R1 bind:** clipUx + allowlist reject + humanoid gates from `/workspace/sprint2d-brief.md` §1–§2.
