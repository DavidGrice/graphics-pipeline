# S3-E · D2: server and pipeline contracts, CI, error codes
Base `132f0dc` · pack `enhancement/s3e-growth-t5` · **bound to R1** `docs/sprint3e-brief.md` · `assetSchemaVersion` stays **3**. Every new code goes into `docs/error-codes.md`, and the two-way test applies.

## 1. #139 Rate limit
- A per-IP token bucket applies to mutating routes (POST, PATCH and DELETE). `RATE_LIMIT_PER_MIN` defaults to 60 and must be an integer of at least 1. An invalid value fails closed at start. GET and OPTIONS are exempt.
- Over the limit returns **429** `RATE_LIMITED` with `{ retryAfterSec }` and a `Retry-After` header (whole seconds). The body never echoes the IP. The client IP is the socket address. `X-Forwarded-For` is only trusted when `TRUST_PROXY=1`, and then only its **right-most** entry (the one the proxy appended) is used. The `/api/` prefix match ignores case. PUT is also limited. Behind the Vite dev proxy, all clients share 127.0.0.1, which is accepted and documented.
- UI: a 429 on Save or Register shows an inline "Too many changes, try again in Ns" message, and the button re-enables after N seconds. Nothing retries automatically.

## 2. #145 CORS allowlist
- `CORS_ORIGINS` is a comma list of exact origins with scheme, host and port. When it's unset, the allowed origins are `http://localhost:5173` and `http://127.0.0.1:5173`. `*` is never allowed, and the server refuses to start if the list contains it.
- An allowed origin gets `Access-Control-Allow-Origin: <origin>` and `Vary: Origin`, and its preflight returns 204.
- A disallowed origin gets no ACAO header, and its preflight returns 403 `CORS_ORIGIN_DENIED`. Requests with no `Origin` header (curl, CLI, tests) aren't affected. An invalid `CORS_ORIGINS` value refuses start with `CONFIG_INVALID`, which names the variable but never its value. This replaces the live `cors({ origin: true })` hole on base.

## 3. #134 Probe cache
- The key is `sha256(GLB bytes)` plus `PROBE_VERSION`, and the cache lives under `DATA_ROOT/cache/probe/`. It's gitignored and guarded by `resolveUnder`.
- A cache hit skips the probe. `PROBE_CACHE` accepts only `0` or `1`. Any other value gives `CONFIG_INVALID` (server exits 1, register CLI exits 2). `PROBE_CACHE=0` turns the cache off, and a failed probe is never cached. A corrupt, unparsable or version-mismatched entry gets re-probed and overwritten, and it's never trusted.
- The register response adds `probeCache: "hit" | "miss"`, which is additive.

## 4. #66 Timings
- Per R1, `timings.json` is written next to the asset as `{ stages: { export?, probe, copy, register }, totalMs, probeCache }`. Every value is an integer number of ms, and the key set is fixed.
- `pipeline.sh` writes `<name>.timings.json` next to each exported GLB as `{glb, sha256, stages:{export}}`. Register uses that export time only when **both** the name and the sha256 match, and otherwise leaves `export` out.
- `importMeta.timingsMs` leaves out the register stage, which isn't known until the request finishes. The full total is in `timings.json`.
- An optional `importMeta.timingsMs` mirrors it. Values are never part of goldens.
- UI: the import history row (#94) gets a `title` tooltip showing `totalMs` and the cache hit or miss. There's no new panel.

## 5. CI (#144, #107, #99, #122)
- **#144 gitleaks** runs on PR and push. `.gitleaks.toml` allowlists only `tests/fixtures/**`. gitleaks 8.21.2 and actionlint 1.7.4 are pinned with checksums. The scan covers committed history. `npm run scan:secrets` uses `SKIP_PLATFORM` when gitleaks is missing (per the Leader's ruling, there's no seventh skip code) and exits 1 on a finding.
- **#107 actionlint and shellcheck** check `.github/workflows/*` and `apps/**/*.sh`. shellcheck fails at **warning** severity, per R1, and actionlint fails on any finding. Existing findings are fixed in this tip.
- **#99** runs a matrix on Node **22 and 24**, with `engines.node: ">=22"` and `.nvmrc` set to `24`. The Blender smoke job stays single-Node on 24.
- **#122** `npm run changelog -- <base>..<tip>` makes no network calls. Per R1, its output is Markdown grouped by the lane tag in each commit subject (`E1`, `E2`, `E3`, `docs`, `test`, other), with one line per commit written as short SHA plus subject. A bad range exits 2 with `CHANGELOG_RANGE`. It's used as the 3-E PR body.

## 6. New codes for `docs/error-codes.md`
| code | HTTP / exit | group |
|---|---|---|
| `RATE_LIMITED` | 429 | Generic |
| `CORS_ORIGIN_DENIED` | 403 (preflight) | Generic |
| `SCENE_NODES_MAX` | 400 | Scene |
| `SECRETS_FOUND` | exit 1 (`scan:secrets`) | CLI exits |
| `SCENE_ROOT_DELETE` | 400 | Scene |
| `SCENE_NO_LIVE_NODES` | 400 | Scene |
| `CHANGELOG_RANGE` | exit 2 | CLI exits |
| `CONFIG_INVALID` | refuses start | Generic |
| `SECRETS_SCAN_FAILED` | exit 2 (scan broke; never reads as clean) | CLI exits |
| `LINT_FAILED` | exit 1 | CLI exits |
