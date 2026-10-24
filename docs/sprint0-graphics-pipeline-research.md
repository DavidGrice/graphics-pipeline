# Sprint 0 Discovery — Graphics Pipeline Research Brief

**Role:** Graphics_Bot_Researcher  
**Epic:** Krita MCP (Grok Build) → 2D scenes → Blender 3D (rigs/weights + anim permutations) → MERN/MEAN + Three.js world-builder asset library  
**Constraints:** Local VS Code, open-source GitHub  
**Date:** 2026-10-24  
**Method:** WebSearch + WebFetch of primary docs; no invented APIs

---

## 1. Executive recommendation

- **Adopt an existing Krita MCP bridge** rather than inventing one: `krita-mcp` (PyPI **v1.8.1**, CC0 server/plugin; Krita 5.2+) or a thinner community pattern (Krita pykrita plugin HTTP on localhost ↔ FastMCP/stdio MCP). Pattern is consistently: **MCP client → stdio MCP server → localhost HTTP/plugin → live Krita process**.
- **Krita must be installed and running** (GUI process) for live MCP painting/export. True headless is limited (`kritarunner` / batch scripts; often still needs a display on Unix). GPL-3.0 app license is OSS-friendly; artwork remains the creator’s property.
- **Hard format call-out:** **OBJ has no skeletal animation / bones / skinning.** Use **glTF 2.0 / `.glb`** (primary) or **FBX** for animated assets. Keep OBJ only as an optional static mesh export example.
- **MVP 2D→3D path:** Krita PNG (alpha) → Blender **Add → Image → Mesh Plane** (`bpy.ops.image.import_as_mesh_planes`) → optional simple armature + Automatic Weights → export **GLB** with `export_animations=True`, `export_skins=True`. Defer AI mesh (TRELLIS etc.), photogrammetry, and Grease Pencil character pipelines past Sprint 1.
- **Automation:** Blender headless via `blender --background --python script.py -- args`. Rigify for humanoid meta-rigs; NLA / Actions for clip permutations; Mixamo as optional external clip source (retarget later).
- **World builder stack: recommend MERN + React Three Fiber (`@react-three/fiber` + `@react-three/drei`)**, not MEAN. R3F ecosystem (GLTF loading, helpers, physics) dominates Angular+Three for a lean local MVP; Angular Three wrappers exist but are thinner.
- **Storage:** MongoDB for asset **metadata**; **local disk** (or object folder under repo/data) for `.glb`/PNG in Sprint 1; GridFS only if files regularly exceed BSON limits / need DB-backed blobs.
- **Repo:** monorepo (`apps/mcp-krita`, `apps/blender-pipeline`, `apps/world-builder`, `packages/shared`) under MIT/Apache-2.0 for *our* code; respect GPL for Krita plugins distributed with Krita API (Krita plugin API is GPL → distributed plugins must be GPL).

---

## 2. Track 1 — MCP ↔ Krita (2D scenes)

### 2.1 What MCP is (brief)

**Model Context Protocol (MCP)** lets hosts (Claude Desktop, Cursor, Codex, Grok Bot / similar) talk to local or remote **servers** that expose:

1. **Tools** — functions the model can call (`tools/list`, `tools/call`)
2. **Resources** — readable file-like data
3. **Prompts** — reusable templates

Custom servers typically:

- Register tools with JSON Schema / Zod input schemas
- Run over **stdio** (host spawns process; JSON-RPC on stdin/stdout) or HTTP
- **Must not write logs to stdout** on stdio (use stderr) — corrupts the protocol

Primary docs:

