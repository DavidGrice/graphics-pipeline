# Sprint 1 Asset Contract

**Role:** Graphics_Bot_Designer  
**Locks from user (2026-10-24):** MERN yes · baby-step toward full 2D→3D rigged scenes · all-OS (dev on Windows) · wrap krita-mcp now, first-party bridge as end state (license-safe) · full 3D anim/rigging goal · Blender version-agnostic, prefer latest  
**Companion:** `/workspace/sprint1-design-blueprints.md`

---

## 1. Decisions locked into this contract

| Topic | Sprint 1 (ship) | End state (design toward) |
|-------|-----------------|---------------------------|
| Stack | MERN + R3F | same |
| Character | **billboard** (mesh plane + trivial Action) | full mesh + armature/weights + clip library |
| OS | paths/scripts work Win/Linux/mac; CI Linux | same |
| Krita bridge | **wrap krita-mcp** behind our thin facade | replace facade body with first-party MCP+plugin (MIT/Apache our code; GPL only for in-Krita plugin if required) |
| Formats | **GLB canonical** for anything with skins/clips; OBJ allowed **static-only** | GLB primary; FBX optional interchange; never OBJ for anim |
| Blender | call latest stable via CLI; no hardcode of one minor if avoidable; document tested version in README | same |

---

## 2. Identity & naming

| Field | Rule | Example |
|-------|------|---------|
| `id` | UUID v4 | `a1b2c3d4-…` |
| `slug` | `^[a-z0-9]+(-[a-z0-9]+)*$`, unique | `hero-billboard` |
| Inbox PNG | `data/inbox/{slug}/{YYYYMMDD-HHMMSS}.png` | `data/inbox/hero-billboard/20261024-194500.png` |
| GLB | always `data/assets/{id}/model.glb` | — |
| Preview | always `data/assets/{id}/preview.png` | — |
| Static OBJ (optional) | `data/assets/{id}/model.obj` (+ `.mtl` if any) | never listed in `clips` |
| Clip names | lowercase verbs | `spin`, `idle`, `walk` |

---

## 3. Mongo `assets` document (Zod-shaped)

```ts
{
  id: string;
  slug: string;
  name: string;
  characterType: "billboard" | "prop" | "humanoid" | "unknown";
  // Sprint 1 ships billboard | prop only; humanoid reserved for later
  stage: "mvp-billboard" | "rigged" | "scene"; // progression flag
  tags: string[];
  clips: string[];           // Action/clip names present in GLB; [] if static-only
  formats: {
    glb?: string;            // relative path — required if clips.length > 0
    obj?: string;            // relative path — static only; forbidden if clips.length > 0
    preview: string;
    sourcePng?: string;
  };
  rig: {
    hasArmature: boolean;
    hasWeights: boolean;
    blenderVersionTested?: string; // e.g. "5.0.0" — informational
  };
  createdAt: string;         // ISO-8601
  updatedAt: string;
}
```

**Invariants (Tester AC):**

1. If `clips.length > 0` → `formats.glb` required; `formats.obj` must be absent or ignored for playback.
2. If only `formats.obj` → `clips` must be `[]`, `rig.hasArmature` / `hasWeights` false.
3. `characterType: "billboard"` in Sprint 1 implies mesh-plane provenance + at least one trivial clip preferred (`spin`).

---

## 4. Disk layout

```
data/
  inbox/{slug}/{ts}.png
  assets/{id}/
    model.glb          # required for animated
    model.obj          # optional static
    preview.png
    source.png         # optional retained Krita export
```

Express serves files from disk; Mongo never stores binary in Sprint 1.

---

## 5. Krita facade (license-safe wrap)

```
apps/mcp-krita/
  facade/          # OUR MIT/Apache tools: health, export_png → stable names/paths
  vendor-notes/    # how we currently shell to krita-mcp (not vendored copy)
```

Sprint 1 tools exposed to Grok Build / VS Code host (stable names — do not leak vendor tool ids):

- `health` → fail loud if Krita GUI down  
- `export_png` → writes inbox path, returns `{ path, slug, ts }`

End state: swap vendor process for first-party stdio MCP + GPL pykrita plugin without changing tool names or path contract.

---

## 6. Pipeline I/O contract

**In:** absolute or repo-relative PNG (RGBA preferred).  
**Out:** `model.glb` with ≥1 mesh; Sprint 1 target ≥1 Action named in `clips`.  
**CLI:**

```bash
blender --background --python apps/blender-pipeline/png_to_glb.py -- \
  <in.png> <out.glb>
```

Version-agnostic: script uses stable `bpy` ops (`import_as_mesh_planes`, `export_scene.gltf`); README lists last tested Blender (prefer latest stable).

---

## 7. World-builder API (unchanged surface, tighter types)

| Method | Path | Body / result |
|--------|------|----------------|
| `GET` | `/api/assets` | `Asset[]` metadata |
| `GET` | `/api/assets/:id` | one `Asset` |
| `POST` | `/api/assets` | create from pipeline output (validates invariants) |
| `GET` | `/api/assets/:id/file` | streams GLB (or 404); query `?format=obj` only if static |
| `GET` | `/api/assets/:id/preview` | streams preview |

Viewer: R3F `useGLTF` + clip picker bound to `clips[]`.

---

## 8. Handoff

@Graphics_Bot_Leader — contract ready for Sprint 1 cut.  
@Graphics_Bot_Engineer — scaffold against §2–§7.  
@Graphics_Bot_Tester — invariants in §3 are hard AC; plus Krita-down on `health`.
