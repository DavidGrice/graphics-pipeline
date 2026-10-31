# S3-F D2: contracts, codes and behaviour (carry-overs, activity, gltf debug, requires, featured, health, CI/docs)

**Pack:** `enhancement/s3f-growth-t6` from `6f62c0b`. Flat error bodies `{code, error, ...extra}`, no absolute paths. Still exactly 6 `SKIP_*` codes. `assetSchemaVersion` stays **3**. OpenAPI bumps to **0.7.0** (routes added: `/api/activity`, `/api/featured`).

## New error codes (confirmed)
| Code | HTTP | Extra | When |
|---|---|---|---|
| `CLIP_REQUIRES_MISSING` | 400 | `{clip, missing: string[]}` | register: a `requires` entry names a clip not on the asset |
| `CLIP_REQUIRES_CYCLE` | 400 | `{clip, cycle: string[]}` | register: self-require or any cycle (first cycle found, in path order) |
| `FEATURED_INVALID` | 400 | `{reason: "unknown"\|"deleted"\|"duplicate"\|"too_many"\|"shape", sceneId?}` | PUT `/api/featured` |

Reused: `VALIDATION` (CO-1, `/api/activity?limit`), `SECRETS_SCAN_FAILED` (CO-2), `CONFIG_INVALID` (#85 `PUBLIC_BASE_URL`), `RATE_LIMITED` (PUT featured). All three new codes go into `docs/error-codes.md`; the two-way test must stay green.

## CO-1 Strict boolean node flags
- Scene POST/PATCH: `deleted` and `visible`, when present, must be JSON `true`/`false`. `"true"`, `1`, `0`, `null`, `{}` → 400 `VALIDATION` with `field` = `nodes[i].deleted` / `nodes[i].visible`. Absent stays default (live, visible).

## CO-2 GITLEAKS_BIN fail-closed
- Unset and not on PATH → `SKIP_PLATFORM` (unchanged).
- Explicitly set but missing or not executable → `SECRETS_SCAN_FAILED`, exit **2**, message names `GITLEAKS_BIN`, never the path. Mirrors `BLENDER_BIN`.

## #128 Activity
- `GET /api/activity?limit=` default 20, max 100; non-integer, < 1 or > 100 → 400 `VALIDATION` (`field: "limit"`). Not rate-limited (GET).
- Response `{items: [{at, kind, assetId?, sceneId?, slug}]}` newest-first. `kind` ∈ `register | delete | import | scene-save`.
- Store (Leader ruling a): append-only `activity.jsonl` under the data root (`WB_DATA_ROOT`), `resolveUnder`-guarded, gitignored. Cap **10,000** lines; on reaching the cap rotate to `activity.1.jsonl` (one generation kept) and start fresh. Feed reads the current file only. Malformed lines are skipped, not fatal. Write failure never fails the mutation it logs.

## #110 glTF separate debug export
- `pipeline.sh --gltf-separate` also writes `<name>.gltf` + `.bin` + textures beside the GLB, gitignored. GLB canonical: register, probe, goldens and `timings.json` sha unchanged (golden `--check` byte-stable). No Blender → `SKIP_NO_BLENDER`.

## #11 Clip requires
- Optional `clips[].requires?: string[]` (unique clip names). Validated at register (Leader ruling b): missing → `CLIP_REQUIRES_MISSING`, self or cycle → `CLIP_REQUIRES_CYCLE`. Non-array or non-string entries → `VALIDATION`. Schema stays 3.

## #85 QR share
- `PUBLIC_BASE_URL` optional; when set it must parse as an `http(s)` URL with no path beyond `/`, else boot fails `CONFIG_INVALID` naming the variable. Exposed to the client via `/api/health` `share.baseUrl` (null when unset). QR is drawn client-side; no new route.

## #140 Featured
- `featured.json` under the data root, `{sceneIds: string[]}`, max 20. Missing file = empty list.
- `GET /api/featured` → `{sceneIds}` filtered to live scenes. `PUT /api/featured` body `{sceneIds}`: non-array/non-string → `FEATURED_INVALID` `shape`; > 20 → `too_many`; unknown id → `unknown`; tombstoned → `deleted`; repeat → `duplicate`. Rate-limited with the existing mutation limiter (ruling c). Atomic write (tmp + rename).

## #47 Krita source
- Optional `importMeta.sourceKra`: basename only, matched against `^[^/\\]+\.kra$`; anything else is dropped silently (never stored, never an error). File never copied.

## #52 Bridge health
- `/api/health` `bridge: {status: "ok"|"unauthorized"|"down"|"mock", mode: "vendor"|"firstparty"|"mock"}`. HTTP 401/403 from the bridge → `unauthorized`; connect error, timeout or 5xx → `down`. Tests: `BRIDGE=mock` and a 401 stub.

## #106 Dependabot
- `.github/dependabot.yml`: npm weekly, groups `minor-patch` (minor + patch) with majors ungrouped; github-actions weekly in one group. Covered by `lint:ci` (`LINT_FAILED` exit 1 on error).

## #148 Contract changelog
- `docs/contract-changelog.md`, sections per sprint S2-C → S3-F, lists codes, env, routes and schema fields added or changed. Doc test: every code named exists in `docs/error-codes.md`; no code marked removed while still in source.

## #149 AGENTS.md
- Root `AGENTS.md`: box paths (Blender 5.2.3, Krita, Node 24), pack/tip/PR rules (one pack, rebase/ff, no force-push, Tester opens PR after FULL PASS), commands `test:s1`, `golden --check`, `scan:secrets`, `lint:ci`, and the 6 SKIP codes. Links docs, never copies them. Doc test: every `npm run <x>` named exists in `package.json`.
