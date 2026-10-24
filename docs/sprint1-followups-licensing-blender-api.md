# Sprint 1 Follow-ups — Krita Licensing Path + Blender API Deltas

**For:** Graphics_Bot_Researcher → Engineer (S1-E1 wrap krita-mcp; S1-E3 blender pipeline)  
**Date fetched:** 2026-10-24  
**Locks:** Wrap `krita-mcp` now; later first-party Krita bridge (avoid licensing traps); Blender **latest preferred**, scripts **version-tolerant**; **GLB** primary for anim/rig.  
**Disclaimer:** Not legal advice. Cite project pages + FSF FAQ language quoted via secondary sources; have counsel review before shipping dual-license packaging.

**Companion:** `/workspace/sprint0-graphics-pipeline-research.md`

---

## Group-chat-ready summary

- **Latest Blender (official):** **5.2.3 LTS** (released 2026-10-22) — https://www.blender.org/download/ · 5.2 LTS supported until ~July 2028. 5.3 expected ~2026-11-10 (not yet stable).
- **Krita plugin (LibKis / pykrita):** if **distributed**, must be **GNU GPL** — krita.org: extension API is GPL; “if you distribute a Krita plugin it also has to be shared under the GNU GPL.” https://krita.org/en/about/license/
- **Separate stdio MCP server** talking to the plugin over **localhost HTTP/JSON** is the common dual-component pattern: keep plugin **GPL-3.0**; server can be **MIT/Apache-2.0** if it contains **no** GPL’d Krita/plugin code and only exchanges wire-protocol messages (pipes/sockets = normally separate programs per FSF FAQ criteria). **Risk:** intimate shared data structures / embedding plugin code into the server blurs “separate program.” Prefer clear process boundary + documented JSON schema. Not legal advice.
- **Repo layout:** `apps/krita-plugin/` (GPL-3.0) + `apps/mcp-krita-server/` (MIT or Apache-2.0) + root NOTICE; do not merge into one LICENSE.
- **Sprint 1:** wrap **`krita-mcp` v1.8.1** (CC0 server+plugin on PyPI; native helper GPL if built) — https://pypi.org/project/krita-mcp/
- **Blender Mesh Plane:** `bpy.ops.image.import_as_mesh_planes(...)` exists in **4.2 and 5.0+** (built-in `startup/bl_operators`, not a separate enableable “Images as Planes” addon). Prefer this over legacy addon name.
- **glTF flags we need are stable on current API:** `export_animations`, `export_skins`, `export_format` (use `'GLB'` / binary). Still present on current docs: https://docs.blender.org/api/current/bpy.ops.export_scene.html
- **Adapter:** `ver = bpy.app.version`; branch only if an attr missing; CI pin **5.2.3**; document supported range **≥ 4.2**.
- **Headless:** `blender --background --python script.py -- args` works for mesh/export (no EEVEE/OpenGL render required). Linux: EEVEE headless needs display/GL; Windows EEVEE headless historically unsupported — **our MVP should not depend on EEVEE**.

---

## A) Custom Krita bridge licensing path

### A.1 What must be GPL when shipping a first-party plugin

**Primary source — Krita Foundation:**

> “Krita can be extended with plugins written in C++ or Python. The extension API is an integral part of Krita and is licensed under the GNU General Public License. This means that **if you distribute a Krita plugin it also has to be shared under the GNU GPL**. You can charge for the download, but you cannot prevent others from distributing your plugin…”  
> — https://krita.org/en/about/license/

Also echoed by Krita Scripting School (plugin submission): plugins distributed with/for Krita must be under GNU GPL — https://scripting.krita.org/lessons/plugin-submission

**Practical meaning for us:**

| Artifact | License when distributed |
|----------|--------------------------|
| Code that `import krita` / uses LibKis / runs as pykrita plugin | **GPL** (match Krita: GPL-3.0-or-later is the safe default aligned with Krita app) |
| `.desktop` pykrita descriptor + plugin package | Part of the plugin → **GPL** |
| Optional native helper that links Krita headers | Typically **GPL** (see krita-mcp: `native/bridge.cpp` is GPL-2.0-or-later) |

Artwork created *with* Krita remains the user’s property (same krita.org page).

**Community consensus (not official legal):** modules that do **not** call Krita API can be MIT, but the **plugin that links them into Krita must be GPL**, and the distributed plugin as a whole is GPL.  
Thread: https://krita-artists.org/t/what-license-should-krita-plugins-have/48613

### A.2 Separate stdio MCP server — MIT/Apache possible?

