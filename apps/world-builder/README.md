# world-builder (MERN + R3F)

- **Express** (`server/`) — Mongo metadata + disk files under `data/assets/`
- **Vite React + R3F** (`client/`) — library list + viewer; plays clip `spin`

```bash
# from monorepo root (after npm install)
npm run dev -w @graphics-pipeline/world-builder   # API :8787
npm run dev -w @graphics-pipeline/world-builder-client  # UI :5173
```

Optional: `MONGO_URI`, `MONGO_DB`. Falls back to in-memory if Mongo is down.


## Soft-env / demo-seed (S2-E-E4)

`npm run test:s1` stays green when `:8787` is down **or** the demo asset is unseeded — those cases **skip**, they do not flake red.

| Condition | Behavior |
|-----------|----------|
| API unreachable | `tests/s1-t1-api-demo.test.mjs` skips |
| API up, demo id missing | skips with seed hint |
| Live smoke (`SMOKE_LIVE`) | fail-closed as before |

Seed the demo asset locally when you want the live assertions:

```bash
npm run dev:world   # :8787
node apps/blender-pipeline/make_demo_glb.mjs /tmp/demo.glb
node apps/blender-pipeline/register_asset.mjs \
  --id 298c8420-a948-48a6-9a26-884013437c3a \
  --slug hero-billboard --glb /tmp/demo.glb
```

See also `docs/sprint2e-d1-scene-importmeta-wire.md` §3.
