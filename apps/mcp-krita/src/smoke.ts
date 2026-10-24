/**
 * S1-E2 smoke — exercises KritaBridgeAdapter only (not raw krita-mcp).
 * Usage: node --import tsx src/smoke.ts
 *     or: npm run smoke -w @graphics-pipeline/mcp-krita
 *
 * Without Krita GUI / uvx: health may fail loudly (expected T3.1).
 * With --demo-png: write a placeholder RGBA PNG to inbox path contract
 * so E3 can run without live Krita (labeled demo).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createKritaMcpAdapter, inboxTimestamp } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

async function writeDemoPng(absPath: string): Promise<void> {
  // Minimal valid 2×2 RGBA PNG (stdlib-free tiny base64)
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH+AAAAAElFTkSuQmCC";
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, Buffer.from(b64, "base64"));
}

async function main() {
  const args = process.argv.slice(2);
  const demo = args.includes("--demo-png");
  const slugArg = args.find((a) => a.startsWith("--slug="));
  const slug = slugArg?.split("=")[1] || "hero-billboard";

  const adapter = createKritaMcpAdapter({ repoRoot: REPO_ROOT });
  console.log("[smoke] health…");
  const health = await adapter.health();
  console.log(JSON.stringify(health, null, 2));

  if (!health.ok && !demo) {
    console.error(
      "[smoke] FAIL: Krita MCP wrap not healthy. Start Krita GUI + uvx krita-mcp, or pass --demo-png for path-only dry run.",
    );
    process.exit(1);
  }

  if (demo) {
    const ts = inboxTimestamp();
    const rel = path.join("data", "inbox", slug, `${ts}.png`);
    const abs = path.join(REPO_ROOT, rel);
    await writeDemoPng(abs);
    console.log(`[smoke] wrote DEMO PNG (not from Krita): ${abs}`);
    console.log(JSON.stringify({ path: abs, slug, ts, demo: true }, null, 2));
    process.exit(0);
  }

  console.log("[smoke] exportPng…");
  const result = await adapter.exportPng({ slug });
  console.log(JSON.stringify(result, null, 2));
  console.log(
    "[smoke] Host must complete vendor export_png into result.path (pending marker may exist).",
  );
}

main().catch((err) => {
  console.error("[smoke] error:", err);
  process.exit(1);
});
