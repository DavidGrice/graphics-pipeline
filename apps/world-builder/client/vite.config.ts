import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// S3-G CO-4 — ports overridable so a second stack (UI repeat runs, a second agent) never collides:
// VITE_PORT (default 5173) and WB_API_PORT (default 8787) for the /api + /data proxy.
const apiPort = Number(process.env.WB_API_PORT || 8787);
const api = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: !!process.env.VITE_PORT,
    proxy: {
      "/api": api,
      "/data": api,
    },
  },
});
