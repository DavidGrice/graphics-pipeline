# S3-F D2: contracts, codes and behaviour (bound to R1 `docs/sprint3f-brief.md`)

**Pack:** `enhancement/s3f-growth-t6` (recreated from `f6a637d` after PR #47). R1 wins wherever this doc and the seed differ. Flat error bodies `{code, error, ...extra}`, no absolute paths. Still exactly 6 `SKIP_*` codes. `assetSchemaVersion` stays **3**. OpenAPI **0.7.0** (adds `/api/activity`, `/api/featured`).

## New error codes (confirmed)
| Code | HTTP | Extra | When |
|---|---|---|---|
| `CLIP_REQUIRES_MISSING` | 400 | `{clip, missing: string[]}` | register or PATCH: a `clipRequires` key or value is not in the **probed** `asset.clips` |
| `CLIP_REQUIRES_CYCLE` | 400 | `{cycle: string[]}` (closed path, `[a, b, ..., a]`) | register or PATCH: self-reference or any cycle (DFS) |
| `FEATURED_INVALID` | 400 | `{invalid: string[], reason}` | PUT `/api/featured`: unknown, non-scene or duplicate id, or more than 20 |
| `KRITA_UNAUTHORIZED` | 503 | none | strict mode only, when `bridge.status` is `unauthorized` |

Reused: `VALIDATION` (CO-1, #47 separator, #128 `limit`), `SECRETS_SCAN_FAILED` (CO-2 gitleaks), `CONFIG_INVALID` (CO-2 lint bins, #85 `PUBLIC_BASE_URL`, #52 `BRIDGE`), `KRITA_DOWN` (strict, `down` only), `LINT_FAILED` (#106 bad `dependabot.yml`), `RATE_LIMITED` (PUT featured). All four new codes go in `docs/error-codes.md`; the two-way test stays green.

## New env
`ACTIVITY_MAX_LINES` (test-only, default 10000), `PUBLIC_BASE_URL`, `BRIDGE` (now validated). Each goes in `.env.example` and the #148 changelog.

## E1
### CO-1 Strict boolean node flags
- Scene POST/PATCH, every node: `deleted` / `visible` when present must be JSON booleans (`z.boolean().optional()`, no coercion). Else 400 `VALIDATION` with `field: "nodes[<i>].deleted"` (or `.visible`), nothing saved.
- `deleted: false` still normalises to absent. The `index.js:224` non-boolean branch is removed.

### CO-2 Fail-closed tool bins (`tool-bin.mjs`)
- `GITLEAKS_BIN` unset and not on PATH: `SKIP_PLATFORM`, exit 0.
- `GITLEAKS_BIN` set but missing, not a file or not executable: `SECRETS_SCAN_FAILED`, exit **2**, names the variable, never the path.
- `ACTIONLINT_BIN` / `SHELLCHECK_BIN` set but bad: `CONFIG_INVALID`, exit **2** (not `LINT_FAILED` exit 1, which means findings). Unset keeps the existing skip.

### #128 Activity
- Writer: one line per event to `<DATA_ROOT>/activity.jsonl` (`resolveUnder`-guarded, gitignored): `{at, kind, id, slug?}`, `at` ISO-8601 UTC. `kind` ∈ `asset.register | asset.patch | asset.delete | scene.save | scene.purge | pack.import`. No bodies, paths, IPs or headers.
- Rotation (Leader ruling a): at 10,000 lines (`ACTIVITY_MAX_LINES`) rename to `activity.1.jsonl`, overwriting any previous one; one generation kept. A failed write warns and never fails the request.
- Reader: `GET /api/activity?limit=` integer 1–100, default 20, else 400 `VALIDATION` (`field: "limit"`). Newest first; reads `activity.1.jsonl` when it needs more; malformed lines skipped. Response `{items, total}`. Not rate-limited.

### #110 glTF separate debug export
- `pipeline.sh --gltf-separate` also writes `<name>.gltf` + `<name>.bin` (+ textures) into `<name>.gltf-debug/` beside the GLB, gitignored. GLB bytes identical with or without the flag; register, probe, pack and timings ignore the dir. No Blender: `SKIP_NO_BLENDER`.

## E2
### #11 Clip requires (map, not per-clip field)
- `asset.clips` is `string[]`, so the field is optional `clipRequires?: Record<clip, clip[]>`, following `clipTags`. Each value array has 1–8 unique entries. Schema stays 3.
- Checked at register (API and CLI) and on `PATCH /api/assets/:id`, against **probed** clips (probe wins). Missing key or value: `CLIP_REQUIRES_MISSING`; self or cycle: `CLIP_REQUIRES_CYCLE` (Leader ruling b). A diamond (a→b, a→c, b→d, c→d) passes. Wrong types: `VALIDATION`.

### #85 QR share
- `PUBLIC_BASE_URL` optional; when set it must be an absolute `http(s)` URL with no path, query or hash beyond `/`, else startup fails `CONFIG_INVALID` naming the variable, not the value. Exposed as `/api/health` `share.baseUrl` (null when unset). QR drawn client-side with a bundled lib, no CDN, no request.

### #140 Featured
- `<DATA_ROOT>/featured.json` `{sceneIds: string[]}`, max **20**, unique; missing file = empty.
- `GET /api/featured` → `{sceneIds, scenes: [{id, slug, title?}], stale?: string[]}`; deleted or tombstoned ids are dropped from `scenes` and listed in `stale` (never 500).
- `PUT /api/featured` `{sceneIds}`: unknown, non-scene, duplicate or > 20 → `FEATURED_INVALID` `{invalid, reason}`. Atomic write (tmp + rename). Rate-limited with the existing mutation limiter (ruling c).

### #47 Krita source
- Optional `importMeta.sourceKra`, basename only, `^[^/\\]{1,255}\.kra$`; anything with a separator or other extension → 400 `VALIDATION`. Added to `ImportMetaSchema` and `sanitizeImportMeta`'s allowlist. Never read, copied or committed. Round-trips through pack export and import.

## E3
### #52 Bridge health
- `/api/health` `bridge: {mode, status}`. `mode` ∈ `vendor | firstparty | mock` from `BRIDGE`; unknown value → `CONFIG_INVALID` at startup. `status` ∈ `ok | unauthorized | down | mock | skipped`.
- Mapping: 2xx–3xx `ok`; **401/403 `unauthorized`**; other HTTP status `down` with `httpStatus`; connection error or timeout `down`.
- Legacy `krita` object kept, `krita.ok` derived from the new status (`unauthorized` is not ok). `krita.error` on down is the fixed text `"connection failed"`.
- Strict mode: `down` → 503 `KRITA_DOWN`; `unauthorized` → 503 `KRITA_UNAUTHORIZED`.

### #106 Dependabot (edit existing file)
- Keep `target-branch: dev` and the major-ignore rules. Add groups: `npm-minor-patch` (patterns `*`, minor+patch), `npm-dev` (devDependencies), `actions` (patterns `*`).
- `lint:ci` adds a YAML parse and shape check for `dependabot.yml`; a bad file → `LINT_FAILED`, exit 1.

### #148 Contract changelog
- `docs/contract-changelog.md`, one section per sprint S2-C → S3-F listing codes, env vars, routes and schema fields added. Doc test both ways: every backticked code exists in `error-codes.md`, every code in `error-codes.md` appears in the changelog, every env var named is read in `apps/` or `scripts/`.

### #149 AGENTS.md (extend existing)
- Add box paths (Blender 5.2.3 at `/home/box/tools/blender`, Krita, Node 24), pack/tip/PR rules, `test:s1`, `golden --check`, `scan:secrets`, `lint:ci`, `changelog`, the 6 SKIP codes, and links to `docs/error-codes.md` and the briefs. Links, never copies; ≤ 120 lines. Doc test: every `npm run X` exists, every repo path exists, the SKIP list equals the reporter's 6.
