# S3-H R1 contract brief: growth tranche 8

**Status:** Bound for pack `enhancement/s3h-growth-t8`. Seed: `/workspace/sprint3h-seed.md` (local).
**Base:** `origin/dev` after the S3-G merge (pack head `c001a3c`, plus the NIT-G-4 fix). **Seed:** `/workspace/sprint3h-seed.md`.
**Leader rulings:** (a) `If-Match` opt-in · (b) populated-store UI pass on Node 24 only · (c) `fast-check` exact-pinned devDependency; a failing fuzz test logs its seed.
**Swap:** #63 `--seed` already shipped (`png_to_glb.py --seed`, S3-C), so it's replaced by **#117 diff two probes**, which extends #84 compare.

## 1. Global locks (unchanged)
- Probe wins. No media in git. `BLENDER_BIN` fails closed. `assetSchemaVersion` stays **3** (additive, optional only).
- Errors are flat `{code, error, ...extra}` with no absolute paths. INTERNAL → `"internal error"`.
- Every new code goes in `docs/error-codes.md` (two-way test) **and** the S3-H section of `docs/contract-changelog.md` (#148 test, `changelog:verify`).
- Exactly 6 `SKIP_*` codes.
- **OpenAPI → 0.8.0** (#69 adds headers and a 412 to existing routes). No new routes.
- **New code: `PRECONDITION_FAILED` (412) only.**
- FULL PASS needs green push **and** pull_request CI on the final tip. PR only after FULL PASS. No force-push. Run `scan:secrets` before every push.

## 2. IDs and lanes
E1 = CO-1 / 69 / 133 / 146 · E2 = 2 / 30 / 32 / 130 · E3 = CO-2 / 101 / 117 / 43.
**Tip1 = CO-1 + CO-2.** #69 server lands before the client Save change.

## 3. CO-1: recent imports never drop a fresh register (E1, client + server)
- The panel lists the 20 most recent registers by **register time**, not `createdAt`. Source: `/api/activity` `asset.register` entries (#128), de-duplicated by `id`, skipping assets that are gone (deleted or tombstoned), then hydrated with `GET /api/assets/:id`.
- A register appears on the next refresh even when 20+ assets have a newer `createdAt`.
- No new route or param. If the activity log is empty (fresh store), fall back to today's `sort=-createdAt&limit=20`.
- **Tests:** a populated store (40 fixtures, newer `createdAt`), register one older-dated asset, and it shows. A deleted asset doesn't show.

## 4. #69: ETag / If-Match (E1 server, E2 client Save)
- `GET /api/assets/:id` and every successful `PATCH /api/assets/:id` (including scene saves) return a strong `ETag: "<sha256 of canonical stored doc, first 32 hex>"`. `PATCH .../clip-ux` returns the new ETag too.
- **Opt-in:** a `PATCH`/`DELETE` without `If-Match` behaves exactly as today.
- With `If-Match` that doesn't match the current ETag → **412 `{code:"PRECONDITION_FAILED", error, current}`**, where `current` is the current ETag string. Nothing is written. `If-Match: *` matches any existing doc.
- A malformed `If-Match` (not a quoted string or `*`) → 400 `VALIDATION {field:"If-Match"}`.
- Order: 404 `NOT_FOUND` before 412. 412 before body validation.
- The ETag is stable across reads (canonical key order) and changes on any stored change.
- CORS: `ETag` is in `Access-Control-Expose-Headers`, and `If-Match` is in the allowed headers.
- **Client:** Save sends `If-Match` with the ETag from the last load. On 412 it shows "This scene changed elsewhere" with Reload (replaces the draft, clears undo per S3-G dev-5) and Cancel. No auto-merge.
- **Tests:** unchanged behaviour without the header, match → 200 and a new ETag, stale → 412 and nothing written, `*`, malformed → 400, 404 before 412, the two-tab UI case.

## 5. #133: worker-thread GLB probe (E1)
- Probing runs in a `worker_threads` pool. `PROBE_WORKERS` int 1..8, default 2. A bad value → `CONFIG_INVALID` at startup.
- Output is byte-identical to the in-process probe. `PROBE_VERSION` and the cache key are unchanged, so a cache hit never touches a worker.
- A worker crash or a timeout (`PROBE_TIMEOUT_MS`, default 30000, int ≥1000) → the existing `GLB_CORRUPT` path for a crash, or 500 `INTERNAL` for a timeout. The worker is replaced and the request never hangs.
- **Tests:** identical output for the golden fixtures. The event loop answers `/api/health` within 200 ms during a probe. Crash and timeout cases.

## 6. #146: backup / restore (E1, scripts)
- `npm run backup -- <dir>` copies the files under `WB_DATA_ROOT` (assets, scenes, `activity*.jsonl`), plus a Mongo export when Mongo is up, and writes `manifest.json {version:1, createdAt, files:[{path, sha256, bytes}]}` with relative paths only.
- `npm run restore -- <dir>` refuses a non-empty `WB_DATA_ROOT` unless `--force` (exit 2, `CONFIG_INVALID`). It verifies every sha256 before writing anything. A mismatch or a path escaping the root → exit 2, `CONFIG_INVALID`, and nothing written.
- Never follows symlinks. No absolute paths in output.
- **Tests:** a round-trip is byte-identical, a tampered file is refused, `../` in the manifest is refused, and so is a non-empty target without `--force`.

## 7. #2: clip speed (E2)
- The viewer offers 0.25, 0.5, 1, 1.5 and 2×. `[` and `]` step it. It's held in the URL as `?speed=` only. An invalid value means 1, with no error.
- Applies to `AnimationMixer.timeScale`. Reduced motion (#90) still pauses autoplay, and speed doesn't override that.
- No API change. **Test:** URL round-trip, keys, clamp.

## 8. #30: snap-to-grid (E2)
- Toggle (off by default) plus a step of 0.1, 0.25, 0.5 or 1. Session-local.
- The translate gizmo snaps each axis to the step. A batch move (#29) snaps the shared delta, not each node.
- A snapped move is one undo step (#36). Rotate and scale don't snap in 3-H.
- **Test:** a drag lands on a multiple of the step, and a batch keeps the relative offsets.

## 9. #32: orbit bookmark cameras (E2)
- Up to 8 named views per scene, in the existing scene `view` object as additive optional `bookmarks:[{name, position, target}]`. Schema stays 3.
- More than 8 → 400 `VALIDATION {field:"view.bookmarks"}` (no new code; `SCENE_CAMERAS_MAX` applies if that's the existing limit, in which case reuse it and say so in D2). Name 1..40 characters, unique.
- Restoring a bookmark isn't an undo step. Adding or removing one marks the scene unsaved through the view compare (dev-3).
- **Test:** save and reload, the cap, unique names.

## 10. #130: frustum-cull scene nodes (E2)
- Above `SCENE_NODES_MAX/4` live nodes, nodes whose bounding sphere is outside the frustum aren't drawn. Below that, there's no change.
- The stats panel (#83) shows `drawn / total`.
- No visible change on screen: nodes in view are always drawn, and bounds include the gizmo target.
- **Test:** a 256-node scene with the camera facing away draws fewer than total, and turning back draws all of them in view.

## 11. CO-2: UI tests own their fixtures (E3)
- A shared `tests/helpers/registerFixture.mjs` registers an asset with its own GLB and removes it afterwards.
- A lint check (in `lint:ci`) fails any UI test that targets an asset id or slug it didn't create through the helper.
- CI adds a **populated-store UI pass on Node 24 only**: seed 40 fixtures, then run the UI suite once.
- **Test:** the lint flags a planted hard-coded id, and every UI test passes on a populated store.

## 12. #101: contract fuzz tests (E3)
- `fast-check`, pinned to an exact version as a devDependency.
- Fuzz register, `PATCH /api/assets/:id`, `PUT /api/featured` and pack import with dishonest payloads.
- Every response is either success or a flat `{code, error}` whose code is in `docs/error-codes.md`, with no absolute path and no stack.
- CI uses a fixed seed. Locally it's random unless `FUZZ_SEED` is set. **A failure prints `FUZZ_SEED=<n>`** and the shrunk counterexample. Default 200 runs per route, `FUZZ_RUNS` overrides.
- `FUZZ_SEED` and `FUZZ_RUNS` go in `NON_CODES`.

## 13. #117: diff two probes (E3, extends #84)
- In `?compare=a,b`, the side panel adds a "What changed" list: tris, bones, clips added or removed, `clipRequires` changes, size, `characterType`.
- Computed in the client from the existing GETs. No API.
- Identical probes show "No differences".
- **Test:** pure-function unit tests, plus one UI check.

## 14. #43: firstparty-default docs (E3)
- `docs/` and `AGENTS.md` say: Linux box AC uses `BRIDGE=firstparty`, and CI uses `BRIDGE=mock`.
- A doc test checks that every env and npm script named there exists.
- Mermaid lint covers any new diagram.

## 15. Not in 3-H
Rotate and scale snap, auto-merge on 412, required `If-Match`, Mongo-only backup, and worker probe for Blender exports.

## 16. Open for D2 / Designer
- #69 412 dialog copy. #32 bookmark UI and the NIT-F-1 popover rule. #30 grid control placement. #117 panel layout at 390 px.
- `PRECONDITION_FAILED` row in D2 codes, plus envs `PROBE_WORKERS`, `PROBE_TIMEOUT_MS`, `FUZZ_SEED`, `FUZZ_RUNS`.
