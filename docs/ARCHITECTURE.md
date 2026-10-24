# Architecture

**Audience:** agents and humans changing the pipeline.  
**Companion:** [`AGENT_GUIDE.md`](./AGENT_GUIDE.md) · asset contract [`sprint1-asset-contract.md`](./sprint1-asset-contract.md)

## Pipeline (authoritative flow)

```
MCP host (Grok Build / VS Code / Cursor)
    │ stdio — tools: health, export_png only
    ▼
apps/mcp-krita  (KritaBridgeAdapter facade)
    │ Sprint 1: wraps krita-mcp (CC0)
    │ Later: first-party MIT MCP ↔ GPL pykrita plugin (same tool names)
    ▼
Krita GUI (must be running for live export)
    │
    ▼
data/inbox/{slug}/{YYYYMMDD-HHMMSS}.png
    │
    ▼
apps/blender-pipeline/png_to_glb.py
    │ blender --background  (BLENDER_BIN; pin 5.2.3 LTS; ≥4.2 OK)
    │ Mesh Plane + trivial Action → export GLB (animations + skins)
    ▼
data/assets/{id}/model.glb (+ preview.png)
    │
    ▼
apps/world-builder (Express :8787)
    │ Mongo metadata (optional; in-memory fallback)
    │ GET/POST /api/assets · GET …/file · GET …/preview
    ▼
apps/world-builder/client (Vite R3F :5173)
    useGLTF → AnimationMixer · clips[] from metadata/GLB
```

Diagram (ASCII/mermaid): also `sprint1-pipeline-diagram.md`. Viewer UX: `sprint1-viewer-wireframe.md`.

## Components

| Path | Responsibility | Do not |
|------|----------------|--------|
| `packages/asset-schema` | Zod Asset model; path helpers | Drift from asset contract |
| `apps/mcp-krita` | Stable facade tools; vendor behind adapter | Bind callers to vendor tool IDs |
| `apps/blender-pipeline` | Headless PNG→GLB; clear fail if no Blender | Depend on EEVEE; invent second anim format |
| `apps/world-builder` | REST + disk serve | Store binaries in Mongo (Sprint 1) |
| `apps/world-builder/client` | Library + viewport + clip Play | Treat OBJ as animatable |
| `data/*` | Runtime only | Commit media (CI fail-closed) |
| `.github/workflows/ci.yml` | Job **`build-test`** | Require Krita/Blender on runner |

## Facade seam (why it exists)

```
Host  →  our tool names (health, export_png)
              │
              ├─ BRIDGE=vendor → krita-mcp (now)
              └─ BRIDGE=firstparty → our MCP + GPL plugin (Sprint 2 B)
```

Path contract and tool names **must not change** when the body swaps. License split: MIT server process; GPL only for distributed LibKis plugin code (`NOTICE`).

## Asset shape (summary)

- **Animated:** `formats.glb` (or `fbx`) + `clips[]`; `rig.hasArmature` / `hasWeights` as applicable.  
- **Static:** `formats.obj` allowed only with `clips: []` and no armature claims.  
- **IDs/paths:** UUID `id`; kebab `slug`; files always `model.glb` / `preview.png` under `data/assets/{id}/`.

Full invariants: `sprint1-asset-contract.md`. Tests: `npm run test:s1`.

## Promotion path (envs) — enforced

```
feature|bug|enhancement/*  →  dev  →  test  →  main (prod)
         (topic PRs)           ↑       ↑         ↑
                          only from   only     only from
                          topic br.   from     test
                                      dev
```

| Env | Git branch | Role |
|-----|------------|------|
| `dev` | `dev` | **Default branch** · integration tip · Dependabot · all feature/bug/enhancement PRs |
| `test` | `test` | Pre-prod · accepts PRs **only from `dev`** |
| `prod` | `main` | Production · accepts PRs **only from `test`** |

**Agents: never open a PR into `main` or `test` from a topic branch.** Base = **`dev`**. Promote only via `dev`→`test` then `test`→`main` after green `build-test`.

Protect `main` / `dev` / `test` with required check **`build-test`**. Topic branches (`feature|bug|enhancement/*`) stay direct-push.

## Live vs demo (agents must not confuse these)

| Path | When | Valid for |
|------|------|-----------|
| **Live** | Krita GUI up + real `export_png` + real `BLENDER_BIN` | Windows smoke / Sprint 2 A AC |
| **Demo** | `run_mvp.sh` / `make_demo_glb` without Blender/Krita | Local UI/API wiring; **not** live AC |

CI never needs live path. `health` must not report OK if Krita GUI is down (facade contract).

## Change rules

1. Schema/API change → update **Zod + asset contract + tests** in the same PR.  
2. No drive-by semver-majors (React 19, zod 4, Express 5, …).  
3. Prefer smallest vertical-slice-preserving change.  
4. Read `AGENT_GUIDE.md` DoD before opening a PR.
