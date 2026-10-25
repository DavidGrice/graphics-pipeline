# S2-D-R1 — Contract brief (clip UX · characterType · Mixamo · CI)

**Cut:** Leader `/workspace/sprint2d-cut.md` **v2** · 2026-10-25  
**Base:** `origin/dev` @ `269d0f6` (PR #30 S2-C CLOSED)  
**Pack branch:** `enhancement/s2d-rigged-clips` → `dev`  
**Consumers:** Designer D1/D2 · Engineer E1–E4 · Tester T1.1–T1.7  
**Locks:** `BRIDGE=vendor|firstparty` unchanged · GLB for clips · OBJ static-only · probe fills `clips`/`rig`/`stage` · no media in git · no demo fallback  
**Additive on:** S2-C-R1 · **Seed folded:** `/workspace/sprint2d-brief-seed.md`  
**Priority stack:** clip UX → `characterType` honesty → Mixamo spike → CI matrix

---

## 1. Clip allowlist + reject

### Required (rigged `stage`)

| Name | Required | Notes |
|------|----------|-------|
| `idle` | **yes** | S2-C lock; viewer default if present |
| `walk` | **yes** | S2-C lock |
| `run` | **yes** (S2-D) | E1 emits on `png_to_glb --mode=rigged`; LIMITS.md + T1.2 reason only if opt-in skip |

### Optional allowlist (register + play OK)

`jump` · `wave` · `attack` · `death` · `sit` · `emote_*` (prefix)

### Reject / strip rules

| Case | Behavior |
|------|----------|
| Missing `idle` or `walk` on `stage=rigged` | **Reject** register (S2-C) |
| Missing `run` on `stage=rigged` | **Reject** unless tip ships LIMITS + Tester records skip |
| Action name ∉ required ∪ allowlist ∪ `{spin}` | **Strip from authored UX list** OR keep in probed `clips[]` for playback but mark `unlisted:true` — **default: strip from default/order UX**, keep in raw probe for honesty |
| Empty `clips` | Static empty-state; **no demo fallback** |
| Billboard | `spin` only; claiming allowlist rigged clips on `mvp-billboard` → **reject** |
| Silent rename | **Forbidden** — remaps only via `importMeta.actionMap` (§3) |

### Clip UX persistence (E1 + D1)

```ts
clipUx?: {
  defaultClip?: string;     // must be ∈ probed clips after allowlist filter
  order?: string[];         // subset / permutation of probed clips
  disabled?: string[];      // hide from picker; still in GLB
}
```

- `defaultClip` missing/`idle` absent → first remaining allowlisted clip.  
- Loop toggle + scrub (0–1) apply to **active** clip only (E1).  
- Badges still mirror probed `rig.hasArmature` / `hasWeights`.

### Mode → stage (unchanged + run)

| Mode | `stage` | Min clips | Rig |
|------|---------|-----------|-----|
| `billboard` | `mvp-billboard` | `spin` | false/false |
| `rigged` | `rigged` | `idle`+`walk`+`run` | true/true |

---

## 2. `characterType` honesty gates

Enum (unchanged): `"billboard" | "prop" | "humanoid" | "unknown"`

### May claim `"humanoid"` only if **all** gates pass

1. `stage === "rigged"`.  
2. `rig.hasArmature === true` && `rig.hasWeights === true`.  
3. Probed clips include `idle` and `walk` (and `run` unless LIMITS skip).  
4. **Provenance:** `importMeta.source === "mixamo"` **OR** documented biped bone-map stub (`importMeta.boneMapStub` set) **OR** Designer-approved humanoid PNG path (explicit flag — default **off** for plane `png_to_glb`).  
5. Mesh is not a single textured plane with trivial 2-bone prop rig (heuristic: if only `root`/`tip` prop rig from S2-C png path → **cannot** claim humanoid).

### Fail-closed

| Claim | Actual | Result |
|-------|--------|--------|
| `humanoid` | gates fail | Schema/register **reject** (or auto-downgrade to `prop`/`unknown` — **prefer reject** for S2-D) |
| `billboard` | `stage=rigged` | reject |
| `prop` | Mixamo biped | allowed (conservative) |
| `unknown` | anything | allowed |

PNG pipeline default: `characterType = "prop"` for rigged plane; `"billboard"` for billboard mode.

---

## 3. Mixamo / FBX import fields

### Flow

`FBX|GLB → headless remap → GLB → register_asset (probe wins)`

### `importMeta` (optional, additive)

```ts
importMeta?: {
  source: "mixamo" | "fbx" | "png_pipeline" | "unknown";
  originalFilename?: string;
  actionMap?: Record<string, string>; // source name → contract name
  boneMapStub?: string;
  characterTypeHint?: "humanoid" | "prop" | "unknown";
}
```

| Rule | Detail |
|------|--------|
| `actionMap` values | Must ∈ required ∪ allowlist ∪ `{spin}` |
| Remap | Explicit only; no silent Action rename |
| Probe | Still fills `clips`/`rig`/`stage` — mode/hint cannot lie |
| Media | Fixtures under `testdata/` or gitignored inbox; **never** `data/**` committed |
| Blocked spike | `docs/...LIMITS.md` + T1.5 path |

---

## 4. CI matrix keys (E4)

| Key | Values | Use |
|-----|--------|-----|
| `SMOKE_MODE` / `MODE` | `billboard` \| `rigged` | `png_to_glb` path |
| `BLENDER_BIN` | abs path | fail-closed; pin 5.2.3 |
| `S2D_CLIP_EXPECT` | `spin` \| `idle,walk,run` | Action assert |
| `S2D_EXPECT_ARMATURE` | `0` \| `1` | |
| `S2D_EXPECT_WEIGHTS` | `0` \| `1` | |
| `S2D_STAGE_EXPECT` | `mvp-billboard` \| `rigged` | |
| `S2D_CHAR_TYPE_EXPECT` | `billboard` \| `prop` \| `humanoid` \| `unknown` | optional row |

### Minimum rows

| Row | MODE | clips | arm | wts | stage | characterType |
|-----|------|-------|-----|-----|-------|---------------|
| A | billboard | spin | 0 | 0 | mvp-billboard | billboard |
| B | rigged | idle,walk,run | 1 | 1 | rigged | prop (png path) |
| C (schema-only) | — | — | — | — | — | dishonest `humanoid` → reject |

Headless Blender on Linux CI preferred; schema fixtures always. No silent skip of row B without Leader ACK.

---

## 5. Engineer / Designer bind

| Slice | Bind |
|-------|------|
| E1 | Allowlist + `run` on rigged export; clipUx default/order; loop+scrub; no demo fallback |
| E2 | Mixamo/FBX → GLB + `importMeta` + probe |
| E3 | Schema humanoid gates (§2) |
| E4 | CI keys + rows A/B (+C schema) |
| D1 | Clip UX wire + badge copy + allowlist table |
| D2 | Mixamo schematic + naming/`actionMap` aliases + humanoid fail-closed |

---

## 6. Tester crosswalk

T1.1 S2-C regress · T1.2 allowlist/`run` · T1.3 clip UX · T1.4 humanoid gates · T1.5 Mixamo/LIMITS · T1.6 CI · T1.7 BRIDGE/OBJ/`BLENDER_BIN`.

---

**R1 status:** DROPPED — Designer/Engineer bind now; nits only if E1/E2/E3 probe forces deltas.  
**Owner:** Graphics_Bot_Researcher · docs/contracts only.
