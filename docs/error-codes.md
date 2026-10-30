# Error codes (S3-D #152)

Layout per D2 §3 (`docs/sprint3d-d2-alttext-history-errorcodes.md`), bound to R1 rev2 §0/§12.

- **Body shape (R1 §0):** every 4xx/5xx JSON body is flat and back-compatible:
  `{ "code": "UPPER_SNAKE", "error": "<human text>", ...extra }`. No body ever carries an absolute
  filesystem path (repo-relative `rel` only); 500 bodies are always `{"code":"INTERNAL","error":"internal error"}`.
- **CLI lines:** one line `ERROR <CODE>: <text>` on stderr, no stack, no absolute path.
- **Kept honest by** `tests/s3d-error-codes.test.mjs`, which fails in both directions: a code raised in
  `apps/`, `packages/`, `scripts/` (or the #104 skip reporter) that is missing here fails, and a code
  listed here that no longer exists in source fails.

Every group uses the same columns: `code | HTTP / exit | where raised | meaning | fix hint`. Rows are
alphabetical within a group. A code can appear in more than one group (e.g. API status and CLI exit).

### 1. Generic

| code | HTTP / exit | where raised | meaning | fix hint |
|---|---|---|---|---|
| `CONFIG_INVALID` | exit 1 (API start) | `server/src/index.js` startup via `server/src/security.js` (`RATE_LIMIT_PER_MIN`, `CORS_ORIGINS`, `TRUST_PROXY`, `MAX_GLB_MB`, `SCENE_MAX_NODES`) | Fail-closed start: an env var is invalid. The one-line `FATAL CONFIG_INVALID: <VAR> …` names the variable, never its value | Fix the named variable (`RATE_LIMIT_PER_MIN` integer ≥ 1; `CORS_ORIGINS` exact `scheme://host[:port]` origins, never `*`; `TRUST_PROXY` 0/1) |
| `CORS_ORIGIN_DENIED` | 403 | `server/src/security.js` `corsAllowlist` (preflight `OPTIONS` only) | Preflight from an origin not in `CORS_ORIGINS`; no `Access-Control-Allow-Origin` header. Simple requests from such an origin are processed but get no ACAO | Add the exact origin to `CORS_ORIGINS` (default `http://localhost:5173,http://127.0.0.1:5173`) |
| `INTERNAL` | 500 | `server/src/errors.js` `sendInternal` (sendFile errors, last-resort handler) | Unexpected server error; body text is always the fixed string "internal error" | Read the API log line `[world-builder] INTERNAL <METHOD> <route> code=…` for the real cause |
| `INVALID_JSON` | 400 | `server/src/index.js` body-parser error middleware | Request body is not valid JSON | Send `Content-Type: application/json` with a well-formed body |
| `KRITA_DOWN` | 503 | `GET /api/health` with strict Krita health | Strict Krita check failed; body has no tool paths and no `dataRoot` | Start Krita + the bridge, or unset `HEALTH_STRICT_KRITA` |
| `NOT_FOUND` | 404 | unknown asset id, unknown route, `/api/openapi.*` | Resource or route does not exist | Check the id / path; list with `GET /api/assets` |
| `OPENAPI_PARSE` | 500 | `server/src/openapi.js` | `docs/openapi.yaml` failed to parse | Fix the YAML (the S3-C OpenAPI gate test shows the parse error) |
| `PAYLOAD_TOO_LARGE` | 413 | body-parser error middleware | JSON body larger than the express limit | Send a smaller body; GLBs go on disk, not in JSON |
| `RATE_LIMITED` | 429 | `server/src/security.js` `rateLimiter` (POST/PUT/PATCH/DELETE under `/api/`, per client IP) | Token bucket of `RATE_LIMIT_PER_MIN` (default 60) is empty; body `{retryAfterSec}` + `Retry-After` header (whole seconds ≥ 1). GET/HEAD/OPTIONS never throttled. Client = socket address; with `TRUST_PROXY=1` the right-most `X-Forwarded-For` entry (the one the proxy appended); path match is case-insensitive (`/API/` is limited too), so behind the Vite dev proxy every browser shares one 127.0.0.1 bucket (accepted) | Wait `retryAfterSec` (the UI shows a countdown); raise `RATE_LIMIT_PER_MIN` for bulk imports |
| `VALIDATION` | 400 | POST/PATCH asset, list query (`stage`, `sort`, `limit` 1–100), schema issues without a specific code | Body or query failed validation; `{issues}` carries Zod issues | Fix the field named in `issues[].path` / `error` |

### 2. Scene / V-codes

| code | HTTP / exit | where raised | meaning | fix hint |
|---|---|---|---|---|
| `DUPLICATE_MAX_NODES` | client only | `client/src/s3cViewer.ts` scene author Duplicate | Scene already has the maximum node count (`maxNodes`) | Delete a node before duplicating |
| `DUPLICATE_NO_SOURCE` | client only | `client/src/s3cViewer.ts` scene author Duplicate | Selected node no longer exists | Reselect a node and retry |
| `SCENE_CAMERAS_MAX` | 400 | schema issue → `codeFromIssues` (POST/PATCH `scene.cameras`) | More than 16 camera bookmarks | Delete bookmarks (max 16) |
| `SCENE_NODES_MAX` | 400 | POST/PATCH stage=scene (`server/src/index.js` `sendSceneCapError`), after schema | More than `SCENE_MAX_NODES` (default 256) **live** nodes; body `{max, count}`. Tombstones (`deleted: true`) don't count (Leader ruling). Restoring a tombstone over the cap hits this too | Delete or purge nodes; the author shows `Nodes n / max` and disables Add / Duplicate / Restore at the cap |
| `SCENE_NO_LIVE_NODES` | 400 | schema issue → `codeFromIssues` (POST/PATCH `scene.nodes`) | Every node is tombstoned; a scene needs at least one live node | Restore a node (the author disables Delete on the last live node) |
| `SCENE_RESOLVE` | 400 | POST/PATCH stage=scene (`sceneResolve.js`) | A scene child failed V4/V4a/V5/V6b/V8; message carries the V-code | See the V-code rows below |
| `SCENE_ROOT_DELETE` | 400 | schema issue → `codeFromIssues` (POST/PATCH `scene.rootId`) | The `rootId` node is tombstoned; the root can't be deleted | Set another root first (the author disables Delete on the root) |
| `V1` | client / 400 | scene author, schema | A scene must keep at least one node | Add a node before removing the last one |
| `V4` / `V4a` | 400 `SCENE_RESOLVE` | `sceneResolve.js` | V4: child assetId (id or slug) unknown. V4a: slug matches more than one asset (ambiguous; never picks the first) | Use the asset id; the scene author lists the conflicting assets as buttons |
| `V5` | 400 `SCENE_RESOLVE` | `sceneResolve.js` | Nested scene: a child is itself stage=scene | Reference rigged/billboard assets only |
| `V6b` | 400 `SCENE_RESOLVE` | `sceneResolve.js` | Node defaultClip is not one of the child's clips | Pick a clip the child actually has |
| `V8` | 400 `SCENE_RESOLVE` | `sceneResolve.js` | Child record has a missing / corrupt stage | Re-register the child asset |

### 3. Asset

| code | HTTP / exit | where raised | meaning | fix hint |
|---|---|---|---|---|
| `ALT_TEXT_TOO_LONG` | 400 | POST / PATCH `altText` (#88); body has `{length, max}` | Alt text over 280 characters after trimming | Shorten to ≤ 280; `""` clears it |
| `ARMATURE_COUNT` | 400 | schema issue → `codeFromIssues` | `rig.armatureCount` must be 1 with `hasArmature`, 0 without | Re-probe the GLB (`register_asset.mjs`) |
| `ASSET_IN_USE` | 409 | `DELETE /api/assets/:id`; body has `{refs, deletedRefs}` | A stage=scene asset still references this asset. S3-E #41: tombstoned (`deleted: true`) nodes still block; `deletedRefs` lists scenes whose only references are tombstones (UI: "Used by deleted nodes in <scene>, purge to free") | Remove it from those scenes first, or Purge deleted nodes and Save |
| `FILE_MISSING` | 404 | `GET /api/assets/:id/file` / `preview`; body has `{rel, assetId}` (repo-relative) | Asset JSON exists but its file is not on disk (orphan) | Re-run the pipeline / restore `data/assets/<id>/` |
| `GLB_CORRUPT` | viewer card | viewer preflight (`s3dErrors.ts`), `probe_glb.mjs` | GLB has bad magic, is truncated or has unparsable JSON | Re-export the GLB; CLI exit 5 below |
| `GLB_TOO_LARGE` | 413 | POST asset (before schema/probe); body has `{sizeBytes, maxBytes}` | GLB larger than `MAX_GLB_MB` (default 100) | Decimate / compress, or raise `MAX_GLB_MB` |
| `HUMANOID_BONE_COUNT` | 400 | schema issue → `codeFromIssues` | characterType humanoid needs `rig.boneCount` ≥ 8 | Use a full humanoid rig or another characterType |
| `MONGO_REQUIRED` | 503 | `GET /api/assets` when `MONGO_REQUIRED=1` and Mongo is down | Strict Mongo mode, no in-memory fallback | Start Mongo or unset `MONGO_REQUIRED` |
| `MULTI_ARMATURE` | 400 | schema issue → `codeFromIssues`; `probe_glb.mjs` | More than one armature in one GLB | Split into one GLB per armature |
| `PATCH_FORBIDDEN_FIELD` | 400 | PATCH asset | Tried to PATCH formats, clips, rig, stage, id, slug or clipDurations | Re-register instead of patching those fields |
| `PATH_OUTSIDE_INBOX` | 400 | `pathGuard.js` `resolveUnder` (every DATA_ROOT path, sourcePng under `inbox/`) | `..`, absolute, encoded, NUL or symlink escape; the path is never echoed | Use a repo-relative path under `data/` (`data/inbox/` for sources) |
| `SCHEMA_VERSION_DECREMENT` | 400 | PATCH asset | `assetSchemaVersion` would go down | Keep or raise the version |
| `SLUG_CLASH` | 409 | POST asset (#127); body has `{slug, existingId, suggestedSlug}` | Slug already owned by a different id | Use `suggestedSlug` (first free `<slug>-2`, `-3`, …); same id re-register is fine |

### 4. Import warnings

Warn-only entries in `importMeta.warnings[]` (`{code, message?, detail?, clip?}`); registration succeeds.

| code | HTTP / exit | where raised | meaning | fix hint |
|---|---|---|---|---|
| `IDLE_TPOSE_SUSPECT` | warn-only | `probe_glb.mjs` (`register_asset.mjs`) | Idle clip barely moves (≤ 0.5° rotation, ≤ 1e-4 translation): likely a T-pose. It is dropped from the idle slot, so a humanoid with only that idle fails the clips gate (400 `VALIDATION`) | Export a real idle loop |
| `PNG_ALPHA_PREMULT_SUSPECT` | warn-only | `png_alpha.mjs` (`register_asset.mjs`) | ≥ 64 semi-transparent pixels and ≥ 99% of them look premultiplied | Export straight (un-premultiplied) alpha |

### 5. CLI exits

| code | HTTP / exit | where raised | meaning | fix hint |
|---|---|---|---|---|
| `CONFIG_INVALID` | exit 2 | `register_asset.mjs`, `import_pack.mjs` (before any probe) | `PROBE_CACHE` is not `0` or `1` (unset = on); one line `ERROR CONFIG_INVALID: PROBE_CACHE must be 0 or 1`, value never echoed | Set `PROBE_CACHE=0` (off) or `1` / unset (on) |
| `E_BLENDER_BIN_MISSING` | exit 2 | `golden.mjs` via `npm run golden:refresh` | `BLENDER_BIN` points at a missing file | Fix the path (fail-closed, no PATH fallback) |
| `E_BLENDER_BIN_UNSET` | exit 2 | `golden.mjs` via `npm run golden:refresh` | `BLENDER_BIN` not set | `BLENDER_BIN=/path/to/blender` |
| `E_BLENDER_VERSION` | exit 1 | `golden.mjs` `blenderVersion` | Could not parse `blender --version` | Check the binary runs headless |
| `E_GOLDEN_BLENDER_VERSION` | exit 2 | `golden:refresh --check`, golden tests | Blender version differs from the one the goldens were made with | Use the pinned Blender or refresh goldens deliberately |
| `E_GOLDEN_DRIFT` | exit 1 | golden tests; `--check` prints `DRIFT <key>` | Exported GLB sha256 differs from the golden | Investigate the pipeline change; refresh only if intended |
| `E_GOLDEN_FIXTURE` | exit 1 | `golden.mjs` | Fixture PNG sha256 differs from the recorded one | Restore `scripts/ensure-smoke-png.mjs` output |
| `E_GOLDEN_MALFORMED` | exit 1 | `golden.mjs` | Golden file entry is not 64-char lowercase hex | Regenerate with `npm run golden:refresh` |
| `E_GOLDEN_PLACEHOLDER` | exit 1 | `golden.mjs` | Golden entry is still a placeholder | Run `npm run golden:refresh` with Blender |
| `E_GOLDEN_UNSTABLE` | exit 3 | `golden:refresh` | Two exports of the same input differ; nothing written | Find the nondeterminism (seed, timestamps) |
| `GLB_CORRUPT` | exit 5 | `register_asset.mjs` | Corrupt / truncated / bad-magic GLB; one clean `ERROR GLB_CORRUPT:` line, no stack | Re-export the GLB |
| `GLB_TOO_LARGE` | exit 4 | `register_asset.mjs`, `pipeline.sh` | GLB over `MAX_GLB_MB`; not probed, not registered | Shrink the GLB or raise `MAX_GLB_MB` |
| `PATH_OUTSIDE_INBOX` | exit 2 | `run_mvp.sh` | Bad slug (not kebab) or inbox entry resolving outside `data/inbox` | Use a kebab slug and a real file under `data/inbox/` |
| `RATE_LIMITED` | exit 1 | `register_asset.mjs` | API answered 429; prints `retry in <N>s`; nothing retried, no files left behind | Re-run after N seconds (or raise `RATE_LIMIT_PER_MIN` on the API) |
| `SLUG_CLASH` | exit 1 | `register_asset.mjs` | Slug owned by another id; prints `retry with --slug <suggested>`; no files left behind | Re-run with the suggested slug |
| (no code) | exit 2 | `pipeline.sh` / `run_mvp.sh` `--seed`, `register_asset.mjs`, `pipeline.sh` | Bad `SEED` / `--seed` (non-integer or out of range) or bad `MAX_GLB_MB` (not an integer ≥ 1) | Pass a valid integer |

### 6. Test skips

Every skip reason starts with one of these codes (#104). `npm run test:s1` ends with a
`code · count · tests` table (TAP comment lines) and exits 1 on any skip without a known code.

| code | HTTP / exit | where raised | meaning | fix hint |
|---|---|---|---|---|
| `SKIP_CODE_MISSING` | exit 1 | `tests/reporters/skip-summary.mjs` | A skip reason has no known code (listed under `UNCODED` in the table) | Prefix the reason with one of the codes below |
| `SKIP_NO_API` | skip | API-backed tests | No world-builder at `WORLD_API` / :8787, or the needed fixture is not seeded there | Start the API (and seed) or set `WORLD_API` |
| `SKIP_NO_BLENDER` | skip | golden / seed / Blender smoke tests | `BLENDER_BIN` unset | `BLENDER_BIN=/path/to/blender` |
| `SKIP_NO_KRITA` | skip | reserved for Krita-live checks | Krita / bridge not running | Start Krita with the bridge |
| `SKIP_NO_MONGO` | skip | reserved for Mongo-only checks | Mongo not reachable | Start Mongo / set `MONGO_URI` |
| `SKIP_NO_UI_URL` | skip | browser checks | `UI_URL` (vite) not set | `UI_URL=http://localhost:<port>` with vite + API up |
| `SKIP_PLATFORM` | skip | bash-based tests, browser checks | Host lacks a tool: bash (Windows), `playwright-core`, or Chrome | Install it, or set `PLAYWRIGHT_CORE_DIR` / `CHROME_BIN` |
