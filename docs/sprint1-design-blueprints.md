# Sprint 1 Design Blueprints (MVP)

**Role:** Graphics_Bot_Designer  
**Source:** Sprint 0 research (`/workspace/sprint0-graphics-pipeline-research.md`)  
**Scope:** Thin vertical slice only — Krita PNG → Blender GLB → MERN + R3F viewer  
**Date:** 2026-10-24

---

## 1. MCP ↔ Krita surface

### Host config (local stdio)

```json
{
  "mcpServers": {
    "krita": {
      "command": "uvx",
      "args": ["krita-mcp"]
    }
  }
}
```

### Required tools for MVP (minimum set)

| Tool | Purpose | Success | Failure |
|------|---------|---------|---------|
| `health` | Krita GUI reachable | `{ "ok": true, "krita": "running" }` | Clear error if Krita down |
| `export_png` / canvas export | Write scene to disk | Absolute path to PNG with alpha | Timeout / no doc open |
| (optional) `new_canvas` / `open_file` | Create or load doc | Doc id / path | Invalid size/path |

### Contract

```
MCP client (Grok Build / VS Code host)
  → stdio JSON-RPC (krita-mcp)
    → localhost plugin HTTP inside Krita GUI
      → PNG on disk: data/inbox/{assetSlug}/{timestamp}.png
```

**Hard constraints (design):** Krita must be installed + GUI running before smoke. No headless painting in Sprint 1. Logs only on stderr. Raise export timeout ≥ 60s in host config notes.

**Out of Sprint 1:** Full 57-tool surface, pixel-write native helper, kritarunner batch path.

---

## 2. PNG → Blender → GLB pipeline schematic

```
[Krita GUI + krita-mcp]
        │ export_png
        ▼
 data/inbox/{slug}/{ts}.png     ← alpha PNG, RGBA
        │
        ▼
 blender --background --python apps/blender-pipeline/png_to_glb.py -- \
     <in.png> <out.glb>
        │
        ├─ import as Mesh Plane (bpy.ops.image.import_as_mesh_planes)
        ├─ optional: 1-bone armature + Automatic Weights (MVP ok)
        ├─ trivial Action e.g. "spin" (Y 0→90°, ≥2 keyframes)
        └─ export GLB: export_animations=True, export_skins=True
        ▼
 data/assets/{assetId}/model.glb
 data/assets/{assetId}/preview.png   ← copy or thumbnail of source PNG
```

**Canonical animated artifact:** `.glb` only.  
**OBJ:** static mesh example only — never the anim path (Tester hard-fail if used for clips).

**CLI wrapper:** `apps/blender-pipeline/pipeline.sh` → same args.

**Defer:** Rigify, Mixamo, extrude/solidify, AI mesh, anim permutation matrix.

---

## 3. Asset / world-builder shape

### Monorepo layout (design)

```
/
  apps/mcp-krita/           # host config notes + plugin install docs
  apps/blender-pipeline/    # png_to_glb.py, pipeline.sh
  apps/world-builder/       # Express + Vite React + R3F
  packages/asset-schema/    # shared Zod/TS types (this schema)
  data/inbox/               # raw Krita PNG drops
  data/assets/{id}/         # model.glb, preview.png
  docs/
  LICENSE
  README.md
```

### Metadata schema (Mongo `assets`)

```ts
{
  id: string;              // uuid
  slug: string;            // kebab-case, unique, used in paths
  name: string;
  characterType: "billboard" | "prop" | "humanoid" | "unknown"; // MVP: billboard|prop
  tags: string[];
  clips: string[];         // Action names from GLB, e.g. ["spin"]
  paths: {
    glb: string;           // relative: assets/{id}/model.glb
    preview: string;       // assets/{id}/preview.png
    sourcePng?: string;    // optional inbox path
  };
  format: "glb";           // enum — never "obj" for animated
  createdAt: string;       // ISO
  updatedAt: string;
}
```

### Naming conventions

| Artifact | Pattern | Example |
|----------|---------|---------|
| Asset slug | `^[a-z0-9]+(-[a-z0-9]+)*$` | `hero-billboard` |
| Inbox PNG | `data/inbox/{slug}/{YYYYMMDD-HHMMSS}.png` | `data/inbox/hero-billboard/20261024-193500.png` |
| GLB | `data/assets/{id}/model.glb` | always `model.glb` |
| Preview | `data/assets/{id}/preview.png` | always `preview.png` |
| Action clips | lowercase verbs | `spin`, `idle`, `walk` |

### Express API (MVP surface)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/assets` | List metadata |
| `GET` | `/api/assets/:id` | One doc |
| `POST` | `/api/assets` | Register after pipeline (body = metadata + paths) |
| `GET` | `/api/assets/:id/file` | Stream `model.glb` from disk |
| `GET` | `/api/assets/:id/preview` | Stream preview PNG |

Auth off. Bind localhost. Files on disk; Mongo holds metadata only.

### World-builder UX (wireframe — thin)

```
┌─────────────────────────────────────────────────┐
│  Asset Library          │  Viewer (R3F Canvas)  │
│  ─────────────────      │  orbit + ground plane │
│  [search]               │  GLB loaded via useGLTF│
│  • hero-billboard       │                       │
│  • crate-prop     ◄─── selected                 │
│                         │  Clip: [spin ▼] [Play]│
│  [Import GLB…]          │                       │
└─────────────────────────────────────────────────┘
```

**Viewer must:** load selected GLB, list `gltf.animations` names, play chosen clip via `AnimationMixer`, no console errors on happy path.

---

## 4. Handoff map

| Story | Owner | Consumes this blueprint |
|-------|-------|-------------------------|
| S1-D1 schema + naming | Designer ✓ (this §3) | — |
| S1-D2 UX wireframe | Designer ✓ (this §3 wireframe) | — |
| S1-D3 pipeline diagram | Designer ✓ (this §2) | — |
| S1-E1–E4 | Engineer | §1–§3 |
| S1-T1–T3 | Tester | AC aligns with §1 health fail, §2 GLB-not-OBJ, §3 load+clip |

**Ready for Leader** to cut Sprint 1 stories + Tester AC against this file.
