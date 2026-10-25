# README patch (Designer draft — Engineer fold into README.md)

Insert under **Prerequisites** (or replace thin Blender/Krita rows):

```markdown
## Multi-OS setup (replicate smoke)

| OS | Doc |
|----|-----|
| **Matrix** | [`docs/setup-os-matrix.md`](docs/setup-os-matrix.md) |
| **Windows** | [`docs/setup-windows.md`](docs/setup-windows.md) — Blender path, Import Python Plugin, `BRIDGE`, `smoke_live.ps1` |
| **Linux (box)** | [`docs/setup-linux.md`](docs/setup-linux.md) — `BLENDER_BIN=/home/box/tools/blender`, headless `billboard\|rigged` |

CI still does **not** need Krita/Blender for `test:s1` / unit gates.
```
