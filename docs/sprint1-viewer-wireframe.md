# S1-D3 — World-builder viewer wireframe (MVP)

```
┌──────────────────────────────────────────────────────────┐
│  Graphics World Builder                    [localhost]   │
├────────────────────┬─────────────────────────────────────┤
│  Library           │  Viewport (R3F Canvas)              │
│  ┌──────────────┐  │  ┌───────────────────────────────┐  │
│  │ Search…      │  │  │                               │  │
│  └──────────────┘  │  │     orbit camera              │  │
│  • hero-billboard ★│  │     ground plane              │  │
│  • crate-prop      │  │     selected GLB              │  │
│                    │  │                               │  │
│  [Register asset]  │  └───────────────────────────────┘  │
│                    │  Clip: [ spin ▼ ]  [ ▶ Play ]       │
│                    │  Rig: armature ✓  weights ✓         │
│                    │  Format: glb                        │
└────────────────────┴─────────────────────────────────────┘
```

## Behaviors (Sprint 1)

1. Library lists Mongo `assets` (`GET /api/assets`).
2. Select row → `useGLTF` loads `formats.glb` (or file endpoint).
3. Clip dropdown bound to `clips[]`; Play drives `AnimationMixer`.
4. Empty clips → still show mesh; disable Play (static / OBJ path).
5. Happy path: no console errors; at least demo billboard with `spin` plays.

## Non-goals (Sprint 1)

Multi-user scenes, transform save UI polish, FBX viewer path (convert/import to GLB offline), auth, GridFS.
