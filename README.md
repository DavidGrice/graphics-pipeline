# graphics-pipeline

Open-source local pipeline: **Krita MCP (wrapped) → PNG → Blender headless GLB → MERN + react-three-fiber world builder**.

| Sprint 1 scope | Status |
|----------------|--------|
| S1-E1 monorepo scaffold + adapter seam + stubs | done |
| S1-E2 adapter smoke → PNG | `npm run smoke` / `smoke:demo` (live Krita optional) |
| S1-E3 headless `png_to_glb` + `run_mvp.sh` | Blender preferred; demo GLB fallback if missing |
| S1-E4 Express + R3F (D3 wireframe) | search, register, clip Play, rig/format meta |

## Stack (locked)

- **MERN** + **@react-three/fiber** / **drei**
- Mongo = asset **metadata**; **local disk** = GLB / PNG
- **GLB** primary for anything with clips/skins; **OBJ static-only** (never for anim)
- Wrap **krita-mcp** behind a thin adapter; first-party GPL plugin later
- Blender **docs/CI pin: 5.2.3 LTS**; scripts tolerate **≥ 4.2**; no EEVEE in MVP
- All-OS; Windows-primary path notes; Linux CI target

## Layout

```
graphics-pipeline/
  apps/mcp-krita/           # KritaBridgeAdapter + krita-mcp wrap
  apps/blender-pipeline/    # png_to_glb.py, pipeline.sh, blender_version.py
  apps/world-builder/       # Express API + Vite React R3F client
  packages/asset-schema/    # Zod/TS Mongo assets contract
  data/inbox/  data/assets/
  docs/                     # Sprint 0/1 research + contract + followups
```

## Prerequisites

| Tool | Notes |
|------|--------|
| **Node.js 20+** | see `.nvmrc` |
| **Krita** (GUI) | Must be running for MCP smoke. Windows plugin path: `%APPDATA%\krita\pykrita\` (or Open Resource Folder → `pykrita/`) |
| **krita-mcp** | `uvx krita-mcp install` then host config in `apps/mcp-krita/host-config.example.json` |
| **Blender 5.2.3 LTS** (recommended) | Any ≥ 4.2 works if ops exist. Set `BLENDER_BIN` if not on PATH |
| **MongoDB** (optional) | World-builder falls back to in-memory if Mongo is down |

Scaffolding **does not** require Krita or Blender to be installed; scripts fail with clear messages when missing.

## Quick start (local)

```bash
cd graphics-pipeline
npm install
npm run build:schema

# API (localhost:8787)
npm run dev -w @graphics-pipeline/world-builder

# UI (localhost:5173) — separate terminal
npm run dev -w @graphics-pipeline/world-builder-client
```

### Blender pipeline (when Blender is installed)

```bash
# Linux / macOS / Git Bash
export BLENDER_BIN=/path/to/blender   # optional
./apps/blender-pipeline/pipeline.sh ./data/inbox/demo/in.png ./data/assets/demo/model.glb

# Windows (PowerShell example)
$env:BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
& $env:BLENDER_BIN --background --python apps/blender-pipeline/png_to_glb.py -- in.png out.glb
```

### Krita MCP host

Copy `apps/mcp-krita/host-config.example.json` into your MCP host (Grok Build / VS Code / Cursor). Export timeout ≥ 60s. See `apps/mcp-krita/README.md`.

## Vertical slice (local)

```bash
# 1) API
npm run dev -w @graphics-pipeline/world-builder

# 2) UI (other terminal)
npm run dev -w @graphics-pipeline/world-builder-client

# 3) Demo PNG + GLB + register (Blender used if BLENDER_BIN/PATH set)
./apps/blender-pipeline/run_mvp.sh hero-billboard

# Adapter smoke (needs Krita for real export; --demo-png for path dry-run)
npm run smoke:demo -w @graphics-pipeline/mcp-krita
```

Pipeline diagram: `docs/sprint1-pipeline-diagram.md` · Viewer wireframe: `docs/sprint1-viewer-wireframe.md`


## Contributing & CI

Branch naming: `feature/*` · `bug/*` · `enhancement/*` → PR into **`dev`** → promote **`test`** → **`main`**.

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) and [`docs/sprint1.5-ci-branch-schematic.md`](docs/sprint1.5-ci-branch-schematic.md).

CI (GitHub Actions): `npm ci` → `build:schema` → `typecheck` → `test:s1` + forbid tracked media under `data/`.

**You must enable in GitHub Settings:** Actions, Environments `dev`/`test`/`prod`, branch protection, Dependabot, secret scanning / push protection — details in CONTRIBUTING § "What maintainers enable".

## License

- **Our code:** MIT (`LICENSE`)
- **Krita plugins (future first-party):** GPL — see `NOTICE`
- **krita-mcp wrap (Sprint 1):** upstream CC0; we do not rebadge their GPL native helper

## Docs

- `docs/sprint0-graphics-pipeline-research.md`
- `docs/sprint1-design-blueprints.md`
- `docs/sprint1-asset-contract.md` ← **authoritative Mongo schema**
- `docs/sprint1-followups-licensing-blender-api.md`
- `docs/sprint1-tester-ac.md`
- `docs/CONTRIBUTING.md`
- `docs/sprint1.5-ci-branch-schematic.md`
- `docs/sprint1.5-cicd-security-research.md`
- `docs/sprint15-tester-ac.md`
- `SECURITY.md`
