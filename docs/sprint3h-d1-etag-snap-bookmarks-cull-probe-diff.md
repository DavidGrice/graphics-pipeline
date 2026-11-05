# Sprint 3-H — D1

**Status:** DRAFT bound to R1 `/workspace/sprint3h-brief.md` (Leader cut a/b/c locked). Pack after S3-G merges: `enhancement/s3h-growth-t8`.
**Swap:** #63 already shipped → **#117** (probe diff in compare). R1 wins on conflict.
**Locks:** probe wins · no media in git · `BLENDER_BIN` fails closed · schema 3 · flat `{code, error}` · 6 `SKIP_*` · NIT-F-1 on every new popover · undo cap 100, reload clears history (E2 dev-5).
**OpenAPI:** 0.8.0. **New code (D2):** `PRECONDITION_FAILED` (412) only.

## §0 Carryovers
- **CO-1 / NIT-G-2:** recent imports by register time (see §1).
- **CO-2 / NIT-G-3:** UI tests own fixtures (see §9).
- NIT-F-1 placement: open below, flip above, clamp left `[8px, innerWidth − width − 8px]`, bottom sheet under 600px.

## §1 CO-1 — Recent imports never drop a fresh register (E1)
- Panel shows the 20 most recent registers by **register time** from `/api/activity` `asset.register` (#128), de-duped by `id`, skipping deleted/tombstoned, then hydrated via `GET /api/assets/:id`.
- Empty activity (fresh store) → fall back to `sort=-createdAt&limit=20`.
- AC: on a 40-fixture store with newer `createdAt`s, register one older-dated asset → it appears; a deleted asset does not. `data-testid`: `recent-import-row`.

### §1 addendum (NIT-H-1)
After hydrate, skip any asset with `deleted === true` (tombstone returns 200, not 404). A tip2 test tombstones a recent asset and asserts it leaves the panel.

### §1 addendum (NIT-H-2, Leader ruling)
Page `/api/activity` with `before` until there are 20 live (non-deleted) registers or the log ends, capped at **5 pages**. Each page uses the existing `limit=100` cap. Fall back to `sort=-createdAt&limit=20` only when the first page is empty (fresh store).

## §2 #69 — ETag / If-Match (E1 server, E2 client Save)
- Strong `ETag` on GET asset/scene and every successful PATCH (incl. scene save and `…/clip-ux`).
- **Opt-in (ruling a):** no `If-Match` = today. Mismatch → 412 `PRECONDITION_FAILED {current}`. `If-Match: *` matches any existing doc. Malformed → 400 `VALIDATION {field:"If-Match"}`. Order: 404 before 412 before body validation.
- **Client dialog copy:** title "This scene changed elsewhere"; body "Someone else saved while you were editing. Reload to take their version, or Cancel to keep editing (Save will fail again until you reload)."; primary **Reload** (replaces draft, clears undo per dev-5); secondary **Cancel**. No auto-merge.
- AC: two-tab Save shows the dialog; Reload clears undo. `data-testid`: `etag-reload-prompt`, `etag-reload`, `etag-cancel`.

## §3 #133 — Worker-thread GLB probe (E1)
- Pool via `PROBE_WORKERS` (1..8, default 2); bad → `CONFIG_INVALID` at boot. `PROBE_TIMEOUT_MS` default 30000 (≥1000).
- Byte-identical output; cache hits skip workers. Crash → existing `GLB_CORRUPT`; timeout → 500 `INTERNAL`; worker replaced, request never hangs.
- AC: `/api/health` answers within 200 ms during a probe.

## §4 #146 — Backup / restore (E1)
- `npm run backup -- <dir>` / `restore -- <dir>`: data root + activity jsonl + Mongo when up; `manifest.json` with relative paths and sha256.
- Non-empty target without `--force` → exit 2 `CONFIG_INVALID`. Hash mismatch or path escape → exit 2, nothing written. No symlinks, no absolute paths in output.

## §5 #2 — Clip speed (E2)
- Steps 0.25 / 0.5 / 1 / 1.5 / 2×; `[` / `]` step. URL only (`?speed=`); invalid → 1. Reduced motion still pauses autoplay; speed does not override.
- `data-testid`: `clip-speed`, `clip-speed-down`, `clip-speed-up`.

## §6 #30 — Snap-to-grid (E2)
- **Placement:** toggle + step select sit in the transform toolbar row, immediately after the translate/rotate/scale mode buttons (same dock rules as S3-C #82). Under 600px they wrap onto the next toolbar row; no floating popover.
- Toggle off by default; steps 0.1 / 0.25 / 0.5 / 1; session-local. Translate gizmo snaps each axis; batch move (#29) snaps the shared delta. One undo step. Rotate/scale do not snap in 3-H.
- `data-testid`: `snap-toggle`, `snap-step`.

## §7 #32 — Orbit bookmark cameras (E2)
- Up to 8 named views in additive optional `view.bookmarks:[{name, position, target}]`. Cap → 400 `VALIDATION {field:"view.bookmarks"}` (or existing `SCENE_CAMERAS_MAX` if that already covers it — D2 notes which). Name 1..40 chars, unique.
- **UI:** a "Cameras" button in the viewer chrome opens a popover (NIT-F-1: below, flip above, clamp, bottom sheet under 600px) listing bookmarks with Restore / Rename / Delete; footer "Save current view". Empty state: "No saved cameras yet". Cap reached disables Save and shows "8 of 8 cameras".
- Restore is not an undo step. Add/remove marks unsaved via the view compare.
- `data-testid`: `camera-bookmarks`, `camera-bookmark-item`, `camera-bookmark-save`, `camera-bookmark-restore`, `camera-bookmark-delete`.

## §8 #130 — Frustum-cull scene nodes (E2)
- Above `SCENE_NODES_MAX/4` live nodes, cull spheres outside the frustum. Stats (#83) show `drawn / total`. On-screen nodes always drawn; bounds include the gizmo target.
- `data-testid`: `stats-drawn`, `stats-total`.

## §9 CO-2 — UI tests own their fixtures (E3)
- Shared `tests/helpers/registerFixture.mjs`. Lint in `lint:ci` fails any UI test targeting an asset it didn't create. **Ruling (b):** populated-store UI pass on Node 24 only (seed 40, run UI once).

## §10 #101 — Contract fuzz (E3)
- Exact-pinned `fast-check`. Fuzz register, PATCH asset, PUT featured, pack import. Every response flat documented code, no absolute path/stack. CI fixed seed; local random unless `FUZZ_SEED`. Failure prints `FUZZ_SEED=<n>` + shrunk counterexample. Default 200 runs/route, `FUZZ_RUNS` overrides. Both envs in `NON_CODES`. **Ruling (c).**

## §11 #117 — Diff two probes (E3, extends #84)
- In `?compare=a,b`, a "What changed" list: tris, bones, clips added/removed, `clipRequires`, size, `characterType`. Client-only from existing GETs. Identical → "No differences".
- **Layout at 390px:** the list sits below the stacked viewports and above the existing diff table, full width, as a collapsible `<details>` open by default (`data-testid: compare-probe-diff`). Same NIT-F-1 bottom-sheet rules if any control opens a popover. No second horizontal scroll.
- AC: pure-function unit tests + one UI check.

## §12 #43 — Firstparty-default docs (E3)
- `docs/` + `AGENTS.md`: box AC uses `BRIDGE=firstparty`, CI uses `BRIDGE=mock`. Doc test checks named envs/scripts exist. Mermaid lint on new diagrams.

## AC hooks (testid index)
`recent-import-row` · `etag-reload-prompt` · `etag-reload` · `etag-cancel` · `clip-speed` · `clip-speed-down` · `clip-speed-up` · `snap-toggle` · `snap-step` · `camera-bookmarks` · `camera-bookmark-item` · `camera-bookmark-save` · `camera-bookmark-restore` · `camera-bookmark-delete` · `stats-drawn` · `stats-total` · `compare-probe-diff`.

## Leader rulings (cut 2026-11-04)
- (a) If-Match **opt-in**.
- (b) Populated-store UI pass on **Node 24 only**.
- (c) Exact-pinned `fast-check`; log seed on fuzz fail.

## Not in 3-H (R1 §15)
Rotate/scale snap · auto-merge on 412 · required If-Match · Mongo-only backup · worker probe for Blender exports.
