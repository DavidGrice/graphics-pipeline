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
