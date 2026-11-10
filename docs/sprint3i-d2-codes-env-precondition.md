# Sprint 3-I — D2: codes, env and design answers

**Status:** DRAFT bound to R1 `/workspace/sprint3i-brief.md` (pack path `docs/sprint3i-brief.md`). Pack `enhancement/s3i-growth-t9`, cut from S3-H merge `1cfe7b366d39` on `dev`.

## Codes
| Code | Status | Notes |
|---|---|---|
| `PRECONDITION_REQUIRED` | **new** (428) | #40 `PATCH /api/assets/:id/nodes` without `If-Match`. Body `{code, error}`; nothing written. Listed in `docs/error-codes.md` and the S3-I section of `docs/contract-changelog.md`. |
| `PRECONDITION_FAILED` | reuse (412) | Stale `If-Match` on #40 → `{current}`. Nothing written. |
| `VALIDATION` | reuse | Malformed `If-Match`; empty upsert/remove (`field:"upsert"`); not-a-scene (`field:"stage"`); upsert/remove overlap (`field:"remove"`); >`BULK_MAX` or zero GLB entries (`field:"entries"`); #28 non-PNG or wrong size (`field:"body"`); #81 marker cap/name/clip/`t` (`field:"clipUx.markers"`). |
| `NOT_FOUND` | reuse | 404 before 428/412 on #40. |
| `PATH_OUTSIDE_INBOX` | reuse (400) | #70 zip-slip, absolute names, or extract-root escape; whole request, nothing written. |
| `GLB_TOO_LARGE` | reuse (413) | #70 zip larger than `BULK_MAX * MAX_GLB_BYTES` (whole request); also a per-entry failure in `results[]`. |
| `SLUG_CLASH` | reuse | #70 per-entry failure only. |
| `SCENE_ROOT_DELETE`, `SCENE_NO_LIVE_NODES` | reuse | #40 tombstone of the root, or no live nodes left. |
| `CONFIG_INVALID` | reuse | Bad `BULK_MAX` at boot only. `ECHO_ITEMS_MAX` is a constant, not env. |

Still exactly 6 `SKIP_*`. Schema stays **3**. OpenAPI → **0.9.0** (new routes: `PATCH /api/assets/:id/nodes`, `POST /api/assets/bulk`, `PUT /api/assets/:id/preview`; GET preview already exists). There is no `/api/scenes` collection.

## New env (`.env.example`, `NON_CODES`, contract-changelog)
| Var | Range / default | Notes |
|---|---|---|
| `BULK_MAX` | int 1..100, default **20** | #70 `.glb` entries per zip. Bad value → `CONFIG_INVALID` at boot. |

`ECHO_ITEMS_MAX` is a **constant 20**, not an env, and is not listed in `.env.example`.

## Behaviour notes
- **Echo cap (ruling a):** each echoed array ≤20 items, top-level `truncated:<n>` when any dropped (sum across arrays). The 200-character client-echo cap ends in `…` and is a prefix of the sent value (CO-3 (ii)). Mid-string zod excerpts stay under CO-3 (iii): they need not end in `…` or be a prefix (NIT-H-5). Never server or absolute paths.
- **#40 (ruling b):** 404 → 428 missing `If-Match` → 400 malformed → 412 stale → 400 body / scene codes → 200 + `ETag`. Required on this route only; existing PATCH/DELETE and clip-ux stay opt-in. `remove` tombstones; purge stays on the full asset PATCH.
- **#59 (ruling c):** vendored decoder under `client/public/draco/`, pinned version + checksum in a test; no CDN. Two #62 golden hashes (plain and Draco). No seventh `SKIP_*`.
- **#143:** `actor: "local"` on existing non-ops kinds only (`asset.register`, `asset.patch`, `asset.delete`, `scene.save`, `scene.purge`, `pack.import`). No `asset.purge` or `scene.delete` kinds. No key id until #73.
- **#70:** JSON `{zip:"inbox/<file>.zip"}`, not multipart. Whole-request zip-slip is `PATH_OUTSIDE_INBOX`; whole-request oversize is `GLB_TOO_LARGE`. Per-entry `SLUG_CLASH` / `GLB_TOO_LARGE` leave the other rows intact.
- **CO-2:** results are cited as `HEAD=<sha>` + run id, only after that run finished.

## Design answers
- #28 preview fallback: initial on a neutral tile (`scene-thumb-fallback`). PUT/GET `/api/assets/:id/preview`. Offscreen capture and pixel assertions run against SwiftShader (`--use-angle=swiftshader`) on the Linux box. `If-Match` is opt-in.
- #81 at cap: "16 of 16 markers", Add disabled. Markers are `clipUx.markers:[{clip, t, name}]` on the asset, saved through `PATCH /api/assets/:id/clip-ux`.
- #131 stats: "Loaded n / total". In-view nodes within `SCENE_NODES_MAX/4` are never placeholders; in-view nodes past that cap may start as placeholders but still load without a camera move.
- #105 256-node frame budget is a SwiftShader number on the Linux runner/box, not a native GPU budget.