- Build server: https://modelcontextprotocol.io/docs/develop/build-server  
- Tools spec (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/server/tools  
- TS SDK first server: https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server.md  

Example host config pattern:

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

**“Run in Grok Build”** (for this team) most likely means: an **installable local stdio MCP server** that Grok Bot / Cursor-style hosts can spawn as a child process, with tools/resources available to the agent — same pattern as Claude Desktop / Cursor MCP configs. Constraints: **local process**, Krita reachable on the same machine, tool timeouts long enough for export.

### 2.2 Driving Krita programmatically

| Mechanism | Maturity | Notes |
|-----------|----------|-------|
| **Python scripting (LibKis / `from krita import *`)** | Official, primary | `Krita.instance()`, documents, actions, export; plugins in `pykrita`. Added since Krita 4.0. |
| **Python plugins** | Official | Dockers, HTTP bridges, MCP bridges run *inside* Krita. |
| **krita-localhost** (TCP :12174) | Community | Arbitrary Python over netcat; not production-hardened. https://github.com/mafik/krita-localhost |
| **kra-remote** (WebSockets) | Community | Action/tool remote; QtWebSockets not always shipped. https://github.com/NMaghfurUsman/kra-remote |
| **kritarunner / batch** | Semi-official community | Run scripts without full interactive session; GUI often cannot be open simultaneously; Unix may still need X. |
| **D-Bus** | Not a first-class documented Krita automation path | Prefer Python API / in-process plugin HTTP. |

Official scripting intro: https://docs.krita.org/en/user_manual/python_scripting/introduction_to_python_scripting.html  

Batch tip (community/docs pattern): `doc.setBatchmode(True)` before `saveAs` to suppress dialogs.

### 2.3 Existing Krita MCP servers / bridges

**Yes — several exist (do not build from zero for Sprint 1):**

| Project | Notes | Link |
|---------|-------|------|
| **krita-mcp (PyPI v1.8.1)** | Maintained by thuanlm215; CC0 server+plugin; 57 tools; Krita 5.2+; full pixel write needs Linux + Krita 6.0.4 + native helper; install via `uvx krita-mcp install` | https://pypi.org/project/krita-mcp/ · https://github.com/thuanlm215/krita-mcp |
| **nanayax3/krita-mcp** (and forks e.g. halby24) | Plugin HTTP `:5678` + FastMCP `server.py`; tools: new canvas, stroke, shapes, export PNG, save, open file | https://github.com/nanayax3/krita-mcp |
| **iflow-mcp_maryfellowes-krita-mcp** | Same architecture on PyPI | https://pypi.org/project/iflow-mcp_maryfellowes-krita-mcp/ |
| **Thunda10 PaintBridge** | Commercial itch.io bridge (25 tools); Cursor/Claude guides | https://thunda10.itch.io/paintbridge |

**Thinnest realistic bridge if rolling our own:**

1. Small **pykrita plugin** with localhost HTTP (or reuse krita-localhost) exposing: `health`, `open`, `new_document`, `export_png`, `list_layers`.
2. **stdio MCP server** (Python `mcp` SDK or FastMCP / TS `@modelcontextprotocol/server`) that POSTs to that HTTP API.
3. Tools return **file paths** (PNG/KRA) as text/resources for the next pipeline stage.

### 2.4 Blockers (Track 1)

| Blocker | Severity | Mitigation |
|---------|----------|------------|
| Krita must be **installed locally** | High | Document install; CI skip live tests or use smoke-only |
| Live MCP needs **running Krita GUI** | High | Start Krita before agent session; health tool |
| Platform: user may be Windows; agent box is Linux | Medium | Cross-platform pykrita paths; test both; native helper for krita-mcp pixel ops is Linux/Krita 6.0.4-specific |
| Export timeouts (~30s default on some bridges) | Medium | Raise timeouts on MCP + plugin (documented in nanayax3 README) |
| **GPL-3.0** for Krita + plugin API | Medium (legal/OSS) | App GPL OK; **distributed Krita plugins must be GPL**; our standalone MCP server can be MIT/CC0 if separated (krita-mcp uses CC0 for server/plugin Python; native helper GPL) |
| Headless painting | High for “no GUI” goal | Defer; use file-watch + kritarunner for batch export-only paths |

**License (Krita):** GPL v3 application; artwork you create is yours with no restrictions. Plugins that use the extension API and are distributed must be shared under GPL. Source: https://krita.org/en/about/license/

---

## 3. Track 2 — Blender: 2D/flat → mesh + armature/weights + anim clips

### 3.1 Practical 2D → 3D paths (maturity vs MVP)

| Path | Maturity | MVP fit |
|------|----------|---------|
| **Mesh Plane from PNG** (Add → Image → Mesh Plane) | Built-in Blender 4.2+ / 5.x | **Best MVP** — textured billboard/card with alpha; scriptable |
| **Silhouette extrude / solidify** from alpha mask | Manual + bpy | Good Sprint 2 for “chunky” 2.5D props |
| **Grease Pencil** | Mature for 2D-in-3D line art | Different pipeline (not image→mesh character); later |
| **Depth-from-image / normal/height** | Medium | Artistic; needs depth maps from Krita filters |
| **Photogrammetry-lite** | Heavy | Out of scope for lightweight sprint |
| **AI mesh (e.g. TRELLIS-based local apps)** | Emerging / heavy deps | Optional later; not Sprint 1 |

Mesh Plane docs: https://docs.blender.org/manual/en/latest/modeling/meshes/import_images_as_planes.html  
API operator family: `bpy.ops.image.import_as_mesh_planes` (see Image Operators API).

### 3.2 Armature, weights, export — **OBJ warning**

**OBJ (Wavefront):** geometry + optional MTL materials. **No skeletal bones, skinning, or animation clips.** Library of Congress / engine docs treat it as static mesh exchange. **Do not use OBJ as the animated pipeline format.**

**Recommended exports for this epic:**

| Format | Skinning | Animation | Three.js |
|--------|----------|-----------|----------|
| **glTF 2.0 / `.glb`** | Yes (`export_skins`) | Yes (`export_animations`, NLA/Actions modes) | **First-class** (`GLTFLoader`) |
| **FBX** | Yes | Yes (`bake_anim`, NLA strips, all actions) | Via FBXLoader (heavier); prefer convert to GLB |
| **OBJ** | No | No | Static only |

Blender export API: https://docs.blender.org/api/current/bpy.ops.export_scene.html  

Key glTF flags: `export_animations=True`, `export_skins=True`, `export_animation_mode='ACTIONS'|'NLA_TRACKS'|...`, `export_format` binary GLB.

**Rigging options:**

- **Armature + Automatic Weights** — fastest MVP bind (`Armature Deform` with auto weights).
- **Rigify** — official add-on; meta-rigs (Basic Human, Human, quadrupeds, etc.); Generate Rig; deform bones in **DEF** collection; then Automatic Weights. Docs: https://docs.blender.org/manual/en/latest/addons/rigify/basics.html  
- **Mixamo** — external auto-rig + clip library; import FBX into Blender, retarget to Rigify/custom (community add-ons); good for anim **permutations** later, not required for Sprint 1 vertical slice.

### 3.3 Animation permutations

- **Actions** as named clips (`Idle`, `Walk`, `Attack`) on one armature.
- **NLA Editor** — stack/blend strips; FBX/glTF can export NLA strips as separate anim stacks/animations (`bake_anim_use_nla_strips`, `export_nla_strips` / `NLA_TRACKS` mode).
- **Parameterize by character type:** metadata JSON `{ "rig": "humanoid"|"quad"|"prop", "clips": ["idle","walk"], "scale": 1.0 }` driving which Rigify meta-rig and which action library to append.
- Procedural walk cycles: possible via bpy drivers/scripts; defer to later sprints.

### 3.4 bpy / headless CLI

```bash
blender --background --python pipeline.py -- /path/in.png /path/out.glb
```

- `--background` / `-b`: no UI  
- `--python` / `-P`: run script with full `bpy`  
- Args after `--` are for the script  

Also: Blender as a Python module (advanced installs) — optional; CLI is enough for MVP.

### 3.5 Blockers (Track 2)

| Blocker | Notes |
|---------|-------|
| Image-plane ≠ full 3D character | MVP proves pipeline; “real” mesh gen is later |
| Auto-weights need decent topology | Cards/planes have trivial topology; extrude meshes need care |
| Mixamo ToS / network | Optional; keep offline Rigify+hand clips for OSS purity |
| Blender version drift | Pin Blender LTS (e.g. 4.2/5.x LTS) in README |
| Three.js needs GLB | Pipeline must emit `.glb` as canonical artifact |

Three.js: load glTF; use `AnimationMixer` + clips from `gltf.animations`. Docs hub: https://threejs.org/docs/ (AnimationMixer, GLTFLoader).

---

## 4. Track 3 — World builder: MERN vs MEAN + Three.js

### 4.1 Comparison

| Dimension | **MERN** (React) | **MEAN** (Angular) |
|-----------|------------------|--------------------|
| Three.js fit | **react-three-fiber** — declarative scene, huge ecosystem (`drei`, `gltfjsx`, rapier, postprocessing) | Vanilla Three in Angular services/components; fewer maintained wrappers |
| Learning curve | Lower for small teams / MVP | Steeper (RxJS, DI, modules) |
| OSS templates | Abundant R3F + Vite/Next starters | Fewer Three-centric MEAN starters |
| Local-first asset lab | Excellent | Viable but more boilerplate |
| Enterprise structure | You assemble libs | Opinionated framework |

R3F intro: https://docs.pmnd.rs/react-three-fiber/getting-started/introduction  
R3F GitHub (v9.x pairs with React 19): https://github.com/pmndrs/react-three-fiber  

### 4.2 Recommendation

**Choose MERN + `@react-three/fiber` + `@react-three/drei`.**

Rationale for this graphics team: local MVP speed, best GLB/animation tooling (`useGLTF`, `<Canvas>`, clip playback), largest OSS ecosystem, aligns with Node/Express already shared with MEAN’s backend half.

### 4.3 Minimal architecture (Sprint 1+)

```
[Browser: React + R3F viewer/editor]
        ↕ REST/JSON
[Express API]
  - GET/POST /api/assets  (metadata)
  - POST /api/assets/upload  (multipart → disk)
  - GET /api/assets/:id/file  (stream .glb)
[MongoDB]  asset docs: name, tags, characterType, clips[], paths, createdAt
[Local disk]  ./data/assets/{id}/model.glb, preview.png
```

- **Auth:** optional / off for local MVP (localhost bind).  
- **GridFS:** defer; use when multi-machine sync or >16MB BSON concerns dominate. GridFS docs: https://www.mongodb.com/docs/drivers/node/current/crud/gridfs/  
- **Viewer MVP features:** orbit camera, load GLB, list/play animation clips by name, place asset on a ground plane, save scene JSON (asset id + transform).

### 4.4 GitHub OSS structure

**Monorepo recommended** (pnpm/npm workspaces or Turborepo):

```
/
  apps/mcp-krita/          # stdio MCP + optional vendor plugin notes
  apps/blender-pipeline/   # bpy scripts + shell entrypoints
  apps/world-builder/      # Express + React (Vite) + R3F
  packages/asset-schema/   # shared Zod/TS types
  docs/                    # pipeline diagrams, licenses
  LICENSE
  README.md
```

Multi-repo only if release cadences diverge badly.

---

## 5. Thin MVP slice (Sprint 1) — vertical proof

**Goal:** One PNG from Krita (via MCP or scripted export) → Blender headless → `.glb` → visible in local Three.js (R3F) viewer.

### Ordered steps

1. **Scaffold monorepo** + README (Blender/Krita versions, license notes).
2. **Krita:** Install `krita-mcp` *or* minimal plugin; tools: `health`, `new_canvas` / `open_file`, `export`/`get_canvas` → `out/scene.png`.
3. **Blender script** `png_to_glb.py`: import mesh plane → (optional) single-bone or simple armature + auto weights → bake one trivial Action (e.g. rotate Y 0→90) → `bpy.ops.export_scene.gltf(..., export_format='GLB', export_animations=True, export_skins=True)`.
4. **CLI wrapper** `pipeline.sh`: `blender -b -P png_to_glb.py -- in.png out.glb`.
5. **World builder stub:** Vite React + R3F; `useGLTF('/assets/demo.glb')`; play first clip if present; Express static serve `./data`.
6. **Acceptance (Tester):** Given Krita running + PNG export path, pipeline produces GLB; viewer loads without console errors; clip list non-empty if anim exported.

### Defer (explicitly out of Sprint 1)

- Full Rigify humanoid + Mixamo retarget library  
- AI mesh / TRELLIS  
- Animation permutation matrix by character type  
- MEAN  
- Auth, GridFS, multi-user world editing  
- Paint.Net path  
- Perfect GPL plugin packaging story beyond documenting it  

---

## 6. Open questions for the user

1. **Confirm MERN** (recommended) vs strong preference for MEAN/Angular?
2. **Sample character type** for first anim set: stylized humanoid billboard, side-view 2.5D fighter, or prop-only (no rig)?
3. **OS target for “local VS Code”:** Windows, Linux, macOS, or all three? (Affects Krita paths + krita-mcp native helper.)
4. **OK to depend on existing `krita-mcp` (CC0)** vs first-party thin bridge only?
5. **Canonical animated format:** agree **GLB-only** (OBJ as optional static)?
6. **Blender version pin** preference (4.2 LTS vs 5.x)?

---

## 7. Suggested Sprint 1 story titles

**Designer**

- S1-D1: Asset metadata schema + GLB naming conventions (tags, clips, characterType)  
- S1-D2: World-builder UX wireframe (library list + viewer + clip picker)  
- S1-D3: Pipeline diagram (Krita → PNG → Blender → GLB → MERN)

**Engineer**

- S1-E1: Wire `krita-mcp` (or thin bridge) into local MCP host config + `export_png` smoke  
- S1-E2: Headless `png_to_glb.py` with Mesh Plane + trivial Action + GLB export  
- S1-E3: Express + disk storage + `GET /api/assets`  
- S1-E4: R3F viewer loads GLB and plays named clips  

**Tester**

- S1-T1: Acceptance criteria checklist for vertical slice  
- S1-T2: Regression: OBJ export (if present) documented as static-only; GLB carries anim  
- S1-T3: Platform smoke matrix (Krita running / not running → clear error)  

**Leader / cross-cutting**

- S1-L1: Monorepo + LICENSE + CONTRIBUTING + pinned tool versions  
- S1-L2: Decide MERN confirmation + character type from user answers  

---

## 8. Primary source index

| Topic | URL |
|-------|-----|
| MCP build server | https://modelcontextprotocol.io/docs/develop/build-server |
| MCP tools spec | https://modelcontextprotocol.io/specification/2026-07-28/server/tools |
| Krita Python scripting | https://docs.krita.org/en/user_manual/python_scripting/introduction_to_python_scripting.html |
| Krita license | https://krita.org/en/about/license/ |
| krita-mcp PyPI | https://pypi.org/project/krita-mcp/ |
| krita-mcp GitHub | https://github.com/thuanlm215/krita-mcp |
| Community Krita MCP pattern | https://github.com/nanayax3/krita-mcp |
| krita-localhost | https://github.com/mafik/krita-localhost |
| Blender Mesh Plane | https://docs.blender.org/manual/en/latest/modeling/meshes/import_images_as_planes.html |
| Blender export_scene API | https://docs.blender.org/api/current/bpy.ops.export_scene.html |
| Rigify basics | https://docs.blender.org/manual/en/latest/addons/rigify/basics.html |
| React Three Fiber | https://docs.pmnd.rs/react-three-fiber/getting-started/introduction |
| Three.js docs | https://threejs.org/docs/ |
| MongoDB GridFS (Node) | https://www.mongodb.com/docs/drivers/node/current/crud/gridfs/ |
| OBJ format profile (LoC) | https://www.loc.gov/preservation/digital/formats/fdd/fdd000507.shtml |

---

*End of Sprint 0 research brief. Ready for Leader to cut Sprint 1 stories after user answers §6.*
