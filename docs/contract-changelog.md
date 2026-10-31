# Contract changelog (S3-F #148)

What each sprint **added** to the public contract: error codes, env vars, API routes and schema
fields. One section per sprint, oldest first. Error codes are explained in
[`docs/error-codes.md`](error-codes.md) and routes in [`docs/openapi.yaml`](openapi.yaml); this file
only says *when* each appeared. `tests/s3f-e3.test.mjs` keeps it honest in both directions: every
code here exists in `error-codes.md`, every code there appears here, and every env var named here
is read somewhere in `apps/` or `scripts/`.

Line format (the doc test parses these): `- **Codes:** …`, `- **Env:** …`, `- **Routes:** …`,
`- **Schema:** …`.

## S2-C (and earlier baseline)
- **Codes:** `MONGO_REQUIRED`
- **Env:** `PORT`, `MONGO_URI`, `KRITA_MCP_PORT`, `KRITA_FP_PORT`, `KRITA_FP_TOKEN`, `HEALTH_STRICT_KRITA`, `KRITA_HEALTH_MODE`, `SKIP_KRITA_HEALTH`, `SMOKE_LIVE`
- **Routes:** `GET /api/health`, `GET /api/assets`, `GET /api/assets/:id`, `POST /api/assets`, `GET /api/assets/:id/file`, `GET /api/assets/:id/preview`
- **Schema:** asset `id`, `slug`, `name`, `characterType`, `stage`, `tags`, `clips`, `formats`, `rig` (sprint-1 contract)

## S2-D
- **Codes:** none
- **Env:** `MODE`, `SMOKE_MODE`, `BLENDER_BIN`
- **Routes:** `PATCH /api/assets/:id/clip-ux`
- **Schema:** `clipUx` (`defaultClip`, `order`, `disabled`), `importMeta` (`source`, `actionMap`, `originalFilename`, `boneMapStub`)

## S2-E
- **Codes:** none
- **Env:** none
- **Routes:** none
- **Schema:** `stage: "scene"` with `scene` graph stub (`version`, `rootId`, `nodes[]`)

## S2-F
- **Codes:** `V1`, `V4`, `V5`, `V6b`, `V8`
- **Env:** none
- **Routes:** none
- **Schema:** register-time scene child resolve (`nodes[].assetId` must resolve)

## S2-G
- **Codes:** `V4a`
- **Env:** none
- **Routes:** none
- **Schema:** ambiguous-slug rejection; canonical child id persisted

## S3-A
- **Codes:** `HUMANOID_BONE_COUNT`
- **Env:** none
- **Routes:** none
- **Schema:** `assetSchemaVersion` 3, `clipTags`, `rig.boneCount`, node `visible`

## S3-B
- **Codes:** none
- **Env:** none
- **Routes:** `PATCH /api/assets/:id` (importMeta merge), `DELETE /api/assets/:id`, `GET /api/openapi.json`, `GET /api/openapi.yaml`
- **Schema:** `clipDurations` (probe-only), `license` (SPDX), pack manifest `packSchemaVersion` 1

## S3-C
- **Codes:** `ARMATURE_COUNT`, `MULTI_ARMATURE`, `DUPLICATE_MAX_NODES`, `DUPLICATE_NO_SOURCE`, `SCENE_CAMERAS_MAX`, `OPENAPI_PARSE`, `E_BLENDER_BIN_MISSING`, `E_BLENDER_BIN_UNSET`, `E_BLENDER_VERSION`, `E_GOLDEN_BLENDER_VERSION`, `E_GOLDEN_DRIFT`, `E_GOLDEN_FIXTURE`, `E_GOLDEN_MALFORMED`, `E_GOLDEN_PLACEHOLDER`, `E_GOLDEN_UNSTABLE`
- **Env:** `SEED`
- **Routes:** none
- **Schema:** `rig.armatureCount`, `clipUx.blendMs`, `clipUx.timeScale`, `scene.view` (`ground`, `shadows`)

## S3-D
- **Codes:** `VALIDATION`, `NOT_FOUND`, `INTERNAL`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `KRITA_DOWN`, `SCENE_RESOLVE`, `ASSET_IN_USE`, `FILE_MISSING`, `GLB_CORRUPT`, `GLB_TOO_LARGE`, `PATCH_FORBIDDEN_FIELD`, `PATH_OUTSIDE_INBOX`, `SCHEMA_VERSION_DECREMENT`, `SLUG_CLASH`, `ALT_TEXT_TOO_LONG`, `IDLE_TPOSE_SUSPECT`, `PNG_ALPHA_PREMULT_SUSPECT`, `SKIP_CODE_MISSING`, `SKIP_NO_API`, `SKIP_NO_BLENDER`, `SKIP_NO_KRITA`, `SKIP_NO_MONGO`, `SKIP_NO_UI_URL`, `SKIP_PLATFORM`
- **Env:** `MAX_GLB_MB`, `WB_DATA_ROOT`
- **Routes:** flat error envelope `{code, error, ...extra}` on every route
- **Schema:** `altText`, `importMeta.warnings[]`, `createdAt` stamped on register

## S3-E
- **Codes:** `CONFIG_INVALID`, `CORS_ORIGIN_DENIED`, `RATE_LIMITED`, `SCENE_NODES_MAX`, `SCENE_NO_LIVE_NODES`, `SCENE_ROOT_DELETE`, `CHANGELOG_RANGE`, `LINT_FAILED`, `SECRETS_FOUND`, `SECRETS_SCAN_FAILED`
- **Env:** `RATE_LIMIT_PER_MIN`, `CORS_ORIGINS`, `TRUST_PROXY`, `SCENE_MAX_NODES`, `PROBE_CACHE`, `GITLEAKS_BIN`, `ACTIONLINT_BIN`, `SHELLCHECK_BIN`
- **Routes:** `GET /api/health` `limits.sceneMaxNodes`
- **Schema:** scene node `deleted` (tombstones), `importMeta.timingsMs`

## S3-F
- **Codes:** `KRITA_UNAUTHORIZED`, `CLIP_REQUIRES_MISSING`, `CLIP_REQUIRES_CYCLE`, `FEATURED_INVALID`
- **Env:** `ACTIVITY_MAX_LINES`, `BRIDGE`, `PUBLIC_BASE_URL`
- **Routes:** `GET /api/activity`, `GET /api/featured`, `PUT /api/featured`, `GET /api/health` `bridge` + `share.baseUrl`
- **Schema:** `clipRequires`, `importMeta.sourceKra` (both additive; `assetSchemaVersion` stays 3)

## S3-G
- **Codes:** none
- **Env:** `VITE_PORT`, `WB_API_PORT`, `INBOX_TTL_HOURS`, `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_ALLOW_HTTP`, `WEBHOOK_ALLOW_PRIVATE` (test-only)
- **Routes:** none (`GET /api/activity` kinds += `inbox.sweep`, `webhook.refused`, `webhook.failed`)
- **Schema:** none (`importMeta` VALIDATION bodies now carry `field`, e.g. `importMeta.source`; `assetSchemaVersion` stays 3)
