# krita-plugin (first-party, GPL-3.0-or-later)

Sprint 2-B spike: loopback HTTP bridge for the MIT MCP facade.

| Route | Method | Port (default) |
|-------|--------|----------------|
| `/health` | GET | `127.0.0.1:19876` (`KRITA_FP_PORT`) |
| `/export_png` | POST JSON `{ "slug", "outPath?" }` | same |

Optional header `X-Graphics-Token` must match `KRITA_FP_TOKEN` when set.

## Windows install (Krita Import Python Plugin)

**Primary path:** import the zip **inside Krita** --- do not hand-copy loose folders into `pykrita`.

### 1) Build `graphics_fp_bridge.zip`

On branch `enhancement/s2b-firstparty-bridge`, from repo root in PowerShell:

```powershell
.\apps\krita-plugin\pack.ps1
# -> apps\krita-plugin\graphics_fp_bridge.zip
```

Fallback (committed base64 artifact):

```powershell
.\apps\krita-plugin\unpack-b64.ps1
# reads apps\krita-plugin\graphics_fp_bridge.zip.b64 -> .zip
```

Zip root layout (what Krita's importer requires --- note the trailing `/` dir entry):

- `graphics_fp_bridge/` (directory entry)
- `graphics_fp_bridge/__init__.py`
- `graphics_fp_bridge.desktop`

Do **not** use `Compress-Archive` by hand; it writes backslash paths and Krita reports "no plugins found".

In-repo artifacts: `graphics_fp_bridge.zip.b64`, `pack.ps1`, `unpack-b64.ps1`, `pack.sh`.

### 2) Import in Krita

1. Open **Krita**.
2. **Tools -> Scripts -> Import Python Plugin from File...** (wording may vary slightly by version; look for **Import Python Plugin**).
3. Select `apps\krita-plugin\graphics_fp_bridge.zip`.
4. Confirm when prompted.
5. **Settings -> Configure Krita -> Python Plugin Manager** -> enable **Graphics FP Bridge** (checkbox on; hover for load errors if grayed out).
6. **Fully quit and restart Krita** (File -> Quit, then reopen). Enable alone does not load the plugin until restart. On start the plugin binds `127.0.0.1:19876`.
7. Verify health:
   ```powershell
   Invoke-RestMethod http://127.0.0.1:19876/health
   ```
   Expect JSON with `ok: true`. If not, try **Tools -> Scripts -> Restart Graphics FP Bridge HTTP**.
8. If still down, paste these to the team:
   - `%APPDATA%\krita\graphics_fp_bridge.status` (plugin boot/bind log)
   - `%LOCALAPPDATA%\krita.log` (or Help -> Show Krita Log for bug reports)
9. `$env:BRIDGE = 'firstparty'` then smoke the MCP facade (vendor stays on **9797**).

### Optional fallback (manual unzip)

Only if Import Python Plugin is missing on your build:

```powershell
$pykrita = Join-Path $env:APPDATA "krita\pykrita"
Expand-Archive -Path .\apps\krita-plugin\graphics_fp_bridge.zip -DestinationPath $pykrita -Force
```

Then enable + full restart Krita as above (steps 5-8).

## License boundary

This package is **GPL-3.0-or-later**. Do not copy these sources into `apps/mcp-krita` (MIT).
