/**
 * Express API stub — Mongo metadata + local disk for GLB/preview.
 * Sprint 1 surface from Designer contract.
 */
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { safeParseAsset } from "@graphics-pipeline/asset-schema";
import { validateSceneChildren } from "./sceneResolve.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../");
const DATA_ROOT = path.join(REPO_ROOT, "data");
const ASSETS_DIR = path.join(DATA_ROOT, "assets");

const PORT = Number(process.env.PORT || 8787);
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const MONGO_DB = process.env.MONGO_DB || "graphics_pipeline";

/** @type {import('mongodb').Db | null} */
let db = null;
/** In-memory fallback when Mongo is down (local MVP). */
const memoryAssets = new Map();

async function connectMongo() {
  try {
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    await client.connect();
    db = client.db(MONGO_DB);
    console.log(`[world-builder] Mongo connected: ${MONGO_URI}/${MONGO_DB}`);
  } catch (err) {
    db = null;
    console.warn(
      `[world-builder] Mongo unavailable (${err.message}); using in-memory store.`,
    );
  }
}

function collection() {
  return db?.collection("assets") ?? null;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

// Static disk assets (GLB / preview)
app.use("/data", express.static(DATA_ROOT));

app.get("/api/health", async (_req, res) => {
  /** @type {{ ok: boolean, status: string, detail?: string, error?: string, port?: number }} */
  let krita = { ok: false, status: "unchecked" };
  const strict =
    process.env.HEALTH_STRICT_KRITA === "1" || process.env.SMOKE_LIVE === "1";
  const skip =
    process.env.KRITA_HEALTH_MODE === "off" ||
    process.env.SKIP_KRITA_HEALTH === "1";
  if (!skip) {
    try {
      const port = Number(process.env.KRITA_MCP_PORT || 9797);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch(`http://127.0.0.1:${port}/`, {
        method: "GET",
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      krita = {
        ok: true,
        status: "running",
        port,
        detail: `bridge HTTP ${r.status}`,
      };
    } catch (err) {
      krita = {
        ok: false,
        status: "down",
        port: Number(process.env.KRITA_MCP_PORT || 9797),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    krita = { ok: true, status: "skipped" };
  }
  const ok = strict ? krita.ok : true;
  const status = ok ? 200 : 503;
  res.status(status).json({
    ok,
    mongo: Boolean(db),
    krita,
    dataRoot: DATA_ROOT,
    strictKrita: strict,
  });
});

app.get("/api/assets", async (_req, res) => {
  try {
    const col = collection();
    res.setHeader("X-Store", col ? "mongo" : "memory");
    if (process.env.MONGO_REQUIRED === "1" && !col) {
      return res.status(503).json({ error: "Mongo required but unavailable" });
    }
    if (col) {
      const docs = await col.find({}).toArray();
      return res.json(docs);
    }
    return res.json([...memoryAssets.values()]);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/assets/:id", async (req, res) => {
  try {
    const col = collection();
    const doc = col
      ? await col.findOne({ id: req.params.id })
      : memoryAssets.get(req.params.id) ?? null;
    if (!doc) return res.status(404).json({ error: "not found" });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/assets", async (req, res) => {
  try {
    const body = req.body;
    if (!body?.id || !body?.slug) {
      return res.status(400).json({ error: "id and slug required" });
    }
    // Soft invariant: clips ⇒ glb or fbx, never obj for anim
    if (Array.isArray(body.clips) && body.clips.length > 0) {
      if (!body.formats?.glb && !body.formats?.fbx) {
        return res
          .status(400)
          .json({ error: "formats.glb or formats.fbx required when clips present" });
      }
      if (body.formats?.obj) {
        return res
          .status(400)
          .json({ error: "formats.obj forbidden for animated assets (use GLB or FBX)" });
      }
    }

    // S2-E: schema gates (scene stub, humanoid, formats, …)
    const parsed = safeParseAsset(body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join("; ");
      return res.status(400).json({ error: msg, issues: parsed.error.issues });
    }

    const col = collection();
    const resolveDoc = async (idOrSlug) => {
      if (col) {
        return (
          (await col.findOne({ id: idOrSlug })) ||
          (await col.findOne({ slug: idOrSlug }))
        );
      }
      for (const doc of memoryAssets.values()) {
        if (doc.id === idOrSlug || doc.slug === idOrSlug) return doc;
      }
      return null;
    };
    // S2-G-E1: collect all id/slug hits so ambiguous slugs reject (V4a)
    const resolveAll = async (idOrSlug) => {
      if (col) {
        const byId = await col.find({ id: idOrSlug }).toArray();
        if (byId.length) return byId;
        return await col.find({ slug: idOrSlug }).toArray();
      }
      const out = [];
      for (const doc of memoryAssets.values()) {
        if (doc.id === idOrSlug || doc.slug === idOrSlug) out.push(doc);
      }
      return out;
    };

    // S2-F-E1 / S2-G-E1: V4/V4a hard resolve (+ V5 nested, V6b defaultClip, V8 corrupt)
    // normalize: persist canonical child id when input was a unique slug
    if (body.stage === "scene" && body.scene?.nodes) {
      const sceneErr = await validateSceneChildren(body.scene.nodes, resolveDoc, {
        resolveAll,
        normalize: true,
      });
      if (sceneErr) {
        return res.status(400).json({ error: sceneErr });
      }
    }

    if (col) {
      await col.updateOne({ id: body.id }, { $set: body }, { upsert: true });
    } else {
      memoryAssets.set(body.id, body);
    }
    res.status(201).json(body);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});


app.patch("/api/assets/:id/clip-ux", async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body ?? {};
    const clipUx = {
      defaultClip:
        typeof body.defaultClip === "string" ? body.defaultClip : undefined,
      order: Array.isArray(body.order)
        ? body.order.filter((x) => typeof x === "string")
        : undefined,
      disabled: Array.isArray(body.disabled)
        ? body.disabled.filter((x) => typeof x === "string")
        : undefined,
    };
    const col = collection();
    const existing = col
      ? await col.findOne({ id })
      : memoryAssets.get(id) ?? null;
    if (!existing) return res.status(404).json({ error: "not found" });
    const next = {
      ...existing,
      clipUx,
      updatedAt: new Date().toISOString(),
    };
    if (col) {
      await col.updateOne({ id }, { $set: { clipUx, updatedAt: next.updatedAt } });
    } else {
      memoryAssets.set(id, next);
    }
    res.json(next);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/assets/:id/file", async (req, res) => {
  try {
    const format = (req.query.format || "glb").toString();
    if (format === "obj") {
      // static-only path; animated must not use this for playback
    }
    const col = collection();
    const doc = col
      ? await col.findOne({ id: req.params.id })
      : memoryAssets.get(req.params.id) ?? null;

    let rel;
    if (format === "obj") {
      rel = doc?.formats?.obj;
    } else if (format === "fbx") {
      rel = doc?.formats?.fbx ?? `assets/${req.params.id}/model.fbx`;
    } else {
      rel = doc?.formats?.glb ?? `assets/${req.params.id}/model.glb`;
    }
    if (!rel) return res.status(404).json({ error: "no file path" });
    // rel is under data/
    const abs = path.join(DATA_ROOT, rel.replace(/^data\//, ""));
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ error: `file missing: ${abs}` });
    }
    res.sendFile(abs);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/assets/:id/preview", async (req, res) => {
  try {
    const col = collection();
    const doc = col
      ? await col.findOne({ id: req.params.id })
      : memoryAssets.get(req.params.id) ?? null;
    const rel = doc?.formats?.preview ?? `assets/${req.params.id}/preview.png`;
    const abs = path.join(DATA_ROOT, rel.replace(/^data\//, ""));
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ error: `preview missing: ${abs}` });
    }
    res.sendFile(abs);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

fs.mkdirSync(ASSETS_DIR, { recursive: true });

await connectMongo();
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[world-builder] http://127.0.0.1:${PORT}`);
});
