# S3-F R1: contract brief (growth tranche 6: carry-overs, author surfaces, DX)

**Cut:** Leader, Oct 30 (seed `/workspace/sprint3f-seed.md`, as written) · **AC:** `/workspace/sprint3f-ac.md` (Tester)
**Base:** `origin/dev` @ `6f62c0b` (S3-E #46, pack tip `be7a238`) · **Pack:** `enhancement/s3f-growth-t6` (one branch only)
**IDs:** E1 CO-1 · CO-2 · 128 · 110 · E2 11 · 85 · 140 · 47 · E3 52 · 106 · 148 · 149
**Locks:**
- Probe wins.
- No media in git.
- `BLENDER_BIN` fails closed.
- `assetSchemaVersion` stays **3**, with optional, additive changes only.
- Every new error is a flat `{code, error, ...extra}` body with no absolute paths, listed in `docs/error-codes.md` (two-way test).
- There are still exactly **6** `SKIP_*` codes.
- INTERNAL errors return `"internal error"`.
- OpenAPI goes to **0.7.0**, because #128 and #140 add routes.
- Room-only. The Tester opens the PR after FULL PASS.

**Leader rulings:**
- (a) #128 is an append-only jsonl log under `DATA_ROOT`. It's gitignored, capped at 10k lines and rotated.
- (b) #11 returns a register-time 400 for `CLIP_REQUIRES_MISSING` and `CLIP_REQUIRES_CYCLE`.
- (c) #140 PUT is rate-limited, which the existing #139 limiter already covers.

**Grounded on base `6f62c0b`:**
- `index.js:220-225` deletes any `deleted` value other than `true`, so `"true"` becomes a live node (CO-1).
- `scan-secrets.mjs:7,23-25` treats a non-executable `GITLEAKS_BIN` as `SKIP_PLATFORM` (CO-2).
- `asset.clips` is `string[]`, not objects (`asset-schema index.ts:369`). Per-clip data uses the `clipTags` map pattern (`index.ts:91-96`).
- `/api/health` `krita.status` is `"running"` for **any** HTTP reply, a 401 included (`index.js:281-290`, #52 live gap).
- `.github/dependabot.yml` exists, with npm and actions weekly, majors ignored and **no groups**.
- `AGENTS.md` exists with 17 lines.

---

## E1: server, pipeline and scan

### 1. Strict boolean node flags (CO-1, NIT-E2-1)
- Scene POST and PATCH, on every node: when `deleted` or `visible` is present, it must be a JSON boolean. Anything else returns **400** `VALIDATION` with `{field: "nodes[<i>].deleted"}` (or `.visible`), and nothing is saved.
- `deleted: false` is still accepted and normalised to absent, as in S3-E. `visible` is unchanged when it's a boolean.
- Do it in the Zod schema (`z.boolean().optional()`, with no coercion) and remove the `index.js:224` normaliser's non-boolean branch.
- **Tests:** `"true"`, `"false"`, `1`, `0`, `null`, `{}` for both fields on POST and PATCH all return 400, and the scene file is unchanged. `true` and `false` still pass. The S3-E tombstone and restore suite stays green.

### 2. `GITLEAKS_BIN` fails closed (CO-2)
- `GITLEAKS_BIN` unset and gitleaks not on PATH: `SKIP_PLATFORM`, exit 0, as today.
- `GITLEAKS_BIN` **set** but missing, not a file, or not executable: `SECRETS_SCAN_FAILED`, exit 2. The message names `GITLEAKS_BIN` and **not** the path.
- Apply the same rule to `ACTIONLINT_BIN` and `SHELLCHECK_BIN` in `lint-ci.mjs`: a set but bad bin gives `CONFIG_INVALID`, exit 2. Don't use `LINT_FAILED` exit 1, which would read as findings. Put the shared check in `tool-bin.mjs`.
- **Tests:** a bogus path, a directory, and a non-executable file each give exit 2 and leave out the path. Unset with PATH stripped gives `SKIP_PLATFORM`.

### 3. Activity feed (#128)
- **Writer:**
  - Append one JSON line to `<DATA_ROOT>/activity.jsonl` (`resolveUnder`-guarded, gitignored): `{at, kind, id, slug?}`.
  - `kind` is one of `asset.register|asset.patch|asset.delete|scene.save|scene.purge|pack.import`. `at` is an ISO-8601 UTC string.
  - Don't log bodies, paths, IPs or headers.
  - At 10,000 lines, rename to `activity.1.jsonl`, overwriting any previous one, and start fresh. Only one generation is kept.
  - A failed write logs a warning and **never** fails the request.
- **Reader:**
  - `GET /api/activity?limit=` returns entries newest first. `limit` is an integer 1–100, default 20. A bad value returns 400 `VALIDATION`.
  - It reads the current file plus `activity.1.jsonl` when it needs more. Malformed lines are skipped.
  - Response: `{items: [...], total}`. A GET, so it isn't rate-limited.
- **UI:** an "Activity" panel lists the last 20, with a relative time and an absolute time in the title text, and links to the asset or scene. A deleted target still renders, as plain text.
- **Tests:** each kind is written once; rotation at the cap (with the cap lowered by a test-only env `ACTIVITY_MAX_LINES`); malformed lines are skipped; ordering; limit bounds; a forced write failure still returns 2xx.

### 4. glTF separate debug export (#110)
- `pipeline.sh --gltf-separate` also writes `<name>.gltf` + `<name>.bin` (+ textures) in `<name>.gltf-debug/` beside the GLB.
- The **GLB stays canonical**: same bytes with or without the flag (golden hash check), and register, probe, pack and timings ignore the debug dir.
- The output dir is gitignored. With no Blender, `SKIP_NO_BLENDER`.
- **Tests:** the GLB sha is the same with and without the flag; the `.gltf` parses as JSON with `asset.version === "2.0"` and refers to the `.bin`; `git check-ignore` covers the dir.

---

## E2: author and viewer

### 5. Clip dependency graph (#11)
- **Schema change (vs the seed):** `clips` is `string[]`, so use a map like `clipTags`: optional `clipRequires?: Record<clip, clip[]>`. Each value array is 1–8 entries and unique. Schema stays 3.
- **At register (API + CLI):**
  - A key or value not in `asset.clips` returns **400** `CLIP_REQUIRES_MISSING` with `{clip, missing: [...]}`.
  - A self-reference or any cycle (DFS) returns **400** `CLIP_REQUIRES_CYCLE` with `{cycle: [a, b, ..., a]}`.
  - Probe wins: the check runs against **probed** clips, not declared ones.
- `PATCH /api/assets/:id` with `clipRequires` runs the same checks.
- **UI:** the picker shows "needs: walk" under a clip. Choosing a clip whose requirement is missing can't happen, because the 400 blocks it at register.
- **Tests:** missing key, missing value, self-reference, a 3-cycle, and a valid diamond (a→b, a→c, b→d, c→d passes). The two codes appear in `error-codes.md`.

### 6. QR share link (#85)
- A "Share" button on the asset and scene views draws a QR code **client-side** with a bundled lib (no CDN, no network call; the test asserts no request goes out), plus a copy-link button.
- The base is `PUBLIC_BASE_URL` (server env, exposed via `/api/health` as `share.baseUrl`) or else `location.origin`.
- `PUBLIC_BASE_URL` must be an absolute `http(s)` URL with no path, query or hash beyond `/`. Otherwise startup fails with `CONFIG_INVALID`, naming the variable and not the value.
- When the host is loopback (`localhost`, `127.*`, `::1`), show "This link only works on this device."
- **Tests:** decode the rendered QR (jsQR or similar in the test) to get the exact URL; a bad env fails startup; the loopback hint shows; no network.

### 7. Featured scenes playlist (#140)
- **Storage:** `<DATA_ROOT>/featured.json` is `{sceneIds: string[]}`, at most **20**, unique. A missing file means an empty list.
- **Routes:**
  - `GET /api/featured` returns `{sceneIds, scenes: [{id, slug, title?}]}`. Ids that have since been deleted or tombstoned are **dropped from `scenes` on read**, with `stale: [ids]` listed (no 500).
  - `PUT /api/featured` takes `{sceneIds}`. An unknown, non-scene, or duplicate id, or more than 20, returns **400** `FEATURED_INVALID` with `{invalid: [...], reason}`. It writes atomically (tmp + rename). It's rate-limited (ruling c).
- **Viewer:** a "Featured" strip with prev/next and keyboard arrows. Autoplay is on only when `prefers-reduced-motion` is not set, and it pauses on hover or focus. An empty list hides the strip.
- **Tests:** PUT rejects each case; the GET stale path; atomic write; 21 ids returns 400; reduced motion means no autoplay.

### 8. Krita .kra source echo (#47)
- Optional `importMeta.sourceKra`: a **basename only**, matching `^[^/\\]{1,255}\.kra$`. Anything with a separator returns 400 `VALIDATION`. Add it to `ImportMetaSchema` and to `sanitizeImportMeta`'s allowlist.
- The pipeline fills it only when it knows the .kra source. The file is never read, copied or committed.
- The asset panel shows "Source: name.kra". When the field is absent, nothing is shown.
- **Tests:** a basename passes; `/abs/x.kra`, `..\\x.kra` and `x.png` are rejected; it round-trips through pack export and import.

---

## E3: health, CI and docs

### 9. BRIDGE 401 vs down (#52)
- `/api/health` gains `bridge: {mode, status}`.
  - `mode` is one of `vendor|firstparty|mock`, from `BRIDGE` (an unknown value gives `CONFIG_INVALID` at startup).
  - `status` is one of `ok|unauthorized|down|mock|skipped`.
- Status mapping:
  - HTTP 2xx–3xx gives `ok`.
  - **401 and 403 give `unauthorized`.**
  - Any other HTTP status gives `down` with `httpStatus`.
  - A connection error or timeout gives `down`.
- Keep the old `krita` object for compatibility, but set its `ok` from the new status: `unauthorized` is not ok.
- Strict mode returns 503 `KRITA_DOWN` only for `down`. For `unauthorized` it returns 503 `KRITA_UNAUTHORIZED`, a new code.
- The `krita.error` message on down must hold no absolute paths. Use a fixed text: `"connection failed"`.
- **UI:** the badge shows the words ("Krita: unauthorized"), not colour alone.
- **Tests:** a stub server returns 200, 401, 403 and 500; a closed port; `BRIDGE=mock`.

### 10. Dependabot grouping (#106)
- **Edit** the existing `.github/dependabot.yml`, keeping `target-branch: dev` and the major-ignore rules.
- Add `groups`:
  - npm gets `npm-minor-patch` (patterns `*`, update-types minor+patch) and a separate `npm-dev` for devDependencies.
  - Actions get `actions` (patterns `*`).
- `lint:ci` adds a YAML parse plus a schema-shape check for `dependabot.yml`, since actionlint doesn't cover it. A bad file gives `LINT_FAILED`, exit 1.
- **Test:** the parsed file has both ecosystems, the groups, and `target-branch: dev`.

### 11. Contract changelog (#148)
- `docs/contract-changelog.md` has one section per sprint from S2-C to S3-F. Each lists the codes added, env vars added, routes added, and schema fields added, with no prose essays.
- **Doc test (both ways):**
  - Every backticked `UPPER_SNAKE` code in it exists in `docs/error-codes.md`.
  - Every code in `error-codes.md` appears at least once in the changelog.
  - Every env var it names is read somewhere in `apps/` or `scripts/`.

### 12. Agent playbook, "first tip in 15m" (#149)
- **Extend** the existing `AGENTS.md`; don't replace it. Add:
  - box paths (Blender 5.2.3 at `/home/box/tools/blender`, Krita, Node 24)
  - the pack, tip and PR rules (Tester opens the PR after FULL PASS, no force-push)
  - the core commands: `test:s1`, `golden --check`, `scan:secrets`, `lint:ci`, `changelog`
  - the 6 SKIP codes
  - links to `docs/error-codes.md` and the sprint briefs
- It links docs and never copies them. It stays at no more than 120 lines.
- **Doc test:** every `npm run X` it names exists in `package.json`, every repo path it names exists, and the SKIP codes it lists equal the reporter's 6.

---

## New codes (D2 to confirm)
`CLIP_REQUIRES_MISSING`, `CLIP_REQUIRES_CYCLE` and `FEATURED_INVALID` (all 400), plus `KRITA_UNAUTHORIZED` (503, strict only). These are reused: `VALIDATION` (CO-1, #8, #128 limit), `SECRETS_SCAN_FAILED` (CO-2), and `CONFIG_INVALID` (CO-2 lint bins, #85, #52 `BRIDGE`).

## New env
`ACTIVITY_MAX_LINES` (test-only, default 10000), `PUBLIC_BASE_URL`, and `BRIDGE` (now validated). Each one goes in `.env.example` and the #148 changelog.

## Definition of done per tip
`test:s1` has 0 fail on Node 22 and 24, and skips are coded. typecheck, build, `golden --check` (#110 must not move a hash), `lint:ci` and `scan:secrets` are green. The OpenAPI 0.7.0 doc lists `/api/activity` and `/api/featured`. The two-way error-code test passes, and so does the #148 doc test.
