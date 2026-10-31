# S3-E-R1 — Contract brief (growth tranche 5: ops/security + CI hygiene)

**Cut:** Leader post Oct 30 (seed `/workspace/sprint3e-seed.md`, approved as-is) · **AC:** `/workspace/sprint3e-ac.md` (Tester)
**Base:** `origin/dev` @ `132f0dc` (S3-D #45 + S2-G #44) · **Pack:** `enhancement/s3e-growth-t5` (one branch only)
**IDs:** E1 139 · 145 · 134 · 66 — E2 38 · 41 · 35 · 87 — E3 144 · 107 · 99 · 122
**Locks:** probe wins · no media in git · fail-closed `BLENDER_BIN` · `assetSchemaVersion` stays **3** (optional/additive only) · every new error = flat `{code, error, ...extra}`, no abs paths, listed in `docs/error-codes.md` (two-way test) · every skip `SKIP_*` (6 codes, no 7th) · INTERNAL = `"internal error"` · room-only · Tester opens PR after FULL PASS.
**Leader rulings:** tombstones do **not** count toward #38 cap · #144 missing gitleaks → `SKIP_PLATFORM`.
**Grounded on base `132f0dc`:** `index.js:198` `app.use(cors({ origin: true }))` **reflects any Origin** (live gap, #145) · no rate limiting · `.nvmrc` = `20`, `engines.node >=20`, CI single Node via `.nvmrc` · CI triggers PR+push on dev/test/main · scene schema `nodes.min(1)` + `rootId ∈ nodes[].id` · 5 `.sh` files + `tests/fixtures/fake-blender.sh`.

---

## E1 — server / pipeline

### 1. Rate limit (#139)
- Token bucket per client IP on **mutating** routes only (POST/PATCH/DELETE under `/api`). GET/HEAD/OPTIONS exempt (viewer, health, openapi never throttled).
- `RATE_LIMIT_PER_MIN` int ≥1, default **60**; invalid env → server refuses to start (fail-closed, like `MAX_GLB_MB`). `RATE_LIMIT_PER_MIN=0` is invalid, not "off".
- Over → **429** `RATE_LIMITED` `{ retryAfterSec }` + `Retry-After` header (integer seconds, ≥1).
- IP = socket address; **do not** trust `X-Forwarded-For` unless `TRUST_PROXY=1` (spoofing guard). Vite dev proxy → all clients share 127.0.0.1: acceptable, document it.
- In-memory store; resets on restart. Tests use a low limit + isolated server; must not slow `test:s1` (no real sleeps > 1 s).

### 2. CORS allowlist (#145) — MUST (closes live reflect-any-origin)
- `CORS_ORIGINS` = comma list of exact origins (scheme+host+port, no wildcards, no trailing slash). Unset → `http://localhost:5173,http://127.0.0.1:5173` only.
- Allowed origin → `Access-Control-Allow-Origin: <origin>` + `Vary: Origin`; never `*`, never reflect unlisted.
- Disallowed origin → request still processed for non-browser clients but **no** ACAO header; preflight from disallowed origin → **403** `CORS_ORIGIN_DENIED` (no ACAO). Requests with no `Origin` (curl/CLI/tests) unaffected.
- Malformed entry in `CORS_ORIGINS` (e.g. `*`, path, missing scheme) → fail-closed start.

### 3. Probe cache (#134)
- Key = `sha256(GLB bytes)` + `PROBE_VERSION` constant (bump invalidates all). Value = probe result JSON exactly as register would store (`clips`, `rig`, `clipDurations`, `importMeta.warnings`, armatureCount).
- Location `DATA_ROOT/cache/probe/<sha>.json`, via `resolveUnder`; gitignored. Write atomically (tmp + rename).
- Unparseable / schema-invalid / version-mismatch entry → ignored + re-probe + overwrite; **never** trusted. Cache only populated by a successful probe (errors not cached; `MULTI_ARMATURE`, `GLB_CORRUPT` always re-evaluated).
- Opt-out `PROBE_CACHE=0`. Observable: register response / CLI log `probeCache: "hit"|"miss"` so T can assert. Goldens unaffected (cache never changes output bytes).

### 4. Timing metrics (#66)
- `register_asset.mjs` (and `pipeline.sh` stages) write `timings.json` beside the asset: `{ stages: { export?: ms, probe: ms, copy: ms, register: ms }, totalMs, probeCache }`, integer ms, fixed key set.
- Optional `importMeta.timingsMs` mirror (additive). Never part of golden hashes; never in git (asset dirs gitignored).

## E2 — scene author / viewer

### 5. Node cap (#38)
- `SCENE_MAX_NODES` int ≥1, default **256**, fail-closed on bad env. Counts **live** nodes only (tombstones excluded, Leader).
- POST/PATCH over cap → **400** `SCENE_NODES_MAX` `{ max, count }`. UI: Duplicate (#26) and Add disabled at cap with "n/256".
- Restore (#41) of a tombstone that would exceed cap → same 400.

### 6. Soft-delete nodes (#41)
- Node gains optional `deleted?: true` (absent = live; `false` normalised to absent). Schema stays 3.
- Delete in author → sets tombstone (draft, dirty, Save per S3-A). Restore clears it. **Purge** (explicit, confirm) removes tombstones from the array on Save.
- Tombstoned nodes: hidden in viewer, skipped by V4/V4a resolve, excluded from cap, not selectable by gizmo, not duplicable.
- Invariants: `rootId` node **cannot** be tombstoned → 400 `SCENE_ROOT_DELETE`; at least one live node required (`nodes.min(1)` applies to live) → 400 `SCENE_NO_LIVE_NODES`. Tombstoned nodes still need unique ids.
- DELETE `/api/assets/:id` 409 (S3-C) checks **live** references only? → **No: tombstoned refs still block** (restore must not dangle). Purge first to free the asset.

### 7. Replace child, keep transform (#35)
- Author action on a selected live node: pick new `assetId` (id or slug) → keep `id`, `transform`, `visible`; run V4/V4a resolve; persist canonical id (S2-G normalise).
- Missing/ambiguous target → existing V4/V4a codes; replacing with a `stage:"scene"` asset → existing no-nested rejection. Self-reference rejected.
- Dirty → Save. No new API (PATCH scene).

### 8. Touch orbit (#87)
- OrbitControls touch: 1-finger rotate, 2-finger pinch-zoom + pan. Canvas `touch-action: none`; page outside canvas scrolls normally.
- Gizmo drag (S3-A/B) wins over orbit on touch, same as mouse. Verify headless at **390×844** with touch emulation + 1280 regress (#82 dock check unchanged).

## E3 — CI / DX

### 9. Secrets scan (#144)
- gitleaks job in `ci.yml` on PR + push (existing triggers). `.gitleaks.toml` allowlists only `tests/fixtures/**` + `testdata/**` paths, not regexes over `src`.
- `npm run scan:secrets` locally; gitleaks absent → `SKIP_PLATFORM` (Leader). Finding → CI fail, local exit 1 `SECRETS_FOUND`. Base must scan clean (fix or allowlist with comment).

### 10. actionlint + shellcheck (#107)
- Lint `.github/workflows/*.yml` (actionlint) and all `*.sh` in `apps/**`, `scripts/**`, `tests/fixtures/**` (shellcheck, severity ≥ warning fails). Fix existing findings in-tip; inline `# shellcheck disable=SCxxxx` only with a reason comment.
- Local `npm run lint:ci`; missing tool → `SKIP_PLATFORM`.

### 11. Node matrix (#99)
- CI test job matrix **Node 22 + 24**; `.nvmrc` → `24`; `engines.node` → `>=22`. Blender smoke job stays single-Node (24) to save minutes.
- Both legs must run `test:s1` + typecheck + build. Node 20 dropped (EOL Apr 2026). `fail-fast: false`.

### 12. Changelog (#122)
- `npm run changelog -- <base>..<tip>` → markdown to stdout: grouped by lane tag in subject (`E1`/`E2`/`E3`/`docs`/`test`/other), each line short SHA + subject. No network, pure `git log`. Bad range → exit 2 `CHANGELOG_RANGE`.
- Tester uses it for the 3-E PR body. Merge commits excluded.

---

## New codes (must be in `docs/error-codes.md`)
`RATE_LIMITED` 429 · `CORS_ORIGIN_DENIED` 403 · `SECRETS_FOUND` (scan:secrets exit 1, D2 name) · `SCENE_NODES_MAX` 400 · `SCENE_ROOT_DELETE` 400 · `SCENE_NO_LIVE_NODES` 400 · `CHANGELOG_RANGE` exit 2 · env fail-closed start errors (`CONFIG_INVALID`, names the variable, not its value).

## Lanes → AC
| Lane | IDs | Must-probe |
|------|-----|-----------|
| E1 | 139 · 145 · 134 · 66 | 429 + Retry-After; XFF spoof ignored w/o TRUST_PROXY; evil Origin gets no ACAO + preflight 403; corrupt cache entry re-probed; timings keys fixed |
| E2 | 38 · 41 · 35 · 87 | cap 256/257 live with tombstones present; root delete 400; restore over cap 400; DELETE asset blocked by tombstoned ref; replace keeps transform; 390×844 touch |
| E3 | 144 · 107 · 99 · 122 | planted fake secret fails scan; shellcheck clean; both Node legs green; changelog bad range exit 2 |
| all | S3-D regress (#141 traversal, INTERNAL text, #152 two-way, #82 dock 1280/1920) | |

**Out of scope:** auth/users · persistent rate-limit store · webhooks (#72) · schema bump.
