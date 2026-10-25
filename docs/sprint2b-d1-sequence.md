# S2-B-D1 — Sequence: Host → MCP → plugin HTTP → PNG inbox

**Role:** Graphics_Bot_Designer  
**Owner story:** S2-B-D1  
**Locks:** tools `health` / `export_png` · inbox `data/inbox/{slug}/*.png` · `BRIDGE=vendor|firstparty` (default **vendor**) · firstparty **127.0.0.1:19876** · vendor **9797** · no LibKis in MIT  
**Companions:** `docs/sprint2b-r1-plugin-http-contract.md` · `docs/sprint2b-brief.md` · S1 asset contract

**Status:** local until firstparty spike green — then docs PR with R1 (Leader cut).

---

## 1. End-to-end (both flags)

```
MCP Host (Cursor / agent / smoke)
    │  stdio — ONLY tool names: health · export_png
    ▼
apps/mcp-krita  (MIT facade / adapter)
    │  BRIDGE env selects body
    ├──────────── BRIDGE=vendor (default) ────────────┐
    │                                                  ▼
    │                                    krita-mcp HTTP 127.0.0.1:9797
    │                                    (KRITA_MCP_PORT)
    │                                                  │
    └──────────── BRIDGE=firstparty ───────────────────┤
                                                       ▼
                                         our plugin HTTP 127.0.0.1:19876
                                         GET /health · POST /export_png
                                         (KRITA_FP_PORT; optional X-Graphics-Token)
                                                       │
                                                       ▼
                                         Krita GUI + pykrita (LibKis = GPL only here)
                                                       │
                                                       ▼
                                         data/inbox/{slug}/*.png
                                                       │
                                                       ▼
                                         (unchanged S2-A) BLENDER_BIN → GLB → R3F
```

**Invariant:** Host never sees vendor tool ids or plugin HTTP. Same Zod/result shapes either flag.

---

## 2. Sequence — `health` (firstparty)

```
Host                MCP facade              Plugin :19876           Krita GUI
 │                      │                         │                    │
 │── health() ─────────►│                         │                    │
 │                      │── GET /health ─────────►│                    │
 │                      │   (+ X-Graphics-Token?) │── LibKis probe ───►│
 │                      │                         │◄── alive ──────────│
 │                      │◄── 200 {ok:true,…} ─────│                    │
 │◄── {ok:true, krita:"running"} ─────────────────│                    │
```

**Fail-closed:** connection refused / 503 / token mismatch → `{ ok:false, krita:"down"|"unknown", error }` — no soft OK. Vendor path: same Host contract; probe **:9797** instead.

---

## 3. Sequence — `export_png` (firstparty)

```
Host                MCP facade              Plugin :19876           Disk
 │                      │                         │                  │
 │── export_png({slug})►│                         │                  │
 │                      │ resolve abs path under  │                  │
 │                      │ data/inbox/{slug}/…     │                  │
 │                      │── POST /export_png ────►│                  │
 │                      │   { outPath, slug }        │── write PNG ────►│
 │                      │◄── 200 {ok,path,slug,ts}│                  │
 │◄── { path, slug, ts } ─────────────────────────│                  │
```

Rules:
1. Facade resolves repo-relative inbox → **absolute** `outPath` before POST (Windows-safe).  
2. Plugin writes/confirms PNG; **no** success if file missing.  
3. Must not call export when `health` is red.  
4. Vendor path: same Host I/O; body talks krita-mcp on **9797**.

---

## 4. Path & env map (Design lock for E1/T1)

| Item | Vendor | Firstparty |
|------|--------|------------|
| `BRIDGE` | `vendor` (default) | `firstparty` |
| Loopback | `127.0.0.1:9797` (`KRITA_MCP_PORT`) | `127.0.0.1:19876` (`KRITA_FP_PORT`) |
| Auth | vendor as today | optional `KRITA_FP_TOKEN` → `X-Graphics-Token` |
| Plugin disk | krita-mcp (vendor) | **`graphics_fp_bridge.zip`** (`pack.ps1` @ `2c231d3`) → Krita **Import Python Plugin** (primary); Expand-Archive→pykrita OK for T1.5 |
| Inbox | `data/inbox/{slug}/*.png` | **same** |
| Downstream | `smoke_live.ps1` / GLB | **same** (A contracts unchanged) |

---



## 4.1 First-party zip install (Windows — Leader lock)

**Install via Krita → Import Python Plugin (in-app zip). Do not Expand-Archive / manual unzip into `pykrita\`.**

| Artifact | Path |
|----------|------|
| Zip (build) | `apps/krita-plugin/graphics_fp_bridge.zip` via `.\apps\krita-plugin\pack.ps1` |
| Zip (fallback) | decode `apps/krita-plugin/graphics_fp_bridge.zip.b64` with `unpack-b64.ps1` |
| Tip | `enhancement/s2b-firstparty-bridge` @ `2c231d3` (dir-entry zip + ASCII pack.ps1) |

1. Produce or obtain **`graphics_fp_bridge.zip`** (pack.ps1 / unpack-b64.ps1).  
2. In **Krita**: **Import Python Plugin** → select that zip (contents: `graphics_fp_bridge/` + `graphics_fp_bridge.desktop`).  
3. Enable **Graphics FP Bridge** in Python Plugin Manager; restart if needed.  
4. `$env:BRIDGE='firstparty'`; `$env:KRITA_FP_PORT='19876'` (optional `KRITA_FP_TOKEN`).  
5. `GET http://127.0.0.1:19876/health` → ok.

T1.5: prefer **Import Python Plugin**; Expand-Archive→pykrita is an accepted workaround until Import is confirmed on this tip (`2c231d3` zip includes `graphics_fp_bridge/` dir entry).

## 5. License fence (must stay visible in diagrams)

| Zone | License | May import LibKis? |
|------|---------|--------------------|
| `apps/mcp-krita/` | MIT | **No** — HTTP/JSON only |
| `apps/krita-plugin/` | GPL-3.0-or-later | **Yes** |
| Host / Blender / world-builder | existing | No LibKis |

Crossing the fence = loopback HTTP only. No shared Python package that pulls LibKis into MIT.

---

## 6. Handoffs

| To | Use this for |
|----|----------------|
| Engineer E1 | Implement flag + routes exactly as §2–§4; scaffold `apps/krita-plugin/` |
| Tester T1 | AC: tool names identical; vendor regression; firstparty Windows `health`+`export_png` → inbox |
| Researcher | Contract already locked — flag mismatches against R1 |

**Field note (E1 @ `2c231d3`):** HTTP body uses `outPath` (not `path`); plugin also accepts `out_path`. Zip artifact: `apps/krita-plugin/graphics_fp_bridge.zip`.

**Out of D1:** full tool parity, armature/C, LAN bind, committing `data/**`.
