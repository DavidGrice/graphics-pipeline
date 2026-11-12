# S3-I R1 contract brief: growth tranche 9

**Status:** R1. Local at `/workspace/sprint3i-brief.md` until committed on `enhancement/s3i-growth-t9` after the written merge-tip PASS.
**Base:** `origin/dev` @ `1cfe7b366d3998927b9c56fa32939460af528b95` (S3-H PR #53 merge, includes #49 and `0f5a1c6`), not pack tip `0f5a1c6`. **Seed:** `/workspace/sprint3i-seed.md`. **Pack:** `enhancement/s3i-growth-t9` (cut from this merge commit after the written merge-tip PASS).
**Leader rulings:** (a) cap each echoed array at 20 items and add top-level `truncated:<n>` · (b) missing `If-Match` on #40 → 428 `PRECONDITION_REQUIRED`; a stale ETag stays 412 · (c) vendor the Draco decoder, pinned and checksummed, with no CDN (amended for #59: the wasm is copied from three 0.187.0 at build time and checksummed against a committed manifest, not committed itself).

## 1. Global locks (unchanged)
- Probe wins. No media in git. `BLENDER_BIN` fails closed. `assetSchemaVersion` stays **3** (additive, optional only).
- Errors are flat `{code, error, ...extra}` with no absolute paths. INTERNAL → `"internal error"`. 400s may echo caller values; each client-echo string is ≤200 chars and a cap ends in `…` (S3-H D2). Mid-string zod excerpts are not required to be a prefix or end in `…` (NIT-H-5).
- Every new code goes in `docs/error-codes.md` (two-way test) **and** the S3-I section of `docs/contract-changelog.md`.
- Exactly 6 `SKIP_*` codes.
- **OpenAPI → 0.9.0** (new routes: `PATCH /api/assets/:id/nodes`, `POST /api/assets/bulk`, `PUT /api/assets/:id/preview`).
- **New code: `PRECONDITION_REQUIRED` (428) only.** `PRECONDITION_FAILED` (412) is reused.
- FULL PASS needs green push **and** pull_request CI on the final tip. PR only after FULL PASS. No force-push. Run `scan:secrets` before every push.
- There is no `/api/scenes` collection. Scenes are `stage=scene` assets. The seed's `/api/scenes/:id/…` sketches are replaced by the `/api/assets/:id/…` routes below.

## 2. IDs and lanes
E1 = CO-1 / 40 / 143 / 70 · E2 = 28 / 131 / 34 / 81 · E3 = CO-2 / CO-3 / 59 / 105.
**Tip1 = CO-1 + CO-2 + CO-3** (AC on its own). #40 server lands before any client use. #130 cull is the base for #131.

## 3. CO-1: per-array echo cap (E1)
- `ECHO_ITEMS_MAX` is a **constant 20**, not an env. `capEcho` already caps strings at 200 and depth at 8; it now also keeps only the first 20 items of every echoed array (`invalid[]`, `issues[]`, and any future echoed array).
- When any item is dropped, the body gains a top-level number `truncated` equal to the **sum of dropped items across all echoed arrays**. The field is absent when nothing is dropped. The body stays flat; no new code.
- **Tests:** a 10k-entry `invalid[]` returns 20 items plus `truncated: 9980`; two capped arrays sum their drops; strings inside still end in `…` and are ≤200.

## 4. #40: scene partial update (E1)
- New route `PATCH /api/assets/:id/nodes` with `{upsert:[node…], remove:[id…]}`, keyed by node id. At least one of `upsert` or `remove` must be a non-empty array, else 400 `VALIDATION {field:"upsert"}`.
- The asset must be `stage=scene`; any other stage → 400 `VALIDATION {field:"stage"}`. Nodes use the existing `SceneNodeSchema`. The result is checked with the same `validateSceneChildren` and live-node cap (`SCENE_NODES_MAX` / `SCENE_MAX_NODES`) as a full PATCH. Response is the updated doc plus the new strong `ETag`.
- `upsert` replaces a node of that id or appends it. `remove` **tombstones** (`deleted: true`), same as author Delete; unknown ids are no-ops. An id in both `upsert` and `remove` → 400 `VALIDATION {field:"remove", ids:[…]}` (`ids` is capped by CO-1). A duplicate id inside `upsert` → 400 `VALIDATION {field:"upsert"}`. A bad element → 400 `VALIDATION` with `field` `upsert[i].id` or `remove[i]`. Tombstoning the root → `SCENE_ROOT_DELETE`. Leaving no live nodes → `SCENE_NO_LIVE_NODES`. Purge of tombstones stays on the existing full `PATCH /api/assets/:id`.
- **`If-Match` is required on this route only.** Existing `PATCH`/`DELETE` `/api/assets/:id` (+ clip-ux) stay opt-in. Check order: 404 `NOT_FOUND` → 428 `PRECONDITION_REQUIRED` (header missing; body `{code, error}`; nothing written) → 400 `VALIDATION {field:"If-Match"}` (malformed) → 412 `PRECONDITION_FAILED {current}` (stale) → 400 body / scene codes → 200 + `ETag`.
- A successful patch records `scene.save`. CORS already exposes `ETag` and allows `If-Match`.
- **Tests:** 404; missing header → 428 and nothing written; stale → 412 and nothing written; match → 200 and a new ETag; overlap; duplicate upsert id; unknown `remove` is a no-op; not-a-scene; live-node cap; root / last-live tombstone.

## 5. #143: audit actor (E1)
- Additive optional `actor` on every non-ops activity entry (`asset.register`, `asset.patch`, `asset.delete`, `scene.save`, `scene.purge`, `pack.import`). Value is the literal `"local"` until #73 (API keys) lands — there is no key id today. Never a secret, never a path.
- Do not invent kinds `asset.purge` or `scene.delete`. `GET /api/activity?type=&before=` is unchanged aside from passing `actor` through. #146 backup already includes the jsonl.
- **Tests:** a register, a scene save, and a delete each persist `actor: "local"`; a read round-trips it; ops kinds (`inbox.sweep`, webhook.*) still have no `actor`.

## 6. #70: bulk register (E1)
- `POST /api/assets/bulk` with JSON `{zip:"inbox/<file>.zip"}`. The path is resolved with the existing path guard under `inbox/`. This is not a multipart upload and not a pack-import (#136 still has its own CLI).
- The zip may contain at most `BULK_MAX` (env, integer 1..100, default 20; bad value → `CONFIG_INVALID` at boot) `.glb` entries. Other entries are ignored. Zero GLB entries or more than `BULK_MAX` → 400 `VALIDATION {field:"entries"}`. Zip-slip, absolute names, or a path escaping the extract root → 400 `PATH_OUTSIDE_INBOX` for the whole request. A zip larger than `BULK_MAX * MAX_GLB_BYTES` → 413 `GLB_TOO_LARGE` for the whole request.
- Each GLB goes through the normal probe (#133 pool). Slug is the entry basename without `.glb`, run through the existing slug rules; id is a new UUID. `SLUG_CLASH` and `GLB_TOO_LARGE` on a single entry fail that entry only, as do `GLB_CORRUPT`, `MULTI_ARMATURE`, `VALIDATION` (empty slug or schema) and `INTERNAL` (all reuse existing codes; a failed row leaves nothing on disk). A missing, non-string, non-`.zip` or unreadable zip → 400 `VALIDATION {field:"zip"}`; a path outside `inbox/` → 400 `PATH_OUTSIDE_INBOX {field:"zip"}`. The slug is kebab-case, max 64 (`My Model_v2.GLB` → `my-model-v2`), and a repeat inside the zip is a `SLUG_CLASH` row. Created docs: with an armature, weights and all of idle/walk/run → `stage:"rigged"`, `characterType:"prop"`; otherwise `stage:"mvp-billboard"`, `characterType:"billboard"` (an armature that misses those gates fails schema → `VALIDATION` row), `tags:["bulk"]`, `license:"MIT"`; each success also emits the `asset.register` webhook. 200 body `{results:[{name, ok, id?, slug?, code?}]}` in zip order of the GLB entries. Echoed `name`s obey §3. Each success records `asset.register` (not `pack.import`).
- **Tests:** two GLBs → two ids; a clash fails only that row; zip-slip is refused and writes nothing; over `BULK_MAX` is 400; a bad `BULK_MAX` refuses boot.

## 7. #28: scene thumbnail (E2)
- On Save, the client captures an offscreen 256×256 PNG of the current view (an explicit `gl.render` then a square crop into a 2D canvas in the same task, so the live context never sets `preserveDrawingBuffer`; a failed capture never fails Save) and `PUT`s it to `/api/assets/:id/preview` as `image/png`. Stored at the existing `formats.preview` path (default `assets/<id>/preview.png`) under `WB_DATA_ROOT`, never in git. `GET /api/assets/:id/preview` already serves it.
- Only `stage=scene` is accepted (else 400 `VALIDATION {field:"stage"}`). A body that is not a 256×256 PNG → 400 `VALIDATION {field:"body"}`. A body over `THUMB_MAX_BYTES` (512 KiB, 524288 bytes) → 413 `PAYLOAD_TOO_LARGE`, raised by the body parser before the asset lookup, so it can come before a 404. `If-Match` is opt-in, same as #69. Order: 413 → 404 → 412 → 400 `stage` → 400 `body` → 200 `{id, bytes, preview}` + current `ETag`. No activity entry (no new kinds). The scene list card shows the image; when missing, the fallback is the scene initial on a neutral tile (`scene-thumb-fallback`).
- Offscreen capture and any pixel assertion run against **SwiftShader** on the Linux box (`--use-angle=swiftshader`), same renderer as the 3-H WebGL path.
- **Tests:** PUT then GET is byte-identical; a non-scene is 400; a non-PNG is 400; over 512 KiB is 413; the file is under `WB_DATA_ROOT`; the capture test is driven with SwiftShader.

## 8. #131: lazy-load child GLBs (E2)
- Nodes outside the frustum (#130) or past `SCENE_NODES_MAX/4` load on first visibility through drei `useGLTF` and Suspense. The placeholder is a wireframe bounds box (`lazy-placeholder`, mirrored in the DOM with `data-node-id`). The selected node (gizmo target) always loads immediately. The stats panel (#83) adds `Loaded n / total` (`stats-loaded`). No API change.
- **Tests:** a 256-node scene starts with fewer than 256 loaded; in-view nodes within the eager cap (`SCENE_NODES_MAX/4`) are never placeholders; in-view nodes past that cap may start as placeholders, but they still have to load without a camera move; turning a culled node into view, or selecting it, loads it.

## 9. #34: scene templates (E2)
- New Scene dialog offers "Blank", "Duo billboard", and "Rigged + prop". Picking a template opens the asset picker for each slot, built from the user's own assets (billboard slots list only billboards, the rigged slot only rigged assets; scenes are never offered). "Blank" has one slot, since the scene schema needs at least one node. Create stays disabled until every slot is filled and POSTs one `stage:"scene"` asset (reusing its first child's `formats.glb` path); Cancel sends nothing. No media is bundled. Templates are JSON (in `docs/` or client code) validated by the scene schema in a test.
- **Tests:** schema validation of every template; creating one requires a picked asset per slot; cancelling leaves no scene; Create makes exactly one scene with the right children.

## 10. #81: timeline markers (E2)
- Additive `clipUx.markers:[{clip, t, name}]` on the **asset** (not on `scene.nodes` — nodes have no `clipUx`). Cap 16, unique names, name 1..40, `clip` must be in `clips[]`, `t` is an integer ms in `[0, clipDurations[clip]]`. More than 16, or any bad marker → 400 `VALIDATION {field:"clipUx.markers"}`. A clip-ux PATCH without `markers` keeps the stored markers; `markers: []` clears them.
- Saved through the existing `PATCH /api/assets/:id/clip-ux` (opt-in `If-Match` from #69). The scrubber shows ticks; click jumps playback; double-click renames; at cap the hint is "16 of 16 markers" and Add is disabled.
- **Tests:** save and reload; the cap; a `t` past the duration is 400; a missing clip is 400.

## 11. CO-2: evidence tied to a SHA (E3)
- `tests/reporters/skip-summary.mjs` prints, as the **first line** of every s1, focused, and ui-repeat run: `HEAD=<sha> NODE=<version> RUN=<id|local>`, where `<sha>` is `git rev-parse HEAD`. Every `/workspace/pwt/` log and AC record cites that line. A doc test checks the reporter is wired.
- AC verdicts name the SHA and the CI run id, and only after that run has finished.
- **Tests:** a dry run's first line matches `git rev-parse HEAD`; the doc test fails if the reporter is unhooked.

## 12. CO-3: fuzz oracle follow-ups (E3)
- The oracle (i) fails a 400 whose echoed array is longer than 20 items or whose `truncated` is missing/wrong.
- (ii) applies only to the 200-character **client-echo** cap: a truncated echo ends in `…` and is a prefix of the sent value. It does **not** apply to mid-string zod excerpts (those failed this check in NIT-H-5).
- (iii) negative cases stay: raw 5k string, mid-string zod (the excerpt may come from the middle and need not end in `…` or be a prefix), and a >20-item array.
- (iv) one positive test each for the 2xx and server-written exemptions.
- **Tests:** those four cases are in the suite and fail if the cap or the exemptions regress.

## 13. #59: Draco compress flag (E3)
- `pipeline.sh --draco` (the `png_to_glb` step), **off by default**. A failed Draco export exits 4 and never falls back to an uncompressed GLB; no Draco encoder in Blender exits 6. The viewer decodes with a version-pinned, checksummed decoder served from `client/public/draco/` (`DRACO_PATH` `/draco/` on every `useGLTF`). The committed `public/draco/manifest.json` pins three 0.187.0 and a sha256 per decoder file; `draco-vendor.mjs` (a vite plugin, dev and build) copies three's own decoder into `public/draco/`, verifies the checksums, and fails with build-time code `DRACO_CHECKSUM` (listed in `docs/error-codes.md`) on a mismatch or a different three version. The decoder files are not committed (gitignored): the wasm comes from three 0.187.0 at dev and build time, and the vendor step also runs in CI on a fresh clone (Leader, amending (c)). No gstatic CDN. Do not call `DRACOLoader.setDecoderConfig()` (deprecated in three r185+).
- The probe reads compressed GLBs and reports `meshCompression`; clips, bones and weights match the plain export. #62 golden hashes cover **both** modes (`rigged` and `riggedDraco`, two hashes). Blender smoke without the encoder skips with `SKIP_PLATFORM` (no seventh skip code).
- **Tests:** `--draco` output is a smaller GLB the probe and viewer accept; the checksum test fails on a swapped binary; no CDN URL in our source; the browser test fails on any request to an outside Draco host; the vite plugin rewrites drei's unused default `gstatic.com/draco/versioned/decoders/<v>/` URL to `/draco/` at `renderChunk`, so the bundle holds no CDN URL; the bundle scan builds `dist` (or fails, never skips) and fails on any CDN hit (`gstatic`, `unpkg`, `jsdelivr`, same pattern as the source scan), with no allowlist.

## 14. #105: perf budget CI (E3)
- One `perf-budgets.json` (fixture GLB bytes, 256-node frame time in ms) at the repo root, documented in `docs/perf-budgets.md`; shipped values: `fixtureGlbBytes.rigged-synth` 4096 and `frame256Ms.budget` 250 ms (median over 120 frames after 30 warm-up, all 256 nodes in view; calibrated at medians 83.3/66.7/83.3 ms, about 3× headroom). `scripts/perf-budget.mjs` in the Node **24** `perf-budgets` CI job fails when a budget is exceeded and prints the budget, the actual, and the `HEAD=` line from §11. A frame-run timeout prints the loaded count it stalled at.
- The 256-node frame budget is a **SwiftShader** number on the Linux runner and box, not a native GPU budget, so it does not flake the way the broad WebGL filter did in 3-H.
- **Tests:** a planted over-budget fixture fails the job; the documented SwiftShader budgets pass on the runner.

## 15. Not in 3-I
Required `If-Match` on existing routes, API keys (#73) as `actor`, pack-import of schema zips (#136) via `/bulk`, multipart zip upload, purge via #40, node-level `clipUx`, a seventh `SKIP_*`, and moving fiber off `THREE.Clock`.

## 16. Open for D2 / Designer
CO-3 (ii)/(iii) and the SwiftShader notes on #28/#105 from D1 are folded in below. Still to re-sync in D1/D2:
- Routes live under `/api/assets/:id`, not `/api/scenes/:id`. #28 is `PUT /api/assets/:id/preview`, reusing the existing GET, not a new `/thumbnail`.
- #81 markers are `clipUx.markers:[{clip, t, name}]` on the asset, saved through clip-ux.
- #143 `actor` is `"local"` on the existing kinds; drop `asset.purge` / `scene.delete`.
- `ECHO_ITEMS_MAX` is a constant, so it is not a `CONFIG_INVALID` env. Only `BULK_MAX` is new env (1..100, default 20, in `.env.example` and `NON_CODES`).
- Copy already in D1 for the #28 fallback, #81 cap hint, and #131 "Loaded n / total" still stands. `PRECONDITION_REQUIRED` row in D2 is correct (428, `{code, error}`, nothing written).
