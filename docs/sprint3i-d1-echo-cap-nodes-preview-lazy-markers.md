# Sprint 3-I — D1: echo cap, scene PATCH, audit, bulk, thumbnails, lazy GLBs, templates, markers, evidence, oracle, Draco, perf

**Status:** DRAFT bound to R1 `/workspace/sprint3i-brief.md` (pack path `docs/sprint3i-brief.md`). Pack: `enhancement/s3i-growth-t9`, cut from S3-H merge `1cfe7b366d39` on `dev`. Schema stays **3**. OpenAPI **0.9.0**. Exactly 6 `SKIP_*`. There is no `/api/scenes` collection; scenes are `stage=scene` assets.

## §1 CO-1 per-array echo cap (E1)
- `ECHO_ITEMS_MAX` is a **constant 20**, not an env. `capEcho` already caps strings at 200 and depth at 8; it now also keeps the first 20 items of every echoed array (`invalid[]`, `issues[]`, and any future echoed array).
- When any item is dropped, add top-level numeric `truncated` equal to the **sum of dropped items across all echoed arrays**. Absent when nothing is dropped. Body stays flat `{code, error, ...extra}`; no new code.
- A 10k-entry `invalid[]` returns 20 items plus `truncated: 9980`. Strings inside still end in `…` and are ≤200.

## §2 #40 scene partial update (E1)
- New route `PATCH /api/assets/:id/nodes` with `{upsert:[node…], remove:[id…]}`, keyed by node id. At least one of `upsert` or `remove` must be a non-empty array, else 400 `VALIDATION {field:"upsert"}`.
- Asset must be `stage=scene`; any other stage → 400 `VALIDATION {field:"stage"}`. Nodes use existing `SceneNodeSchema`. The result is checked with the same `validateSceneChildren` and live-node cap (`SCENE_NODES_MAX` / `SCENE_MAX_NODES`) as a full PATCH. Response is the updated doc plus the new strong `ETag`.
- `upsert` replaces a node of that id or appends it. `remove` **tombstones** (`deleted: true`), same as author Delete; unknown ids are no-ops. An id in both `upsert` and `remove` → 400 `VALIDATION {field:"remove"}`. Tombstoning the root → `SCENE_ROOT_DELETE`. Leaving no live nodes → `SCENE_NO_LIVE_NODES`. Purge of tombstones stays on the existing full `PATCH /api/assets/:id`.
- **`If-Match` is required on this route only.** Existing `PATCH`/`DELETE` `/api/assets/:id` and clip-ux stay opt-in. Check order: 404 `NOT_FOUND` → 428 `PRECONDITION_REQUIRED` (header missing; body `{code, error}`; nothing written) → 400 `VALIDATION {field:"If-Match"}` (malformed) → 412 `PRECONDITION_FAILED {current}` (stale) → 400 body / scene codes → 200 + `ETag`.
- A successful patch records `scene.save`.
- As shipped (`752a060`): a duplicate id inside `upsert` → 400 `VALIDATION {field:"upsert"}`; a non-node `upsert[i]` → `{field:"upsert[i].id"}`; a non-string `remove[i]` → `{field:"remove[i]"}`; the overlap 400 also echoes `ids:[…]` (capped per §1). A child that fails `validateSceneChildren` → 400 `SCENE_RESOLVE`, same as the full PATCH.

## §3 #143 audit actor (E1)
- Additive optional `actor` on every non-ops activity entry: `asset.register`, `asset.patch`, `asset.delete`, `scene.save`, `scene.purge`, `pack.import`. Value is the literal `"local"` until #73 (API keys) lands — there is no key id today. Never a secret, never a path.
- Do not invent kinds `asset.purge` or `scene.delete`. `GET /api/activity?type=&before=` is unchanged aside from passing `actor` through. #146 backup already includes the jsonl. Ops kinds (`inbox.sweep`, webhook.*) have no `actor`. As shipped (`a61a8bb`): older jsonl lines are not back-filled and have no `actor`; on read a stored `actor` must be a short token (`[a-z0-9_.-]{1,32}`), else it is dropped.