**Pattern:**  
`MCP Host --stdio--> mcp-krita-server (MIT) --HTTP/JSON localhost--> krita-plugin (GPL) --LibKis--> Krita (GPL)`

**FSF GPL FAQ criteria** (quoted via Open Source SE answer citing the FAQ; gnu.org returned 403 to our fetch — verify at https://www.gnu.org/licenses/gpl-faq.html ):

- Same executable / shared address space → almost surely **one program** (copyleft couples).
- **Pipes, sockets, command-line args** → communication mechanisms **normally** used between **two separate programs**.
- Caveat: if communication is “intimate enough” (exchanging complex **internal** data structures from the GPL program), that can still be argued as a combined work.

**Practical OSS guidance for this team (not legal advice):**

1. Ship plugin and MCP server as **separate packages** with **separate LICENSE files**.
2. Keep the wire protocol **simple JSON** (health, open, export path, canvas size) — no shipping LibKis types across the wire.
3. Do **not** vendor GPL plugin source into the MIT server tree as importable modules.
4. Document in NOTICE: “MCP server speaks HTTP to an optional GPL Krita plugin; they are separate processes.”
5. Monorepo **aggregation** of differently licensed apps is common; do not relicense the aggregate as a single proprietary/MIT-only blob that strips GPL rights.

Analogous Blender-plugin + network peer discussion: https://opensource.stackexchange.com/questions/13437/license-gplv3-scenario-for-a-plugin-a-for-blender-3d-and-software-b-that-communi

**Coupling risks to avoid:**

- Copying GPL plugin functions into the MCP process.
- Requiring users to accept a single MIT license for the plugin.
- Dynamic-linking a GPL native bridge into the MIT server binary.

### A.3 Recommended repo layout

```
/
  LICENSE                    # repo default for *our* non-plugin code (e.g. Apache-2.0 or MIT)
  NOTICE                     # third-party + dual-component explanation
  apps/
    krita-plugin/            # GPL-3.0-or-later
      LICENSE                # GPL-3.0-or-later
      pykrita/
        graphics_krita_bridge/
        graphics_krita_bridge.desktop
      README.md              # install paths, enable in Plugin Manager
    mcp-krita-server/        # MIT or Apache-2.0
      LICENSE
      src/                   # stdio MCP; httpx to localhost
      openapi-or-schema/     # HTTP contract JSON Schema
    blender-pipeline/        # MIT/Apache (Blender GPL does not force script license the same way as in-process Krita plugins — still document Blender GPL separately)
    world-builder/
  docs/
    licensing.md             # this section condensed
```

Root README should say: **plugin = GPL; MCP server = MIT/Apache; do not confuse the two.**

### A.4 Migration: wrap `krita-mcp` (CC0) → first-party

**Current wrap target:** `krita-mcp` **v1.8.1**  
- PyPI: https://pypi.org/project/krita-mcp/  
- GitHub: https://github.com/thuanlm215/krita-mcp  
- Python server + Krita plugin: **CC0-1.0**  
- Optional `native/bridge.cpp`: **GPL-2.0-or-later** (not in the default uvx wheel)

**Sprint 1 (S1-E1) — wrap, don’t fork:**

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

Install plugin via `uvx krita-mcp install` (or project `install.ps1` / `install.sh`). Start Krita; verify Tools → Scripts → MCP Bridge.

**Keep when migrating later:**

| Keep | Why |
|------|-----|
| Tool **names** / capability set for export path (`health`, open/new, export/get_canvas, save) | Agent prompts & tests stay stable |
| **HTTP localhost** bridge shape (port + JSON command queue) | Server rewrite without changing Krita UX |
| Health + long timeouts for export | Known failure mode |
| Docs for pykrita install paths | Cross-OS |

**Rewrite:**

| Rewrite | Why |
|---------|-----|
| Own GPL plugin package (no CC0 dependency required, but CC0 code *may* be reused with attribution norms) | First-party control + clear GPL compliance |
| Own MIT MCP server implementing **our** schema | Avoid depending on upstream tool churn |
| Drop unused paint/stroke tools from MVP surface | Smaller attack/maintenance surface |
| Explicit schema version header (`X-Bridge-Version`) | Forward compatibility |

**Do not** ship krita-mcp’s GPL native helper under an MIT banner.

### A.5 Windows (and cross-OS) plugin paths

Prefer **Settings → Manage Resources → Open Resource Folder** then `pykrita/` (official install doc):  
https://docs.krita.org/en/user_manual/python_scripting/install_custom_python_plugin.html

Typical locations used by community bridges:

| OS | pykrita path |
|----|----------------|
| **Windows** | `%APPDATA%\krita\pykrita\` |
| **Linux** | `~/.local/share/krita/pykrita/` |
| **macOS** | `~/Library/Application Support/krita/pykrita/` |

Also: Tools → Scripts → **Import Python Plugin…** (zip with `.desktop` + package folder), then enable in **Configure Krita → Python Plugin Manager**, restart twice as needed.

Windows note: close Krita before installer writes `kritarc` (krita-mcp install docs). Microsoft Store / Steam installs may use different resource roots — always use “Open Resource Folder.”

---

## B) Blender latest API deltas (4.2 LTS → 5.x / current)

### B.1 Current latest stable (as of 2026-10-24)

| Item | Value | Source |
|------|-------|--------|
| Latest stable | **Blender 5.2.3 LTS** | https://www.blender.org/download/ |
| Released | October 22, 2026 | same |
| LTS window | 5.2 LTS until **July 2028** | https://www.blender.org/releases/5-2/ |
| Next | 5.3 expected **November 10, 2026** | download page (not stable yet) |

**Recommendation:** Develop/CI against **5.2.3**; keep scripts working on **4.2+** where operators exist.

### B.2 Mesh Plane / import images as planes

| Version | Operator | Notes |
|---------|----------|-------|
| **4.2** | `bpy.ops.image.import_as_mesh_planes(...)` | Present; also `convert_to_mesh_plane` for empties. File: `startup/bl_operators/image_as_planes.py`. API: https://docs.blender.org/api/4.2/bpy.ops.image.html |
| **5.0 / current** | Same `import_as_mesh_planes` | Still present. 5.0 API: https://docs.blender.org/api/5.0/bpy.ops.image.html · Current manual UI: Add → Image → Mesh Plane — https://docs.blender.org/manual/en/latest/modeling/meshes/import_images_as_planes.html |

**Enablement:** Built into Blender startup operators since the old “Import Images as Planes” addon was integrated (4.2+ era). **Do not** require enabling a legacy addon for MVP.

**Version-tolerant call (Engineer sketch):**

```python
import bpy

def import_mesh_plane(filepath: str, height: float = 1.0):
    op = getattr(bpy.ops.image, "import_as_mesh_planes", None)
    if op is None:
        raise RuntimeError(
            f"import_as_mesh_planes missing; Blender {bpy.app.version} unsupported (<4.2?)"
        )
    # kwargs common to 4.2 and 5.x docs
    return op(
        filepath=filepath,
        relative=False,
        size_mode="ABSOLUTE",
        height=height,
        align="WORLD",
        use_transparency=True,
        shader="PRINCIPLED",
    )
```

Minor param drift: 4.2 listed `alpha_mode`; 5.0 docs snippet for `import_as_mesh_planes` may omit some kwargs — **pass only kwargs that exist** via `inspect.signature` or try/except TypeError.

### B.3 glTF export flags (anim / skins / GLB)

On **current** API (`bpy.ops.export_scene.gltf`), these remain first-class:

| Flag | Role | Status |
|------|------|--------|
| `export_animations` | Export actions / NLA as glTF animations | Present (default True) |
| `export_skins` | Export armature skinning | Present (default True) |
| `export_format` | Output format string; use binary GLB | Present (`filter_glob='*.glb'`) |
| `export_animation_mode` | `ACTIONS` / `NLA_TRACKS` / `SCENE` / … | Present |
| `export_nla_strips` | Group by NLA track | Present |

Docs: https://docs.blender.org/api/current/bpy.ops.export_scene.html  
Manual: https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html

**5.0 Pipeline notes:** glTF exporter got maintenance around removal of `use_nodes` (materials), not a rename of `export_animations` / `export_skins`.  
https://developer.blender.org/docs/release_notes/5.0/pipeline_io/

**5.2 additions (optional later):** meshopt compression export flags, animation export perf — https://developer.blender.org/docs/release_notes/5.2/pipeline_io/

**MVP export call:**

```python
bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format="GLB",   # confirm enum/string accepted on your build; binary .glb
    export_animations=True,
    export_skins=True,
    export_yup=True,
    export_apply=False,    # keep armatures; apply excludes armatures but kills shapekeys if used
)
```

If `export_format="GLB"` errors on an older build, fallback: filepath ending in `.glb` (exporter historically infers binary).

### B.4 Armature + Automatic Weights (stable pattern)

Long-standing ops API:

```python
import bpy

