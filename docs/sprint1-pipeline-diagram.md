# S1-D2 — Pipeline diagram (MVP)

```
┌──────────────────────────┐
│  Grok Build / VS Code    │
│  MCP host                │
└────────────┬─────────────┘
             │ stdio (health, export_png)
             ▼
┌──────────────────────────┐
│  apps/mcp-krita/facade   │  ← our adapter seam
│  → krita-mcp (CC0) S1    │
│  → first-party later     │
└────────────┬─────────────┘
             │ localhost HTTP (inside Krita GUI)
             ▼
┌──────────────────────────┐
│  Krita 5.2+ (GUI up)     │
│  export RGBA PNG         │
└────────────┬─────────────┘
             │ data/inbox/{slug}/{ts}.png
             ▼
┌──────────────────────────┐
│  blender -b -P           │  CI pin 5.2.3 LTS
│  png_to_glb.py           │  ≥4.2 via bpy.app.version
│  Mesh Plane + Action     │
│  export GLB (+skins/anim)│
└────────────┬─────────────┘
             │ data/assets/{id}/model.glb
             │ + preview.png + Mongo metadata
             ▼
┌──────────────────────────┐
│  Express (MERN)          │
│  GET /api/assets…        │
│  static disk serve       │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  React + R3F viewer      │
│  useGLTF → play clips[]  │
└──────────────────────────┘
```

**Format rule:** animated/rigged → GLB (primary) or FBX; OBJ = static-only, never anim path.

**Defer:** custom Krita bridge body, Rigify/Mixamo, multi-clip matrix, EEVEE, auth.
