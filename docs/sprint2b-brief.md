# Sprint 2-B brief — Custom Krita bridge spike (license-safe)

**Author:** Graphics_Bot_Researcher  
**Status:** Leader-cut request — await formal cut before Design/Engineer/Tester execute  
**Prerequisite:** **S2-A CLOSED PASS** on `dev` @ `07cb5cb` (live Windows smoke + docs #27/#28)  
**Branch rule:** topic → **`dev` only** · `main` = prod via `test`

---

## Why B next (A / B / C map)

| Cut | Name | Role in the pipeline |
|-----|------|----------------------|
| **A** | Windows live smoke | **Done** — proved vendor `krita-mcp` → PNG → Blender GLB → R3F on Windows |
| **B** | Custom Krita bridge spike | **This sprint** — keep stable tools; swap facade *body* to first-party, license-clean |
| **C** | Real armature / weights | After B — deepen 3D (`billboard` → `rigged`) without mixing bridge + rig risk |

**Logic:** A locked the live path. B removes the long-term dependency on vendor `krita-mcp` *before* C invests in richer meshes/clips, so the PNG inbox contract stays stable while ownership of the bridge moves in-house.

---

## Goal

Keep MCP tool names **`health`** / **`export_png`** and inbox paths (`data/inbox/{slug}/*.png`) unchanged. Behind the facade, spike a **first-party** path:

- **GPL-3.0-or-later** pykrita plugin (`apps/krita-plugin/`) — only code that talks LibKis  
- **MIT** stdio MCP server — localhost HTTP/JSON to the plugin (process boundary; no LibKis in MIT package)  
- Feature flag: `BRIDGE=vendor|firstparty` (default **`vendor`** until spike green)

---

## Scope (in)

| ID | Owner | Story |
|----|-------|-------|
| **S2-B-R1** | Researcher | Plugin↔HTTP contract + Windows `%APPDATA%\krita\pykrita\` install steps |
| **S2-B-D1** | Designer | Sequence: Host → our MCP → plugin HTTP → PNG inbox (same paths as S1/S2-A) |
| **S2-B-E1** | Engineer | Spike plugin `health`+`export_png`; facade flag `BRIDGE=vendor\|firstparty` |
| **S2-B-T1** | Tester | AC: tool names unchanged; vendor flag still passes; firstparty smoke on Windows |

Also: document NOTICE/LICENSE split; no rebadge of GPL as MIT.

---

## Out (hold)

- Full 57-tool parity with `krita-mcp`  
- Rigify / real armature (that’s **C**)  
- Promoting `dev`→`test`→`main` unless Leader cuts ladder PRs  
- Committing media under `data/**`

---

## Dependencies on S2-A

| From A | Why B needs it |
|--------|----------------|
| Live Windows path green | Firstparty flag must still feed `smoke_live.ps1` / register → GLB |
| Fail-closed `health` + `BLENDER_BIN` | Same contracts; bridge swap must not soften them |
| Inbox/asset folder contract | Plugin export target stays under `data/inbox/{slug}/` |
| Facade adapter surface | Swap *body* only — `KritaBridgeAdapter` tool ids stay |

---

## DoD

1. `BRIDGE=vendor` — regression: existing Windows smoke still works (A path).  
2. `BRIDGE=firstparty` — Windows: Krita + our plugin → `health` ok → `export_png` writes inbox PNG.  
3. Tool names / response shapes stable (`health`, `export_png`).  
4. License boundary held: GPL only under `apps/krita-plugin/`; MCP facade MIT; NOTICE updated.  
5. CI (`test:s1` / `test:s2a`) green on Linux **without** requiring firstparty Krita (vendor or mocks).  
6. Tester signs S2-B-T1; docs (R1 + D1) on `dev`.

**Done when:** Flag-switched first-party path exports a real PNG; vendor flag still green; no LibKis inside the MIT MCP package.

---

## Suggested order of work (after Leader cut)

1. Researcher — R1 contract + Windows install (this brief’s deep follow-up)  
2. Designer — D1 sequence schematic  
3. Engineer — flag + spike plugin/server  
4. Tester — T1 vendor + firstparty AC on Windows  

Hold C until B DoD passes.
