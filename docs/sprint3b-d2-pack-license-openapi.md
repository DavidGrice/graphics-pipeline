# S3-B-D2 — pack zip + license + OpenAPI + duration_ms notes

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E2/E3/E4 · Tester T1.4–T1.7  
**Brief:** `/workspace/sprint3b-brief.md` (**R1 bound**) · Companion: `docs/sprint3b-d1-actionmap-gizmo-snap.md`  
**Status:** Bound to R1  
**Cut:** `/workspace/sprint3b-cut.md` · **Base:** `0f21a43` · **Pack:** `enhancement/s3b-growth-t2`

---

## 1. Golden GLB hashes (#62)

| Piece | Contract |
|-------|----------|
| Track | **hashes only** under `testdata/golden/` — **not** GLB bytes in git |
| Algo | SHA-256 hex of full GLB |
| Modes | billboard + rigged smoke (`png_to_glb` / `pipeline.sh`) |
| Script | `npm run test:golden` or CI after deterministic export |
| `BLENDER_BIN` | fail-closed; missing → non-zero |

| Outcome | Behavior |
|---------|----------|
| Match | pass |
| Mismatch | **fail** (print expected vs actual) |
| Missing golden | **fail** — never auto-write in CI |
| Soft-env no Blender | skip with explicit reason — not a green lie |

Refresh goldens = intentional local/script + review; record Blender version. Inputs = repo fixtures only — no `data/**` media.

---

## 2. Pack zip (#135 / #136)

```
pack.json
LICENSE
assets/<slug>.glb
```

```ts
// pack.json
{
  packSchemaVersion: 1,
  createdAt: string, // ISO
  assets: Array<{
    slug: string; name: string;
    stage: "mvp-billboard" | "rigged" | "scene";
    characterType: string;
    license?: string; // SPDX
    glb: string;
    assetSchemaVersion?: number;
  }>;
}
```

| Export | Rule |
|--------|------|
| Selection | CLI allowlist of slugs/ids — not full DB dump |
| Media | resolved GLBs only; **never** `data/inbox/**`, `.kra`, FBX caches, dumps |
| Scene | include graph only if **all children selected**; else reject that asset |
| Empty | non-zero exit |
| LICENSE | required file even if per-asset SPDX set |

| Import | Rule |
|--------|------|
| Unknown `packSchemaVersion` | **reject** |
| Probe wins | re-probe GLB; don’t trust zip clips/rig |
| Slug collision | default **reject** (`--force` documented) |
| Zip safety | no `..` / abs path escape; CI writes `/tmp` or gitignored inbox — not tracked `data/**` |
| No ship | `node_modules`, `.env`, keys |

---

## 3. Clip duration_ms (#8)

```ts
clipDurations?: Record<string, number>; // clip → duration_ms integer ≥ 0
```

| Rule | Detail |
|------|--------|
| SoT | **probe** (Action duration × 1000 → ms) |
| Key | ∈ probed `clips[]`; unknown → **reject** |
| Negative / NaN | **reject** |
| Missing map | OK |
| PATCH | **forbid** inventing durations — probe-only write |
| Viewer | may show ms; scrub uses live clip.duration |

---

## 4. License SPDX (#137)

```ts
license?: string; // e.g. MIT, Apache-2.0, LicenseRef-Mixamo
```

| Rule | Detail |
|------|--------|
| Missing | OK |
| Empty string | **reject** |
| Allowlist stub | `MIT`, `Apache-2.0`, `CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `GPL-3.0-only`, `LicenseRef-Mixamo`, `UNLICENSED` (+ parse lib OK) |
| Unknown | **400** |
| PATCH | allowed |
| Pack | `assets[].license` + top-level LICENSE |
| UI | metadata only — no legal advice |

Stay on `assetSchemaVersion = 3` unless breaking (prefer 3).

---

## 5. OpenAPI stub (#74)

| Piece | Contract |
|-------|----------|
| Path | prefer `docs/openapi.yaml` |
| Version | OpenAPI **3.0.x** |
| Coverage | `/api/health`, `/api/assets` GET+POST, `/api/assets/{id}` GET+PATCH, clip-ux PATCH, file/preview GET |
| Gen | hand-written stub OK; route codegen stretch |
| CI | file exists + parses; no secrets; README/AGENTS one-liner |
| Honesty | do not document endpoints that don’t exist |

---

## 6. Handoffs / AC

| To | Use |
|----|-----|
| E2 | #62 · #8 |
| E3 | #135/#136 · #137 |
| E4 | #74 + S3-A regress |
| Tester T1.4–T1.6 | hash · pack+SPDX · duration + OpenAPI |

| Cut AC | This doc |
|--------|----------|
| T1.4–T1.6 | §1–§5 |
| T1.7 | this file on **pack** |

**Locks:** room-only · Tester opens PR · no media in git · `BLENDER_BIN` fail-closed.
