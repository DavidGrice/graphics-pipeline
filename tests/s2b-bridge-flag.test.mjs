/**
 * S2-B: BRIDGE=vendor|firstparty factory + firstparty HTTP contract (mock server).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadBridge() {
  await import("child_process").then(({ execSync }) => {
    execSync("npm run build -w @graphics-pipeline/mcp-krita", {
      cwd: ROOT,
      stdio: "pipe",
    });
  });
  return import("../apps/mcp-krita/dist/index.js");
}

test("resolveBridgeMode defaults vendor; accepts firstparty aliases", async () => {
  const { resolveBridgeMode } = await loadBridge();
  const prev = process.env.BRIDGE;
  delete process.env.BRIDGE;
  assert.equal(resolveBridgeMode(), "vendor");
  assert.equal(resolveBridgeMode("firstparty"), "firstparty");
  assert.equal(resolveBridgeMode("fp"), "firstparty");
  process.env.BRIDGE = "firstparty";
  assert.equal(resolveBridgeMode(), "firstparty");
  if (prev === undefined) delete process.env.BRIDGE;
  else process.env.BRIDGE = prev;
});

test("createKritaMcpAdapter honors BRIDGE=firstparty against mock :port", async () => {
  const mod = await loadBridge();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "s2b-fp-"));
  const pngPath = path.join(tmp, "out.png");
  // minimal PNG
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex",
  );

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, detail: "mock fp" }));
      return;
    }
    if (req.method === "POST" && req.url === "/export_png") {
      let body = "";
      for await (const c of req) body += c;
      const j = JSON.parse(body || "{}");
      await fs.writeFile(j.outPath, png);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: j.outPath, slug: j.slug }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  const prevBridge = process.env.BRIDGE;
  const prevHealth = process.env.KRITA_HEALTH_MODE;
  process.env.BRIDGE = "firstparty";
  delete process.env.KRITA_HEALTH_MODE;

  try {
    const adapter = mod.createKritaMcpAdapter({
      repoRoot: tmp,
      port,
      bridge: "firstparty",
    });
    const h = await adapter.health();
    assert.equal(h.ok, true, h.error || h.detail);
    const exp = await adapter.exportPng({ slug: "s2b-smoke", outPath: pngPath });
    assert.equal(exp.slug, "s2b-smoke");
    const st = await fs.stat(pngPath);
    assert.ok(st.size > 8);
  } finally {
    server.close();
    if (prevBridge === undefined) delete process.env.BRIDGE;
    else process.env.BRIDGE = prevBridge;
    if (prevHealth === undefined) delete process.env.KRITA_HEALTH_MODE;
    else process.env.KRITA_HEALTH_MODE = prevHealth;
  }
});

test("vendor path still constructs (default BRIDGE)", async () => {
  const mod = await loadBridge();
  const prev = process.env.BRIDGE;
  delete process.env.BRIDGE;
  process.env.KRITA_HEALTH_MODE = "cli";
  try {
    const adapter = mod.createKritaMcpAdapter({ repoRoot: ROOT });
    const h = await adapter.health();
    // cli mode: ok true without real Krita
    assert.equal(h.ok, true);
    assert.match(h.detail || "", /cli/i);
  } finally {
    if (prev === undefined) delete process.env.BRIDGE;
    else process.env.BRIDGE = prev;
    delete process.env.KRITA_HEALTH_MODE;
  }
});

test("plugin package files exist (GPL boundary)", async () => {
  for (const rel of [
    "apps/krita-plugin/LICENSE",
    "apps/krita-plugin/graphics_fp_bridge.desktop",
    "apps/krita-plugin/graphics_fp_bridge/__init__.py",
    "apps/krita-plugin/README.md",
  ]) {
    await fs.access(path.join(ROOT, rel));
  }
});
