# S3-G R1: contract brief (growth tranche 7: carry-overs, author power tools, ops, docs)

**Cut:** Leader, Oct 30 (seed `/workspace/sprint3g-seed.md`, all 12 items) · **AC:** `/workspace/sprint3g-ac.md` (Tester)
**Base:** `origin/dev` @ `c560e22` (S3-F #48), with **CO-0** (`yaml` devDependency + `npm ci` in the lint job) as the first pack commit; dev is fixed when 3-G merges · **Pack:** `enhancement/s3g-growth-t7` (one branch only)
**IDs:** E1 CO-1 · CO-2 · 78 · 72 — E2 29 · 36 · 84 · 44 — E3 CO-3 · CO-4 · 150 · 151. **Tip1 = CO-1..CO-4.**

**Locks:**
- Probe wins. No media in git. `BLENDER_BIN` fails closed. `assetSchemaVersion` stays **3**.
- Flat `{code, error, ...extra}` bodies with no absolute paths. Every code goes in `docs/error-codes.md` (two-way test) and in `docs/contract-changelog.md` (#148 test).
- Still exactly 6 `SKIP_*` codes. INTERNAL errors return `"internal error"`.
- OpenAPI stays at **0.7.0** unless a route is added. None is planned.
- **FULL PASS needs green live CI on the final tip** (new, after the c560e22 miss).

**Leader rulings:**
- (a) #72 is on only when `WEBHOOK_URL` is set. The address guard is mandatory and fails closed, including after redirects, with a test per blocked range.
- (b) CO-4 runs the UI suite twice in CI on Node 24 only. A test that passes once and fails once is a failure.
- (c) #36 undo survives Save with a marker at the save point, capped at **100** steps.

**Grounded on `c560e22`:**
- `changelog.mjs:23` lane regex only matches a bare `E[123]`.
- `ci.yml` `lint-secrets` (L78–119) has **no `npm ci`**, and `scripts/dependabot-check.mjs` imports an undeclared `yaml` (the live CI red).
- PATCH importMeta returns a bare `"importMeta must be an object"` with no `field` (`index.js:717-718`).
- There's no scene-ready hook in the client.
- Mermaid blocks already exist in `docs/AGENT_GUIDE.md:20` and `docs/sprint2c-d2-pipeline-v2.md:43`, and are not linted.

---

## E1: scripts and server ops

### 1. Changelog lane suffixes (CO-1)
- `laneOf` matches `E[123]` followed by an optional `[a-z]` suffix (`e1b`, `E2a`), case-insensitive, inside the existing token boundaries, and maps it to `E1`/`E2`/`E3`. It must **not** match inside words (`see1`, `E10`, `node22`).
- **Tests:** `s3f-e1b`, `(E2a)`, `E3:` and `e1` all map. `E10`, `E4`, `ae1` and `node22` don't. On real history `f6a637d..d94d945`, every tip1b commit lands in E1 and none in "other".

### 2. Contract-changelog provenance (CO-2)
- `npm run changelog:verify`: for each code row in `docs/error-codes.md`, find the first commit that added it (`git log --reverse -S'<CODE>' -- docs/error-codes.md`, or the source file when the doc came later), map it to a sprint by the commit's `docs/sprintX-brief.md` ancestry or tag, and compare with the `docs/contract-changelog.md` section.
- A mismatch gives exit 1 `LINT_FAILED` with `{code, docSprint, gitSprint}` lines. A shallow clone gives `SKIP_PLATFORM` (CI uses `fetch-depth: 0`).
- Fix every row it flags in the same tip. `lint:ci` runs it.
- **Test:** a seeded wrong sprint fails, and the fixed doc passes.

### 3. Inbox PNG TTL (#78)
- `INBOX_TTL_HOURS` is an integer 1–8760, default **168**. Anything else gives `CONFIG_INVALID` at startup.
- Sweep at startup and then every hour (`unref` timer). Only `*.png` directly under the inbox via `resolveUnder`. Never follow symlinks. Skip any file a registered asset references (`importMeta.originalFilename` or the pipeline sidecar).
- Remove only when mtime is older than the TTL. Log `inbox.sweep {removed, kept}` to the #128 activity log, and only when `removed > 0`. Errors are per-file warnings and never crash.
- Mongo TTL index only when Mongo is connected. The file sweep is the source of truth.
- **Tests:** fake clock or `utimes`; a referenced PNG is kept; a symlink is ignored; a non-PNG is ignored; bad env fails startup.

### 4. Webhook on register (#72) — SSRF guard is MUST
- **Config (all optional):**
  - `WEBHOOK_URL` must be an absolute `https:` URL. `http:` is allowed only when `WEBHOOK_ALLOW_HTTP=1`.
  - `WEBHOOK_SECRET` is a string of at least 16 characters, or unset.
  - A bad value gives `CONFIG_INVALID`, naming the variable and not the value.
- **Events:** `asset.register` and `asset.delete` send `{event, id, slug, at}`, as JSON with no paths. Fire-and-forget after the response: a 3 s timeout, 1 retry after 1 s, and the request never fails.
- **Signing:** `X-Webhook-Signature: sha256=<hex HMAC of raw body>` when `WEBHOOK_SECRET` is set. The secret is never logged.
- **Guard (fails closed):**
  - Resolve **every** A/AAAA record, then connect to the vetted IP (pin the IP, send the original Host, keep SNI). That defeats DNS rebinding.
  - Refuse if **any** record falls in: 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16 (metadata), 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, 224/4, 240/4, ::/128, ::1, fc00::/7, fe80::/10, ::ffff:0:0/96 (mapped forms checked as v4), 64:ff9b::/96.
  - `redirect: "manual"`: a 3xx is **not followed** (this covers "after redirects" by refusing them). It's logged as `webhook.refused {reason: "redirect"}`.
  - `WEBHOOK_ALLOW_PRIVATE=1` (test-only) lifts the range check, and it's documented as dangerous.
  - A refusal logs `webhook.refused {reason}` with **no URL or IP echo**.
- **Tests:** one test per range (stub resolver), mixed public and private records refused, IPv4-mapped IPv6 refused, a redirect refused, a happy path to a local server under the allow flags with a valid HMAC, a timeout plus a single retry, bad env.

---

## E2: author and viewer

### 5. Undo/redo stack (#36) — land with or before #29
- Client-only, holding at most **100** steps (the oldest drops). A step is `{label, before, after}` scene-graph snapshots or inverse ops.
- Covers transform (one step per gesture end, not per frame), add, duplicate, replace (#35), tombstone, restore, purge-in-session, visibility, and #29 batches as **one** step.
- Keys: Ctrl/Cmd+Z, and Shift+Ctrl/Cmd+Z or Ctrl+Y. Not while typing in an input. Buttons have a disabled state and an `aria-label`.
- Save keeps the stack and puts a **save marker** on the current step. Dirty means current ≠ marker. A redo branch is cut by a new edit. A reload or scene switch clears the stack.
- Nothing is sent to the server until Save. Undo past an asset that has been deleted server-side is allowed, and Save then hits the existing V4 error.
- **Tests:** a 101st step drops the first; batch = 1 undo; dirty flag around the marker; a redo branch is cut; typing in an input doesn't undo.

### 6. Multi-select nodes (#29)
- Shift-click toggles a node, and a drag box selects on the canvas (not on gizmos). Ctrl/Cmd+A selects **live** nodes, and Esc clears.
- Batch ops: move (one shared delta via the gizmo on the selection centroid), hide/show, tombstone, and restore.
- The root and nodes already in the target state are **skipped**, with a toast like "2 skipped (root, already deleted)".
- A batch restore that would cross the #38 cap is refused whole (`SCENE_NODES_MAX` from Save, or blocked in the UI first), never partial.
- One Save. The panel shows "n selected".
- **Tests:** a batch skips the root; the cap blocks restore; the selection survives undo/redo.

### 7. Compare two assets (#84)
- `?compare=<idA>,<idB>`: exactly two distinct ids. A malformed or self compare shows an inline error, and so does an unknown id, which also gets a link back. No crash.
- Split view with a "sync orbit" toggle (default on). A side table diffs tris, bones, clips, `clipRequires`, size, `characterType`, license and stage, with the differences highlighted (text marker, not colour alone).
- Below 600px it stacks vertically, and every overlay uses the NIT-F-1 placement rule (D1 §3).
- **No new API.** It uses the existing GETs. Two WebGL canvases share one renderer if possible, or are disposed on exit (no leak across 5 open/close cycles in the test).

### 8. BRIDGE health page (#44)
- A client route `/health` (with a "Health" nav link) shows bridge `mode/status`, the Krita port, tool versions (#103), `limits`, the share base, and the last 5 activity entries.
- Polls `/api/health` and `/api/activity?limit=5` every **10 s** with `document.hidden` pausing it. The 429 back-off honours `Retry-After`.
- The status is in words plus an icon, not colour alone. Absolute paths aren't shown, even though the 200 health response has `dataRoot` (show "set" or "unset").
- No new route.
- **Tests:** the 401-stub bridge shows "unauthorized"; hidden-tab pausing; no `dataRoot` text in the DOM.

---

## E3: validation, stability and docs

### 9. importMeta validation clarity and shared fixture (CO-3)
- Every importMeta 400 (POST, PATCH and pack import) returns `VALIDATION` with `field` set to the **first** failing Zod path as dotted text (`"importMeta.source"`), and `error` set to the Zod message with no value echo.
- PATCH `index.js:718` gains `field: "importMeta"`.
- Add `tests/fixtures/importmeta-minimal.json` (`{"source": "unknown"}`) and `tests/helpers/import-meta.mjs` with a `makeImportMeta(overrides)` helper. Migrate the s3f tests to it.
- **Tests:** a missing `source`, a bad enum and a bad `sourceKra` each name the right `field`; the fixture passes `ImportMetaSchema`.

### 10. UI settle and flake guard (CO-4)
- The client sets `data-scene-ready="1"` on the viewer root after the first frame is rendered **and** the scene JSON is applied, and resets it to `"0"` on scene change. UI tests wait on it (timeout 15 s) and never on a sleep. Fix `s3e-ui-scene` #38 first.
- `npm run test:ui:repeat -- N` (default 3) runs the UI suite N times and fails if any test flips between runs. It prints a flip table.
- CI adds a job on Node 24 only that runs the UI suite **twice**. A flip fails the job. There's no quarantine label.
- **Test:** a deliberate flip fixture makes the repeat runner exit 1.

### 11. Mermaid in docs (#150)
- Add `docs/pipeline.md` with the pipeline (Krita→Blender→register→R3F) and register-flow (probe, V4/V4a, codes) diagrams as fenced `mermaid` blocks.
- `lint:ci` parses **every** mermaid block under `docs/`, including the two that already exist, offline (pinned `@mermaid-js/parser` devDependency, so `npm ci` is required in the lint job, per CO-0). A parse error gives `LINT_FAILED` with file:line.
- No rendered images in git.

### 12. Tester AC walkthrough (#151)
- `docs/ac-walkthrough.md` covers:
  - a clean checkout, Node 22 and 24, and fresh API ports with `RATE_LIMIT_PER_MIN=100000`
  - the rate-limit default check
  - UI at 390, 1280 and 1920, plus the #82 hit check
  - the pack round-trip
  - **the live CI check on the tip before FULL PASS**
  - the #47 fixture lesson (use `makeImportMeta`)
  - the merge-tip routine
- It's at most 150 lines and links to `AGENTS.md`. A doc test checks that every `npm run`, path and env var it names exists.

---

## New codes and env
- **New codes:** none. Reused: `CONFIG_INVALID` (#72, #78), `LINT_FAILED` (CO-2, #150), `VALIDATION` (CO-3), `SKIP_PLATFORM` (CO-2 shallow clone).
- **New env:** `INBOX_TTL_HOURS`, `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_ALLOW_HTTP`, and `WEBHOOK_ALLOW_PRIVATE` (test-only). All go in `.env.example` and the #148 changelog.
- **New activity kinds** (`docs` plus the #128 enum): `inbox.sweep`, `webhook.refused`, `webhook.failed`.

## Definition of done per tip
- `test:s1` has 0 fail on Node 22 and 24, and skips are coded.
- typecheck, build, `golden --check`, `lint:ci` (now with mermaid and `changelog:verify`), and `scan:secrets` are green.
- The UI repeat run has no flips.
- **The tip's live CI run is green** before the Tester calls FULL PASS.
