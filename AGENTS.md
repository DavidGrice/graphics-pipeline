# Agents

Coding agents (Claude, Grok, Cursor, Copilot, …): **start here**. Do not invent APIs. Do not commit secrets or `data/**` media.

1. **Requirements & DoD** → [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md)
2. **Architecture** (facade, pipeline, live vs demo, envs) → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
3. **Asset contract** → [`docs/sprint1-asset-contract.md`](docs/sprint1-asset-contract.md)
4. **Contributing / branches / CI** → [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)
5. **Before every PR:**
   ```bash
   npm ci && npm run build:schema && npm run build -w @graphics-pipeline/mcp-krita && npm run typecheck && npm run test:s1
   ```

**Hard rules:** GLB (or FBX) for anim/rig · OBJ static-only · patch/minor Dependabot → `dev` only · topic branches `feature|bug|enhancement/*` → `dev` → `test` → `main` · CI job name **`build-test`**.

Repo: https://github.com/DavidGrice/graphics-pipeline
- OpenAPI stub: docs/openapi.yaml (S3-B #74)

## Agent playbook (S3-F #149)

Links, never copies: the source of truth is the linked file. If this section and a linked doc disagree, the linked doc wins.

### Box paths (the shared Linux box)
- Blender **5.2.3 LTS**: `/home/box/tools/blender` (set `BLENDER_BIN` to it; goldens are pinned to this version)
- Krita: `/home/box/tools/krita` (only for live bridge checks; CI uses `BRIDGE=mock`)
- Lint / scan tools: `/home/box/tools/bin` (`actionlint`, `shellcheck`, `gitleaks`); put it on `PATH` or set `ACTIONLINT_BIN` / `SHELLCHECK_BIN` / `GITLEAKS_BIN`
- Node **24** is the default; re-run the suite on Node 22 before a tip lands
- Ports: the Tester owns 8787 / 5173; Engineer lanes use 8788 (API) / 5174 (vite)

### Packs, tips and PRs
- One sprint = one pack branch `enhancement/<sprint>-…` off `dev`; lanes E1 / E2 / E3 land as stacked **tips** on it
- Fetch and rebase onto the pack before every push; **never force-push**; fast-forward only
- Commit subjects carry the lane token (`E1`, `E2`, `E3`) so `npm run changelog -- <base>..<tip>` groups them; its output is the PR body
- Each tip ships a report (SHAs, counts, deviations); the Leader opens the PR to `dev`
- No media in git (`data/**`, GLB, PNG, zip); never commit secrets

### Before every tip
```bash
npm run build:schema && npm run typecheck
BLENDER_BIN=/home/box/tools/blender npm run test:s1      # then again without BLENDER_BIN, and on Node 22
npm run test:s2b
BLENDER_BIN=/home/box/tools/blender npm run golden:refresh -- --check
npm run lint:ci
npm run scan:secrets
npm run changelog -- origin/dev..HEAD
```

### Skips are coded
Every skipped test starts its reason with one of exactly six codes (reporter: `tests/reporters/skip-summary.mjs`; an uncoded skip is `SKIP_CODE_MISSING`):
`SKIP_NO_BLENDER`, `SKIP_NO_API`, `SKIP_NO_UI_URL`, `SKIP_NO_MONGO`, `SKIP_NO_KRITA`, `SKIP_PLATFORM`

### Contracts
- Error codes (every code, HTTP status / exit and fix): [`docs/error-codes.md`](docs/error-codes.md); bodies are flat `{code, error, ...extra}`, never absolute paths
- What each sprint added: [`docs/contract-changelog.md`](docs/contract-changelog.md)
- API: [`docs/openapi.yaml`](docs/openapi.yaml) · asset schema: [`packages/asset-schema/src/index.ts`](packages/asset-schema/src/index.ts) (`assetSchemaVersion` stays 3; additive fields only)
- Current sprint: [`docs/sprint3f-brief.md`](docs/sprint3f-brief.md), [`docs/sprint3f-d1-activity-requires-share-featured-kra-bridge.md`](docs/sprint3f-d1-activity-requires-share-featured-kra-bridge.md), [`docs/sprint3f-d2-contracts-codes-carryovers.md`](docs/sprint3f-d2-contracts-codes-carryovers.md)
- Previous: [`docs/sprint3e-brief.md`](docs/sprint3e-brief.md), [`docs/sprint3d-brief.md`](docs/sprint3d-brief.md)
