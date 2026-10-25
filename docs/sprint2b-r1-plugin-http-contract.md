# S2-B-R1 — Plugin ↔ HTTP contract + Windows pykrita install

**Owner:** Graphics_Bot_Researcher  
**Cut:** Sprint 2-B (custom Krita bridge spike)  
**Consumers:** Designer (D1), Engineer (E1), Tester (T1)  
**Locks:** tool names `health` / `export_png` · inbox under `data/inbox/{slug}/` · `BRIDGE=vendor|firstparty` · default **`vendor`** · no PR until firstparty spike green  
**Companion:** `docs/sprint2b-brief.md` · `apps/mcp-krita/src/adapter.ts` · `apps/mcp-krita/README.md`

---

## 1. Architecture (process boundary)

```
MCP host (stdio)
    │  tools: health · export_png   (MIT facade — apps/mcp-krita)
    ▼
stdio MCP / adapter  BRIDGE=vendor|firstparty
    │  localhost HTTP/JSON  (loopback only)
    ▼
Krita GUI + pykrita plugin
    │  LibKis — MUST be GPL-3.0-or-later under apps/krita-plugin/
    ▼
PNG → data/inbox/{slug}/*.png
```

| Piece | License | Path |
|-------|---------|------|
| Facade / adapter / future stdio MCP | **MIT** | `apps/mcp-krita/` |
| First-party in-Krita plugin | **GPL-3.0-or-later** | `apps/krita-plugin/` (new) |
| Vendor wrap (today) | CC0 upstream | PyPI `krita-mcp` — do not rebadge |

**Hard rule:** no LibKis imports inside MIT packages. HTTP/JSON only across the boundary.

---

## 2. Stable facade API (unchanged across BRIDGE)

### `health` → `HealthResult`

```ts
| { ok: true;  krita: "running"; detail?: string }
| { ok: false; krita: "down" | "unknown"; error: string }
```

- **Fail closed** if Krita GUI / bridge unreachable (same as S2-A).
- Vendor today: probe `http://127.0.0.1:${KRITA_MCP_PORT||9797}/` (any HTTP status incl. **401** = up).
- Firstparty: same semantics against **our** plugin listener (see §3).

### `export_png` → `ExportPngResult`

**Input:** `{ slug: kebab-case, outPath?: string }`  
**Output:** `{ path, slug, ts }`

- Default path: `data/inbox/{slug}/{YYYYMMDD-HHMMSS}.png` (facade may also accept any `*.png` in that folder for smoke — S2-A soft nit).
- Host export timeout **≥ 60s** (`exportTimeoutMs` in `host-config.example.json`).
- Must not succeed if `health` is red.

Callers use `KritaBridgeAdapter` only — never bind to vendor tool ids.

---

## 3. First-party plugin HTTP contract (spike minimum)

**Transport:** HTTP/1.1 on **127.0.0.1 only** (no LAN bind).  
**Default port:** `19876` for firstparty (avoid colliding with vendor **9797**). Env: `KRITA_FP_PORT` (plugin + MCP).  
**Auth (spike):** shared secret header `X-Graphics-Token: <token>` from env `KRITA_FP_TOKEN` (optional in spike; if set, required). Prefer loopback + token over open port.

| Method | Path | Purpose | Request | Success | Failure |
|--------|------|---------|---------|---------|---------|
| `GET` | `/health` | GUI + plugin alive | — | `200` `{ "ok": true, "krita": "running" }` | `503` `{ "ok": false, "error": "…" }` or connection refused |
| `POST` | `/export_png` | Export active doc/canvas to PNG | JSON `{ "outPath": "<abs path>", "slug": "…" }` (`out_path` alias OK) | `200` `{ "ok": true, "path": "…", "slug": "…", "ts": "…" }` | `4xx/5xx` `{ "ok": false, "error": "…" }` — **no** fake PNG |

**Notes for Engineer:**

1. Plugin writes the PNG to **`outPath`** (absolute path required on Windows; MCP resolves repo-relative inbox → abs before POST).  
2. MCP resolves `data/inbox/{slug}/…` under repo root before POST.  
3. Content-Type `application/json; charset=utf-8`.  
4. Spike does **not** need full krita-mcp tool parity — only these two routes.  
5. `BRIDGE=vendor` keeps probing **9797** / `KRITA_MCP_PORT`; `BRIDGE=firstparty` uses **19876** / `KRITA_FP_PORT`.

