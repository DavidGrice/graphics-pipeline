# Pipeline diagrams (S3-G E3 #150)

Source of truth for codes: [`error-codes.md`](error-codes.md). These diagrams are text only; `npm run lint:ci`
parses every `mermaid` block under `docs/` (no rendered images in git).

## Krita → Blender → register → R3F

```mermaid
flowchart LR
  Krita["Krita 5.2+ (krita-mcp bridge)"] -->|export_png| Inbox["data/inbox/slug/ts.png"]
  Inbox -->|png_to_glb.py, BLENDER_BIN| Blender["Blender 5.2.3 LTS"]
  Blender --> GLB["data/assets/id/model.glb + preview.png"]
  GLB -->|register_asset.mjs| API["world-builder API (Express)"]
  API -->|probe wins| Mongo[("Mongo or JSON store")]
  API -->|/api/assets, scenes| UI["world-builder client (Vite + R3F)"]
```

## Register flow (probe, V4 / V4a, codes)

```mermaid
flowchart TD
  Req["POST /api/assets"] --> Size{"size within MAX_GLB_MB?"}
  Size -- no --> E413["413 GLB_TOO_LARGE"]
  Size -- yes --> Probe["probe_glb.mjs (probe wins)"]
  Probe -- bad magic or JSON --> Corrupt["GLB_CORRUPT"]
  Probe -- ok --> Schema{"schema v3 + importMeta valid?"}
  Schema -- no --> Val["400 VALIDATION with field"]
  Schema -- yes --> Stage{"stage = scene?"}
  Stage -- no --> Ok["201 registered"]
  Stage -- yes --> Resolve{"children resolve?"}
  Resolve -- unknown id or slug --> V4["400 SCENE_RESOLVE (V4)"]
  Resolve -- ambiguous slug --> V4a["400 SCENE_RESOLVE (V4a)"]
  Resolve -- ok --> Ok
```
