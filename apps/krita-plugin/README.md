# krita-plugin (first-party, GPL-3.0-or-later)

Sprint 2-B spike: loopback HTTP bridge for the MIT MCP facade.

| Route | Method | Port (default) |
|-------|--------|----------------|
| `/health` | GET | `127.0.0.1:19876` (`KRITA_FP_PORT`) |
| `/export_png` | POST JSON `{ "slug", "outPath?" }` | same |

Optional header `X-Graphics-Token` must match `KRITA_FP_TOKEN` when set.

## Windows install (Krita Import Python Plugin)

**Primary path:** import the zip **inside Krita** — do not hand-copy loose folders into `pykrita`.

### 1) Build `graphics_fp_bridge.zip`

On branch `enhancement/s2b-firstparty-bridge`, from repo root in PowerShell:

```powershell
.\apps\krita-plugin\pack.ps1
# → apps\krita-plugin\graphics_fp_bridge.zip
```

Fallback if `Compress-Archive` is unavailable:

```powershell
.\apps\krita-plugin\unpack-b64.ps1
# reads apps\krita-plugin\graphics_fp_bridge.zip.b64 → .zip
```

Zip root layout (what Krita’s importer expects):

- `graphics_fp_bridge/__init__.py`
- `graphics_fp_bridge.desktop`

In-repo artifacts: `graphics_fp_bridge.zip.b64`, `pack.ps1`, `unpack-b64.ps1`, `pack.sh`.

### 2) Import in Krita

1. Open **Krita**.
2. **Tools → Scripts → Import Python Plugin from File…** (wording may vary slightly by version; look for **Import Python Plugin**).
3. Select `apps\krita-plugin\graphics_fp_bridge.zip`.
4. Confirm / restart Krita when prompted.
5. **Settings → Configure Krita → Python Plugin Manager** → enable **Graphics FP Bridge** (if not already on).
6. `$env:BRIDGE = 'firstparty'` for the MCP facade (vendor stays on **9797**).

### Optional fallback (manual unzip)

Only if Import Python Plugin is missing on your build:

```powershell
$pykrita = Join-Path $env:APPDATA "krita\pykrita"
Expand-Archive -Path .\apps\krita-plugin\graphics_fp_bridge.zip -DestinationPath $pykrita -Force
```

Then restart Krita and enable the plugin as above.

## License boundary

This package is **GPL-3.0-or-later**. Do not copy these sources into `apps/mcp-krita` (MIT).