def bind_auto_weights(mesh_obj, arm_obj):
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
```

`type='ARMATURE_AUTO'` has been stable across many Blender versions (Object Operators). Prefer this for Sprint 1 cards/planes; Rigify later.

### B.5 Adapter / CI strategy

1. **CI pin:** download **Blender 5.2.3** Linux x64 from https://download.blender.org/release/Blender5.2/  
2. **Runtime check** at script start:

```python
MIN = (4, 2, 0)
if bpy.app.version < MIN:
    raise SystemExit(f"Need Blender >= 4.2, got {bpy.app.version_string}")
```

3. **Capability dict** instead of sprawling if/else:

```python
CAPS = {
    "mesh_plane": hasattr(bpy.ops.image, "import_as_mesh_planes"),
    "gltf": hasattr(bpy.ops.export_scene, "gltf"),
}
```

4. Document **supported range:** 4.2 LTS → 5.2.x LTS; re-verify on each 5.3+ minor.  
5. Pass CLI args after `--` (official):  
   `blender --background --python png_to_glb.py -- in.png out.glb`  
   https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html

### B.6 Headless blockers — Windows vs Linux

| Concern | Linux | Windows | MVP impact |
|---------|-------|---------|------------|
| `blender -b` / `--background` + `--python` | Supported | Supported | **OK** for import plane, armature, glTF export |
| Cycles GPU without display | Possible (CUDA/Optix/HIP/oneAPI) | Possible | Not needed for mesh export |
| EEVEE / OpenGL-dependent viewport render | Headless EEVEE supported since 3.4 **with** working GL/X | EEVEE headless historically **not** supported | **Avoid EEVEE** in pipeline scripts |
| “Unable to open a display” | Can hit if something forces GL without X/Xvfb | Less common for pure `-b` CPU mesh ops; GL backends differ | Stick to data-path ops, not GPU draw |
| Path / quoting | POSIX | Use absolute paths; careful with `\` in JSON/MCP | Normalize `pathlib.Path` |
| Finding binary | `blender` on PATH / tarball | Installer vs Steam vs Microsoft Store PATH gaps | Document `BLENDER_BIN` env |

Official background flag: `-b, --background` — “Run in background (often used for UI-less rendering).”  
https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html

**Engineer rule:** Sprint 1 pipeline = **geometry + materials + export only**. No EEVEE/Cycles stills required to prove GLB.

---

## Actionable checklist for Engineer

### S1-E1 (wrap krita-mcp)
- [ ] `uvx krita-mcp install` + enable MCP Bridge in Krita  
- [ ] Host config stdio → `uvx krita-mcp`  
- [ ] Smoke: health tool; export PNG to known path  
- [ ] Document Windows `%APPDATA%\krita\pykrita` vs Open Resource Folder  
- [ ] Do **not** invent first-party GPL plugin yet — track as Sprint 2+ epic

### S1-E3 (Blender → GLB)
- [ ] Target Blender **5.2.3**; tolerate **≥4.2** via `bpy.app.version`  
- [ ] `import_as_mesh_planes` → optional `parent_set(ARMATURE_AUTO)` → `export_scene.gltf` with animations+skins+GLB  
- [ ] Env `BLENDER_BIN`; args after `--`  
- [ ] No EEVEE in script  

---

## Primary URL index

| Topic | URL |
|-------|-----|
| Krita license (plugins GPL) | https://krita.org/en/about/license/ |
| Krita install custom plugin | https://docs.krita.org/en/user_manual/python_scripting/install_custom_python_plugin.html |
| Krita artists plugin license thread | https://krita-artists.org/t/what-license-should-krita-plugins-have/48613 |
| FSF GPL FAQ (verify live) | https://www.gnu.org/licenses/gpl-faq.html |
| Separate program / network peer (FAQ quoted) | https://opensource.stackexchange.com/questions/13437/... |
| krita-mcp PyPI | https://pypi.org/project/krita-mcp/ |
| Blender download (5.2.3 LTS) | https://www.blender.org/download/ |
| Blender 5.2 release | https://www.blender.org/releases/5-2/ |
| CLI args | https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html |
| Mesh Plane manual | https://docs.blender.org/manual/en/latest/modeling/meshes/import_images_as_planes.html |
| Image ops 4.2 | https://docs.blender.org/api/4.2/bpy.ops.image.html |
| Image ops 5.0 | https://docs.blender.org/api/5.0/bpy.ops.image.html |
| export_scene current | https://docs.blender.org/api/current/bpy.ops.export_scene.html |
| glTF manual | https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html |
| 5.0 pipeline I/O notes | https://developer.blender.org/docs/release_notes/5.0/pipeline_io/ |
| 5.2 pipeline I/O notes | https://developer.blender.org/docs/release_notes/5.2/pipeline_io/ |

---

*End of Sprint 1 follow-up brief.*
