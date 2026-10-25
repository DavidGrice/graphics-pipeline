# graphics-pipeline

Open-source **local** pipeline for agent-friendly 2D→3D content:

**Krita (MCP) → PNG → Blender headless → GLB → MERN + react-three-fiber world builder**

> **Agents (Claude, Grok, Cursor, etc.): start at [`AGENTS.md`](AGENTS.md)** → [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) + [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

| Area | Status |
|------|--------|
| Sprint 1 vertical slice (demo path + schema + API + R3F) | **done** on `main` |
| Sprint 1.5 CI/CD, gitignore, Dependabot (patch/minor → `dev`) | **done** |
| Sprint 2 (Windows live smoke · custom Krita bridge · real rigs) | draft — see `docs/sprint2-cut-draft.md` |

## What “done” means for the MVP

1. Facade tools `health` + `export_png` (Krita GUI up for live export).  
2. `png_to_glb.py` emits **GLB** with a Mesh Plane + Action (e.g. `spin`).  
3. Express serves metadata + file; R3F loads GLB and can play clips.  
4. CI job **`build-test`** green without Krita/Blender installed on the runner.  
5. **No** tracked PNG/GLB under `data/**`; secrets never committed.

## Stack (locked)

| Choice | Detail |
|--------|--------|
| App stack | **MERN** + **@react-three/fiber** / **drei** |
| Metadata | MongoDB (in-memory fallback if Mongo down) |
| Files | Local disk under `data/` |
| Animated format | **GLB** primary; FBX optional; **OBJ static-only** |
| Krita | Wrap **krita-mcp** behind facade → first-party GPL plugin later |
| Blender | Pin **5.2.3 LTS** in docs/CI; scripts tolerate **≥ 4.2**; no EEVEE in MVP |
| OS | All-OS; Windows-primary notes; Linux CI |

## Repository layout

```
apps/mcp-krita/              # MCP facade (adapter seam)
apps/blender-pipeline/       # Headless PNG → GLB
apps/world-builder/          # Express API
apps/world-builder/client/   # Vite + R3F viewer
packages/asset-schema/       # Shared Zod contract
data/inbox/  data/assets/    # Runtime media (gitignored)
docs/                        # Contracts, diagrams, research, AC
AGENTS.md                    # Operating contract for coding agents
```

## Prerequisites

| Tool | Notes |
|------|--------|
| **Node.js 20+** | `.nvmrc` |
| **Krita** (GUI) | Required for *live* MCP export. Windows: `%APPDATA%\krita\pykrita\` |
| **krita-mcp** | `uvx krita-mcp install` — see `apps/mcp-krita/host-config.example.json` |
| **Blender 5.2.3 LTS** | Set `BLENDER_BIN` if not on `PATH`. Linux box: `/home/box/tools/blender` |
| **MongoDB** | Optional for local demo |

Scaffolding and CI **do not** require Krita/Blender; scripts exit with clear errors when missing.

## Multi-OS setup (replicate smoke)

| OS | Doc |
|----|-----|
| **Matrix** | [`docs/setup-os-matrix.md`](docs/setup-os-matrix.md) |
| **Windows** | [`docs/setup-windows.md`](docs/setup-windows.md) — Blender path, Import Python Plugin, `BRIDGE`, `smoke_live.ps1` |
| **Linux (box)** | [`docs/setup-linux.md`](docs/setup-linux.md) — `BLENDER_BIN=/home/box/tools/blender`, Krita `/home/box/tools/krita`, headless `billboard\|rigged` |

CI still does **not** need Krita/Blender for `test:s1` / unit gates.

## Quick start

```bash
git clone https://github.com/DavidGrice/graphics-pipeline.git
cd graphics-pipeline
npm ci
npm run build:schema
npm run build -w @graphics-pipeline/mcp-krita

# API http://localhost:8787
npm run dev -w @graphics-pipeline/world-builder

# UI http://localhost:5173  (second terminal)
npm run dev -w @graphics-pipeline/world-builder-client

# Vertical slice (Blender if available; else demo GLB)
./apps/blender-pipeline/run_mvp.sh hero-billboard

# Acceptance suite (same as CI)
npm run test:s1
```

### Windows Blender example

```powershell
$env:BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
& $env:BLENDER_BIN --background --python apps/blender-pipeline/png_to_glb.py -- in.png out.glb
```

### Krita MCP host

Copy `apps/mcp-krita/host-config.example.json` into your MCP host (Grok Build / VS Code / Cursor). Export timeout ≥ 60s.

## Branching & CI

```
feature|bug|enhancement/*  →  dev  →  test  →  main (prod)
```

- **Default branch = `dev`.** All feature/bug/enhancement PRs target **`dev` only**.  
- **`main` is prod** — accepts merges **only from `test`** (never from topic branches).  
- **`test`** accepts merges **only from `dev`**.  
- Required check: **`build-test`** (`.github/workflows/ci.yml`)  
- Dependabot: **patch/minor → `dev`**, ignore majors  

Details: [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) · [`docs/sprint1.5-ci-branch-schematic.md`](docs/sprint1.5-ci-branch-schematic.md)

## Authoritative docs

| Doc | Purpose |
|-----|---------|
| [`AGENTS.md`](AGENTS.md) | Short agent pointer |
| [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) | **Full agent requirements & DoD** |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Pipeline, facade, envs, live vs demo |
| [`docs/sprint1-asset-contract.md`](docs/sprint1-asset-contract.md) | Schema, paths, invariants |
| [`docs/sprint1-pipeline-diagram.md`](docs/sprint1-pipeline-diagram.md) | Pipeline schematic |
| [`docs/sprint1-viewer-wireframe.md`](docs/sprint1-viewer-wireframe.md) | Viewer UX |
| [`docs/sprint0-graphics-pipeline-research.md`](docs/sprint0-graphics-pipeline-research.md) | Discovery brief |
| [`docs/sprint2-cut-draft.md`](docs/sprint2-cut-draft.md) | Next sprint options A/B/C |
| [`SECURITY.md`](SECURITY.md) | Security reporting |

## License

- **Our code:** MIT (`LICENSE`)  
- **Future first-party Krita plugins:** GPL (see `NOTICE`)  
- **krita-mcp (wrapped):** upstream CC0 for server/plugin Python  

## Contributing

1. Read `AGENTS.md` + the asset contract.  
2. Branch from `dev` using `feature|bug|enhancement/<slug>`.  
3. Keep PRs small; do not merge semver-majors without a Sprint story.  
4. Ensure `npm run test:s1` passes.
