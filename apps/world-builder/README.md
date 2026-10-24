# world-builder (MERN + R3F)

- **Express** (`server/`) — Mongo metadata + disk files under `data/assets/`
- **Vite React + R3F** (`client/`) — library list + viewer; plays clip `spin`

```bash
# from monorepo root (after npm install)
npm run dev -w @graphics-pipeline/world-builder   # API :8787
npm run dev -w @graphics-pipeline/world-builder-client  # UI :5173
```

Optional: `MONGO_URI`, `MONGO_DB`. Falls back to in-memory if Mongo is down.
