# krita-plugin (first-party, GPL-3.0-or-later)

Sprint 2-B spike: loopback HTTP bridge for the MIT MCP facade.

| Route | Method | Port (default) |
|-------|--------|----------------|
| `/health` | GET | `127.0.0.1:19876` (`KRITA_FP_PORT`) |
| `/export_png` | POST JSON `{ "slug", "outPath?" }` | same |

Optional header `X-Graphics-Token` must match `KRITA_FP_TOKEN` when set.

## Windows install (zip only)

**Ship / install as a zip** — do not copy loose folders into `pykrita`.

### 1) Get `graphics_fp_bridge.zip`

On branch `enhancement/s2b-firstparty-bridge`, from repo root in PowerShell:

```powershell
.\apps\krita-plugin\pack.ps1
# → apps\krita-plugin\graphics_fp_bridge.zip
```

Fallback (no Compress-Archive): decode the committed artifact:

```powershell
.\apps\krita-plugin\unpack-b64.ps1
# reads apps\krita-plugin\graphics_fp_bridge.zip.b64 → .zip
```

Artifact paths in-repo:

- `apps/krita-plugin/graphics_fp_bridge.zip.b64` (text; always in git)
- `apps/krita-plugin/graphics_fp_bridge.zip` (produced by `pack.ps1` / `unpack-b64.ps1` / `pack.sh`)

### 2) Unzip into Krita’s pykrita folder

1. Krita → **Settings → Manage Resources → Open Resource Folder** → open `pykrita\`  
   (usually `%APPDATA%\krita\pykrita\`).
2. **Expand-Archive** / unzip `graphics_fp_bridge.zip` **into** that folder so you have exactly:
   - `pykrita\graphics_fp_bridge\` (contains `__init__.py`)
   - `pykrita\graphics_fp_bridge.desktop`
3. Restart Krita → **Settings → Configure Krita → Python Plugin Manager** → enable **Graphics FP Bridge**.
4. `$env:BRIDGE = 'firstparty'` (vendor stays on **9797**).

```powershell
$pykrita = Join-Path $env:APPDATA "krita\pykrita"
Expand-Archive -Path .\apps\krita-plugin\graphics_fp_bridge.zip -DestinationPath $pykrita -Force
```

## License boundary

This package is **GPL-3.0-or-later**. Do not copy these sources into `apps/mcp-krita` (MIT).