---

## 4. Windows install — `%APPDATA%\krita\pykrita\`

### 4.1 Locate pykrita (preferred)

1. Open **Krita**.  
2. **Settings → Manage Resources → Open Resource Folder**.  
3. Enter / create **`pykrita\`**.  
   Typical: `C:\Users\<you>\AppData\Roaming\krita\pykrita\`

| OS | Typical path |
|----|----------------|
| Windows | `%APPDATA%\krita\pykrita\` |
| Linux | `~/.local/share/krita/pykrita/` |
| macOS | `~/Library/Application Support/krita/pykrita/` |

Store/Steam/Flatpak layouts differ — **always** use Open Resource Folder.

### 4.2 Vendor path (keep working — `BRIDGE=vendor`)

1. `uvx krita-mcp install` (or documented installer).  
2. Close Krita before installer writes `kritarc` if prompted.  
3. Enable **Tools → Scripts → MCP Bridge**; restart Krita.  
4. Confirm probe: any HTTP on `127.0.0.1:9797` (401 OK).

### 4.3 First-party path (spike — `BRIDGE=firstparty`)

1. Close Krita.  
2. **Zip install (tip `2c231d3`):** build `apps/krita-plugin/graphics_fp_bridge.zip` via `pack.ps1` (or `unpack-b64.ps1` from `graphics_fp_bridge.zip.b64`). In Krita use **Import Python Plugin** (primary). After import, pykrita has `graphics_fp_bridge/` + `graphics_fp_bridge.desktop`. Expand-Archive→`%APPDATA%\krita\pykrita\` is **fallback only**.  
3. Start Krita → enable the **Graphics Pipeline Bridge** script/plugin (Settings → Configure Krita → Python Plugin Manager, or Tools → Scripts).  
4. Set env for MCP process:  
   ```powershell
   $env:BRIDGE = "firstparty"
   $env:KRITA_FP_PORT = "19876"
   # optional: $env:KRITA_FP_TOKEN = "…"
   ```  
5. Verify `GET http://127.0.0.1:19876/health` → `{ "ok": true, … }`.  
6. Run facade `health` / `export_png` then existing `smoke_live.ps1` happy path.

**Uninstall / switch back:** disable firstparty plugin; unset `BRIDGE` or set `vendor`; vendor bridge on 9797 remains the CI/default path.

---

## 5. Env cheat sheet

| Var | Role |
|-----|------|
| `BRIDGE` | `vendor` (default) \| `firstparty` |
| `KRITA_MCP_PORT` | Vendor HTTP port (default 9797) |
| `KRITA_FP_PORT` | Firstparty HTTP port (default 19876) |
| `KRITA_FP_TOKEN` | Optional shared secret for firstparty |
| `SMOKE_LIVE` / `HEALTH_STRICT_KRITA` | S2-A fail-closed (keep) |
| `BLENDER_BIN` | Unchanged — live smoke after export |

---

## 6. AC hooks for Tester (S2-B-T1)

1. Tool names remain **`health`** / **`export_png`** for both BRIDGE values.  
2. `BRIDGE=vendor` — CI + Windows smoke still green (S2-A regression).  
3. `BRIDGE=firstparty` — Windows: `/health` ok → `/export_png` → real PNG under `data/inbox/{slug}/` → existing register/GLB path still works.  
4. License: GPL only under `apps/krita-plugin/`; MIT facade has no LibKis.  
5. CI Linux: no firstparty Krita required; vendor mocks / existing tests pass.

---

## 7. Handoffs

| Role | Next |
|------|------|
| Designer | D1 sequence diagram from §1–§3 (same S1 inbox paths) |
| Engineer | Scaffold `apps/krita-plugin/` + firstparty adapter; flag on facade; branch from `dev`; **no PR until spike green** |
| Tester | Formalize T1 from §6 once E1 lands |

**Researcher hold:** deeper R1 revisions only if Leader asks or spike hits a contract gap.
