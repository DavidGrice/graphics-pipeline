# krita-plugin (first-party, GPL-3.0-or-later)

Sprint 2-B spike: loopback HTTP bridge for the MIT MCP facade.

| Route | Method | Port (default) |
|-------|--------|----------------|
| `/health` | GET | `127.0.0.1:19876` (`KRITA_FP_PORT`) |
| `/export_png` | POST JSON `{ "slug", "outPath?" }` | same |

Optional header `X-Graphics-Token` must match `KRITA_FP_TOKEN` when set.

## Windows install

1. Krita → **Settings → Manage Resources → Open Resource Folder** → open `pykrita\`.
2. Copy this folder’s contents so you have:
   - `%APPDATA%\krita\pykrita\graphics_fp_bridge\`
   - `%APPDATA%\krita\pykrita\graphics_fp_bridge.desktop`
3. Restart Krita → **Settings → Configure Krita → Python Plugin Manager** → enable **Graphics FP Bridge**.
4. Set `BRIDGE=firstparty` for the MCP facade (vendor stays on **9797**).

## License boundary

This package is **GPL-3.0-or-later**. Do not copy these sources into `apps/mcp-krita` (MIT).
