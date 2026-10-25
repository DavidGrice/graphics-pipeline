# S2-G-R1 — Contract brief (scene authoring · slug resolve · jump clip)

**Cut:** Leader `/workspace/sprint2g-cut.md` · 2026-10-25  
**Base:** `origin/dev` @ `c16d72c` (PR #36/#37 S2-F on `dev`)  
**Pack branch:** `enhancement/s2g-scene-author-jump` → `dev`  
**Consumers:** Designer D1/D2 · Engineer E1–E4 · Tester T1.1–T1.7  
**Locks:** BRIDGE unchanged · V4/V5/V6b/V8 still hard · no nested scenes · no demo fallback · no media in git · room-only · **Engineer opens PR→dev after FULL PASS**  
**Additive on:** S2-F-R1 (compose + resolve) · S2-D allowlist (`jump` already optional — S2-G makes **rigged export emit `jump`**)

---

## 1. Slug resolve (E1) — harden V4

### Accept as `scene.nodes[].assetId`

| Form | Rule |
|------|------|
| Canonical UUID / `id` | Exact match (S2-F) |
| **Slug** | Must resolve to **exactly one** registered asset |

### Reject

| Case | Code |
|------|------|
| Unknown id or slug | **V4** |
| Slug matches **0** assets | **V4** |
| Slug matches **>1** assets (ambiguous) | **V4a** — reject; message names slug (do not pick first silently) |
| Nested `stage=scene` child | **V5** |
| Corrupt child / missing stage | **V8** |
| Bad `defaultClip` | **V6b** |

### Persist policy

- On successful register, optionally **normalize** stored `assetId` to canonical `id` (recommended) while UI may still show slug.  
- If storing slug raw, re-resolve on every load — must still be unique.

---

## 2. Scene authoring fields (E2 + D1)

### Minimal CRUD (register and/or viewer)

| Action | Contract |
|--------|----------|
| **Add node** | New `id` (client UUID ok); `assetId` = id or slug of known non-scene asset; optional transform + `defaultClip` |
| **Remove node** | Drop from `nodes[]`; if removed was `rootId`, set `rootId` to first remaining or clear |
| **Edit** | Change `assetId` / transform / `defaultClip`; re-run V4–V8 before persist |
| **Reorder** | Optional `order` or array order; viewer compose uses array order unless `order` present |

### Field wire

```ts
// authoring draft → POST/PATCH register body
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

### UI honesty

- Asset picker lists **non-scene** assets only (filter `stage!=="scene"`).  
- Persist fails closed on V4/V4a/V5/V6b/V8 — show server error; **no silent strip**.  
- Empty scene (`nodes.length < 1`) still **V1** reject.  
- Out of scope: gizmos that write transforms without Save; nested scene picker.

---

## 3. `jump` clip — allowlist + honesty (E3 + D2)

### Status change

| Before (S2-D) | S2-G |
|---------------|------|
| `jump` optional allowlist | Rigged `png_to_glb --mode=rigged` **emits** Action `jump` in addition to `idle`/`walk`/`run` |
| Schema `stage=rigged` required `idle,walk,run` | Still required; **`jump` recommended present** on new exports — see gate below |

### Schema / probe gates

| Gate | Rule |
|------|------|
| Export (E3) | Rigged GLB Actions include `idle`,`walk`,`run`,`jump` (four) unless LIMITS documents opt-out |
| Register `stage=rigged` | Keep requiring `idle`+`walk`+`run` (S2-D). Soft: warn or LIMITS if `jump` missing on **new** png-pipeline assets; Mixamo import maps Jump/Jumping→`jump` when present |
| Dishonest | Claiming `jump` in `clips[]` / `clipUx` when Action absent in GLB → **reject** (probe wins) |
| Billboard | Still `spin` only — no `jump` |
| Allowlist | `jump` remains in optional UX allowlist for Mixamo extras; now also a **first-class** rigged export clip |

### Viewer / authoring

- `defaultClip: "jump"` valid when child has `jump`.  
- Clip picker shows `jump` when probed.

### Mixamo alias (unchanged dest)

`Jump` / `Jumping` → `jump` (already S2-E); ensure still in LIMITS.

---

## 4. Regress locks (E4)

- S2-F: V4 unknown reject, V5 nested, compose ≥2, V6b, soft-env, blender-smoke A/B.  
- S2-D/E: humanoid gates, importMeta UI, scene stub honesty.  
- No BRIDGE / OBJ / media-in-git churn.

---

## 5. Engineer / Designer bind

| Slice | Bind |
|-------|------|
| E1 | Slug (+ V4a ambiguous) resolve |
| E2 | Authoring CRUD UI → persist scene |
| E3 | `jump` on rigged export + probe/LIMITS |
| E4 | Regress + docs fold |
| D1 | Authoring wire (add/remove/edit/transform/clip) |
| D2 | Jump + allowlist schematic |

---

## 6. Tester crosswalk

T1.1 S2-F regress · T1.2 slug resolve · T1.3 authoring ≥2 nodes persist · T1.4 `jump` present / dishonest reject · T1.5 nested + BRIDGE · T1.6 docs · T1.7 `BLENDER_BIN` / no media / OBJ.

---

**R1 status:** DROPPED — Designer/Engineer bind now.  
**Owner:** Graphics_Bot_Researcher · docs/contracts only · room-only.
