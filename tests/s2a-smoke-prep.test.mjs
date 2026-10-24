/**
 * S2-A prep — BLENDER_BIN fail-closed (SMOKE_LIVE) + Krita bridge health red.
 * No Windows / Krita / Blender required on the CI runner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { createServer } from "node:http";
import { spawnBash, assertExitCode, findBash } from "./helpers/spawn-bash.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RUN_MVP = path.join(ROOT, "apps/blender-pipeline/run_mvp.sh");

test("S2-A: SMOKE_LIVE=1 fails closed when BLENDER_BIN missing (exit 127)", (t) => {
  if (!findBash()) {
    t.skip("bash not available (need Git Bash on Windows)");
    return;
  }
  const inbox = path.join(ROOT, "data/inbox/s2a-prep");
  fs.mkdirSync(inbox, { recursive: true });
  const png = path.join(inbox, "20260101-000000.png");
  if (!fs.existsSync(png)) {
    fs.writeFileSync(
      png,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH+AAAAAElFTkSuQmCC",
        "base64",
      ),
    );
  }
  const r = spawnBash(RUN_MVP, ["s2a-prep"], {
    env: {
      SMOKE_LIVE: "1",
      BLENDER_BIN: path.join(ROOT, "nonexistent", "blender-s2a-prep"),
      API: "http://127.0.0.1:9",
    },
  });
  assertExitCode(r, 127, "SMOKE_LIVE missing blender");
  assert.match(r.stderr, /SMOKE_LIVE=1/i);
  assert.match(r.stderr, /Blender binary not found/i);
  assert.doesNotMatch(r.stderr, /DEMO ONLY/i);
});

test("S2-A: probeKritaBridge red when nothing listens", async () => {
  const { probeKritaBridge } = await import(
    "../apps/mcp-krita/dist/krita-bridge-probe.js"
  );
  const r = await probeKritaBridge({
    port: 59999,
    scan: false,
    timeoutMs: 400,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /not reachable/i);
});

test("S2-A: probeKritaBridge green on any HTTP response (incl 401)", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(401);
    res.end("token");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const { probeKritaBridge } = await import(
      "../apps/mcp-krita/dist/krita-bridge-probe.js"
    );
    const r = await probeKritaBridge({ port, scan: false, timeoutMs: 1000 });
    assert.equal(r.ok, true);
    assert.match(r.detail, /401/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("S2-A: smoke_live.ps1 has no PowerShell subexpression trap in error strings", () => {
  const ps1 = fs.readFileSync(
    path.join(ROOT, "apps/blender-pipeline/smoke_live.ps1"),
    "utf8",
  );
  // Old bug: Write-Error "... (export_png first; no --demo-png)" — (; inside "") is a subexpression.
  assert.doesNotMatch(ps1, /Write-Error\s+"[^"]*\([^"]*;[^"]*\)/);
  assert.match(ps1, /Use export_png first/);
});
