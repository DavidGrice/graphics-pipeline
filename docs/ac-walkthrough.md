# Tester AC walkthrough (S3-G E3 #151)

Step by step for accepting a tip or a merge tip. Playbook and box paths: [`AGENTS.md`](../AGENTS.md).
Codes: [`docs/error-codes.md`](error-codes.md). Current brief: [`docs/sprint3g-brief.md`](sprint3g-brief.md).

## 1. Clean checkout
```bash
git fetch origin && git worktree add /workspace/ac-<sha> <sha>   # never reuse another agent's tree
cd /workspace/ac-<sha> && rm -rf node_modules && npm ci          # no stray deps (the c560e22 yaml lesson)
npm run build:schema && npm run typecheck
```

## 2. Suite on Node 24 and Node 22
```bash
BLENDER_BIN=/home/box/tools/blender npm run test:s1   # Node 24 (default)
npm run test:s1                                       # again without BLENDER_BIN: skips must be coded
# switch to Node 22 (nvm / box toolchain) and re-run npm run test:s1
npm run test:s2b
BLENDER_BIN=/home/box/tools/blender npm run golden:refresh -- --check
npm run lint:ci        # actionlint, shellcheck, dependabot, changelog:verify, mermaid
npm run scan:secrets
```
Every skip starts with one of the six codes in `AGENTS.md`; the summary comes from `tests/reporters/skip-summary.mjs`.

## 3. Fresh API ports
Use your own ports, never another lane's (see `AGENTS.md` "Ports"). Start the API and client with:
```bash
PORT=<api> RATE_LIMIT_PER_MIN=100000 npm run dev:world
WB_API_PORT=<api> VITE_PORT=<vite> npm run dev:client   # vite proxies /api to WB_API_PORT
```
`RATE_LIMIT_PER_MIN=100000` keeps bulk AC from tripping the limiter. Point UI tests at it with `UI_URL`.

## 4. Rate-limit default check
Restart the API **without** `RATE_LIMIT_PER_MIN` and confirm the default limiter still answers 429
`RATE_LIMITED` past the default of 60 writes per minute (`tests/s3e-ui-ratelimit.test.mjs` covers the UI side).

## 5. UI at 390, 1280 and 1920
- Load the client at widths 390, 1280 and 1920; nothing overlaps or clips (D1 placement rule, NIT-F-1).
- #82 hit check: click every visible control; each one hits its own target, none is covered.
- UI tests wait on `data-scene-ready="1"`, never on a sleep.
- Flake guard: `npm run test:ui:repeat -- 3` must print no flips.

## 6. Pack round-trip
```bash
npm run pack:assets      # writes a pack outside git (no media in git)
npm run import:pack      # into a fresh WB_DATA_ROOT; ids, slugs and probe data match
```

## 7. Fixtures: the #47 lesson
Never hand-write `importMeta` in a test. Use `makeImportMeta(overrides)` from `tests/helpers/import-meta.mjs`
(base: `tests/fixtures/importmeta-minimal.json`). A missing `importMeta.source` gives 400 `VALIDATION` with
`field: "importMeta.source"`.

## 8. Live CI on the tip (required before FULL PASS)
- Pushes to `enhancement/**` run CI (CO-5); PRs into dev/test/main run it too. Older tips: start a
  `workflow_dispatch` run on the tip SHA.
- Open the run for the **exact tip SHA**; every job is green, including lint + secrets.
- Local green is not enough: c560e22 passed locally and was red on CI.

## 9. Merge-tip routine
After the Leader merges a PR into dev:
1. Fresh worktree at the merge SHA, `npm ci`, then steps 2 to 6.
2. Check the dev push run for that SHA (step 8).
3. Log PASS or FAIL with run ids in the sprint AC log; on FAIL, hold the next sprint cut.

## Verdicts
- **PASS** for one item; **FULL PASS** only when steps 1 to 8 are green on the final tip.
