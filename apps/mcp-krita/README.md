# mcp-krita (adapter facade)

Stable tool names for Grok Build / VS Code MCP hosts:

| Our tool | Purpose |
|----------|---------|
| `health` | Krita GUI reachable |
| `export_png` | Write PNG under `data/inbox/{slug}/{ts}.png` |

## Sprint 2-B: `BRIDGE=vendor|firstparty`

- Default **`BRIDGE=vendor`** → loopback **9797** (krita-mcp).
- **`BRIDGE=firstparty`** → **19876** (`KRITA_FP_PORT`) GPL plugin in `apps/krita-plugin/`.
- Tool names stay `health` / `export_png`. Optional `KRITA_FP_TOKEN` / `X-Graphics-Token`.
- No PR until firstparty Windows spike green.

## Sprint 1: wrap `krita-mcp` (vendor path)

1. Install Krita (GUI) and start it.
2. Install bridge: `uvx krita-mcp install` (PyPI v1.8.1, CC0 server+plugin) — https://pypi.org/project/krita-mcp/
3. Enable **Tools → Scripts → MCP Bridge** in Krita (restart if needed).
4. Point your MCP host at [`host-config.example.json`](./host-config.example.json) (`uvx krita-mcp`).
5. Call through `KritaBridgeAdapter` so callers never bind to vendor tool ids.

Raise export timeout to **≥ 60s** in the host.

### Windows / cross-OS pykrita paths

Prefer **Settings → Manage Resources → Open Resource Folder** then `pykrita/`.

| OS | Typical pykrita path |
|----|----------------------|
| **Windows** | `%APPDATA%\krita\pykrita\` |
| **Linux** | `~/.local/share/krita/pykrita/` |
| **macOS** | `~/Library/Application Support/krita/pykrita/` |

Close Krita before installer writes `kritarc`. Store/Steam installs may differ — use Open Resource Folder.

## End state (later epic — not Sprint 1)

| Component | License |
|-----------|---------|
| `apps/krita-plugin/` (LibKis / pykrita) | **GPL-3.0-or-later** (Krita API requirement) |
| `apps/mcp-krita` / future `mcp-krita-server` (stdio MCP over localhost HTTP/JSON) | **MIT** |
| This adapter facade | **MIT** |

Keep process boundary: MCP server ↔ HTTP/JSON ↔ plugin. Do not merge into one LICENSE. Track first-party GPL plugin as Sprint 2+ epic.

## License notes (Sprint 1)

- This package: MIT (repo root LICENSE)
- External `krita-mcp` server/plugin Python: CC0 (upstream); optional native helper GPL — do not rebadge under MIT
