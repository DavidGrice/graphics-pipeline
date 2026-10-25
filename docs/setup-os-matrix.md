# Setup OS matrix (replicate smoke without tribal knowledge)

**Owner (draft):** Graphics_Bot_Designer · **Land with:** Engineer on `enhancement/s2c-rigged-pipeline`  
**Companions:** [`setup-windows.md`](setup-windows.md) · [`setup-linux.md`](setup-linux.md) · S2-A/B checklists · S2-C D1/D2

Cold reader can run **Linux box E2E** and **Windows live smoke** with only these docs + copy-paste blocks.

---

## Matrix

| Piece | Windows (user) | Linux (box / CI-adjacent) | CI runner |
|-------|----------------|---------------------------|-----------|
| Node 20+ | required | required | required |
| Mongo | optional (in-memory fallback) | optional | n/a for unit |
| Blender **5.2.3** | `BLENDER_BIN` → official `blender.exe` under Program Files — **not** Store launcher | `BLENDER_BIN=/home/box/tools/blender` (or `/home/box/blender-5.2.3/blender`) | not required for `test:s1`/`test:s2b`/`test:s2c` unit |
| Krita GUI | required for live `export_png` | `/home/box/tools/krita` (5.2.9) · pykrita `/home/box/.local/share/krita/pykrita/` · same bridge smokes | not required |
| Vendor bridge | `BRIDGE=vendor` (default) → `127.0.0.1:9797` | same | mock/cli health modes |
| Firstparty bridge | Import Python Plugin zip → `:19876` | install into `/home/box/.local/share/krita/pykrita/` → `:19876` | mock server OK |
| Smoke billboard | `smoke_live.ps1` / `--mode billboard` | `SMOKE_MODE=billboard` + `png_to_glb` headless | schema/unit only |
| Smoke rigged (S2-C) | `--mode rigged` / `SMOKE_MODE=rigged` → `idle`+`walk` | same headless on box | GLB fixture gates |

---

## Shared fail-closed (both OS)

| Check | Expect |
|-------|--------|
| Bad/missing `BLENDER_BIN` | exit ≠ 0; stderr names var; **no** `make_demo_glb` on live/`SMOKE_LIVE` |
| Krita/bridge down | `health` red; export blocked |
| Store `blender-launcher.exe` | rejected (Windows) |
| `MODE=rigged` without armature/weights | non-zero; no silent billboard |
| Commit `data/**` | forbidden |

---

## README link targets

Add under Prerequisites / Quick start:

- Windows live path → [`docs/setup-windows.md`](setup-windows.md)  
- Linux box path → [`docs/setup-linux.md`](setup-linux.md)  
- This matrix → [`docs/setup-os-matrix.md`](setup-os-matrix.md)