## §4 #70 bulk register (E1)
- `POST /api/assets/bulk` with JSON `{zip:"inbox/<file>.zip"}`. Path is resolved with the existing path guard under `inbox/`. Not a multipart upload and not a pack-import (#136 keeps its own CLI).
- At most `BULK_MAX` (env, integer 1..100, default 20; bad value → `CONFIG_INVALID` at boot) `.glb` entries; other entries are ignored. Zero GLB entries or more than `BULK_MAX` → 400 `VALIDATION {field:"entries"}`.
- Zip-slip, absolute names, or a path escaping the extract root → 400 `PATH_OUTSIDE_INBOX` for the whole request. A zip larger than `BULK_MAX * MAX_GLB_BYTES` → 413 `GLB_TOO_LARGE` for the whole request.
- Each GLB goes through the normal probe (#133 pool). Slug is the entry basename without `.glb`, existing slug rules; id is a new UUID. `SLUG_CLASH` and `GLB_TOO_LARGE` on a single entry fail that entry only. 200 body `{results:[{name, ok, id?, slug?, code?}]}` in zip order of the GLB entries. Echoed `name`s obey §1. Each success records `asset.register` (not `pack.import`).
- As shipped (`a61a8bb`): whole-request `VALIDATION {field:"zip"}` when `zip` is missing, not a string, not `.zip`, not found under `inbox/`, or not a readable archive; a `zip` path outside `inbox/` → 400 `PATH_OUTSIDE_INBOX {field:"zip"}`. Zip-slip is checked on every entry, GLB or not. The 413 body adds `{sizeBytes, maxBytes}`. Per-entry codes: `SLUG_CLASH`, `GLB_TOO_LARGE`, `GLB_CORRUPT`, `MULTI_ARMATURE`, `VALIDATION` (empty slug, or the asset fails schema, e.g. an armature without `idle`/`walk`/`run`), `INTERNAL`; failed rows echo `slug` when one was derived. Slug is kebab-case, at most 64 chars (`My Model_v2.GLB` → `my-model-v2`); a repeat inside the zip is a `SLUG_CLASH` row. Rigged GLBs (armature, weights, `idle`/`walk`/`run`) get `stage:"rigged"`, `characterType:"prop"`; others `stage:"mvp-billboard"`, `characterType:"billboard"`; assets get `tags:["bulk"]`, license `MIT`, and fire the `asset.register` webhook like a normal register.

## §5 #28 scene thumbnail (E2)
- On Save, offscreen 256×256 PNG of the current view (`preserveDrawingBuffer` only for the capture), `PUT /api/assets/:id/preview` as `image/png`. Stored at the existing `formats.preview` path (default `assets/<id>/preview.png`) under `WB_DATA_ROOT`, never in git. `GET /api/assets/:id/preview` already serves it.
- Only `stage=scene` is accepted (else 400 `VALIDATION {field:"stage"}`). A body that is not a 256×256 PNG → 400 `VALIDATION {field:"body"}`. `If-Match` is opt-in, same as #69.
- As shipped (`815b0c0`): body cap `THUMB_MAX_BYTES` = 512 KiB (524288 bytes); larger → 413 `PAYLOAD_TOO_LARGE` from the body parser, **before** the 404. Order: 413 → 404 → opt-in `If-Match` (412) → 400 `{field:"stage"}` → 400 `{field:"body"}`. Only `Content-Type: image/png` is read; anything else is an empty body → 400 `{field:"body"}`. The PNG check is signature, IHDR (with CRC), 256×256 and a trailing IEND; pixels are never decoded. A stored `formats.preview` that fails the path guard → 400 with the guard's code and `field:"formats.preview"`. 200 body `{id, bytes, preview}` plus the current `ETag`; the asset doc changes only when `formats.preview` was empty or not a `.png`. No activity entry.
- Offscreen capture and any pixel assertion run against **SwiftShader** on the Linux box (`--use-angle=swiftshader`), same renderer as the 3-H WebGL path.
- Scene list card shows the image; when missing, the fallback is the scene initial on a neutral tile. Test ids: `scene-thumb`, `scene-thumb-fallback`.

## §6 #131 lazy child GLBs (E2)
- Out-of-frustum (#130) or past the eager cap (`SCENE_NODES_MAX/4`) nodes load on first visibility via `useGLTF` + Suspense; placeholder is a wireframe bounds box.
- In-view nodes within the eager cap are never placeholders. In-view nodes past that cap may start as placeholders, but they still load without a camera move. A culled node loads when it is turned into view.
- Stats panel line "Loaded n / total". Test ids: `lazy-placeholder`, `stats-loaded`. No API change.

## §7 #34 scene templates (E2)
- New Scene dialog: "Blank", "Duo billboard", "Rigged + prop". Picking a template opens the asset picker for each slot, built from the user's own assets; no bundled media.
- Templates are JSON (in `docs/` or client code) validated by the scene schema in a test. Test ids: `template-option`, `template-slot-pick`, `template-create`.

## §8 #81 timeline markers (E2)
- Additive `clipUx.markers:[{clip, t, name}]` on the **asset** (not on `scene.nodes` — nodes have no `clipUx`). Cap 16, unique names, name 1..40, `clip` must be in `clips[]`, `t` is an integer ms in `[0, clipDurations[clip]]`. More than 16 → 400 `VALIDATION {field:"clipUx.markers"}`.
- As shipped (`815b0c0`): every bad marker (not an array, over 16, bad/duplicate name, clip not in `clips[]`, a clip with no probed duration, `t` not an integer ≥0 or past the clip's duration) → 400 `VALIDATION {field:"clipUx.markers"}`. A clip-ux PATCH that leaves out `markers` keeps the stored markers; `markers: []` clears them. Schema stays 3.
- Saved through the existing `PATCH /api/assets/:id/clip-ux` (opt-in `If-Match` from #69). Ticks on the scrubber; click jumps playback; double-click renames; at cap "16 of 16 markers" (Add disabled).
- Test ids: `timeline-marker`, `timeline-marker-add`, `timeline-marker-delete`.

## §9 CO-2 evidence tied to a SHA (E3)
- `tests/reporters/skip-summary.mjs` prints first line `HEAD=<sha> NODE=<version> RUN=<id|local>` on s1, focused and ui-repeat, where `<sha>` is `git rev-parse HEAD`. Every `/workspace/pwt/` log and AC record cites that line. A doc test checks the reporter is wired.
- AC verdicts name the SHA and the CI run id, and only after that run has finished.

## §10 CO-3 oracle notes (E3)
- (i) oracle fails a 400 with any echoed array >20 items or a missing/wrong `truncated`.
- (ii) applies only to the 200-character **client-echo** cap: a truncated echo ends in `…` and is a prefix of the sent value. It does **not** apply to mid-string zod excerpts (those failed this check in NIT-H-5).
- (iii) negative cases stay: raw-5k string, mid-string zod (excerpt may come from the middle and need not end in `…` or be a prefix), >20-item array.
- (iv) one positive test each for the 2xx and server-written exemptions.

## §11 #59 Draco (E3)
- `png_to_glb --draco`, off by default. Viewer uses the **vendored, pinned, checksummed** decoder in `client/public/draco/` (wasm is code, not media); no CDN. Don't call `DRACOLoader.setDecoderConfig()` (deprecated r185+). A test checks the checksum; a build or test must not fetch a CDN decoder.
- Probe reads compressed GLBs. #62 golden hashes cover **both** modes (two hashes, not one). Blender smoke without the encoder skips with an existing `SKIP_*` (no seventh skip code).

## §12 #105 perf budget CI (E3)
- One `perf-budgets.json` (fixture GLB bytes, 256-node frame ms) with a doc line in `docs/`. Node 24 job only; failure prints budget, actual and the `HEAD=` line from §9.
- The 256-node frame budget is a **SwiftShader** number on the Linux runner and box, not a native GPU budget, so it does not flake the way the broad WebGL filter did in 3-H.

## Rulings applied
(a) 20 items + `truncated` · (b) missing If-Match → 428, stale → 412 · (c) Draco vendored, pinned, checksummed.

## Tip order
Tip1 = CO-1 + CO-2 + CO-3 (own AC). #40 server before client use. #130 cull is the base for #131.
