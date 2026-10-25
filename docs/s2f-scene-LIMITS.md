# S2-F scene compose — LIMITS

- **No nested scenes** (V5 hard at register).
- **V4 hard**: unknown child `assetId` rejects before persist (id or unique slug).
- **No media in git** under `data/**` — fixtures are JSON under `tests/fixtures/`.
- **No demo fallback mesh** when child GLB missing — viewer shows error box only.
- BRIDGE vendor|firstparty unchanged; OBJ still hard-fail for animated; `BLENDER_BIN` fail-closed.
- Soft-env: `:8787` down → API cases skip, unit resolve tests still green.
