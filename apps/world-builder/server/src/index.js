/**
 * Express API stub — Mongo metadata + local disk for GLB/preview.
 * Sprint 1 surface from Designer contract.
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import {
  safeParseAsset,
  ClipUxSchema,
  parseMaxGlbMb,
  maxGlbBytes,
  ALT_TEXT_MAX,
  suggestSlug,
  SCENE_MAX_NODES_DEFAULT,
  liveSceneNodes,
} from "@graphics-pipeline/asset-schema";

/**
 * S3-D #88 — normalise altText. Returns { value } (undefined = clear) or { error } envelope args.
 * Trimmed; "" clears; > ALT_TEXT_MAX → ALT_TEXT_TOO_LONG; non-string → VALIDATION.
 */
function normaliseAltText(raw) {
  if (raw === null) return { value: undefined };
  if (typeof raw !== "string") return { error: ["VALIDATION", "altText must be a string"] };
  const t = raw.trim();
  if (t.length > ALT_TEXT_MAX) {
    return {
      error: ["ALT_TEXT_TOO_LONG", `altText is ${t.length} characters; max ${ALT_TEXT_MAX}`, { length: t.length, max: ALT_TEXT_MAX }],
    };
  }
  return { value: t.length ? t : undefined };
}
import { validateSceneChildren } from "./sceneResolve.js";
import { registerOpenApiRoutes } from "./openapi.js";
import { sendError, sendInternal, sendValidation } from "./errors.js";
import {
  ConfigError,
  corsAllowlist,
  parseCorsOrigins,
  parseRateLimitPerMin,
  parseSceneMaxNodes,
  parseTrustProxy,
  rateLimiter,
} from "./security.js";
import {
  resolveUnder,
  PathGuardError,
  PATH_OUTSIDE_INBOX,
} from "./pathGuard.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VALID_STAGES = new Set(["mvp-billboard", "rigged", "scene"]);
const ASSET_SCHEMA_VERSION = 3;

/**
 * Normalize Express query value to string[] (repeat params → AND).
 * Non-strings are dropped (never coerced to "" which would drop the filter).
 */
function queryStringList(raw) {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  /** @type {string[]} */
  const out = [];
  for (const v of arr) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t) out.push(t);
  }
  return out;
}


/**
 * Probe BLENDER_BIN / KRITA_BIN (or box defaults) for version strings.
 * Missing binaries → null fields; never fails the health route.
 */
async function probeToolVersions() {
  const blenderBin =
    process.env.BLENDER_BIN ||
    (process.platform === "linux" ? "/home/box/tools/blender" : undefined);
  const kritaBin =
    process.env.KRITA_BIN ||
    (process.platform === "linux" ? "/home/box/tools/krita" : undefined);

  /** @type {{ blender: { path?: string, version?: string } | null, krita: { path?: string, version?: string } | null }} */
  const tools = { blender: null, krita: null };

  async function versionOf(bin) {
    if (!bin || !fs.existsSync(bin)) return null;
    try {
      const { stdout, stderr } = await execFileAsync(bin, ["--version"], {
        timeout: 4000,
        env: process.env,
      });
      const out = `${stdout || ""}\n${stderr || ""}`;
      const m = out.match(/(\d+\.\d+(?:\.\d+)?[^\n]*)/);
      return {
        path: bin,
        version: m ? m[1].trim() : out.trim().split("\n")[0] || "unknown",
      };
    } catch {
      return { path: bin, version: undefined };
    }
  }

  tools.blender = await versionOf(blenderBin);
  tools.krita = await versionOf(kritaBin);
  return tools;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../");
// WB_DATA_ROOT (S3-D): hermetic tests point the API at a tmp data dir; default repo data/.
const DATA_ROOT = process.env.WB_DATA_ROOT
  ? path.resolve(process.env.WB_DATA_ROOT)
  : path.join(REPO_ROOT, "data");
const ASSETS_DIR = path.join(DATA_ROOT, "assets");
const INBOX_ROOT = path.join(DATA_ROOT, "inbox");

// S3-D #76 — MAX_GLB_MB (default 100, integer ≥ 1). Invalid → refuse to start (fail-closed).
// S3-E: every fail-closed start error is CONFIG_INVALID and names the variable, never its value.
let MAX_GLB_MB;
let RATE_LIMIT_PER_MIN;
let CORS_ORIGINS;
let TRUST_PROXY;
let SCENE_MAX_NODES;
try {
  try {
    MAX_GLB_MB = parseMaxGlbMb(process.env.MAX_GLB_MB);
  } catch {
    throw new ConfigError("MAX_GLB_MB", "must be an integer >= 1");
  }
  RATE_LIMIT_PER_MIN = parseRateLimitPerMin(process.env.RATE_LIMIT_PER_MIN);
  CORS_ORIGINS = parseCorsOrigins(process.env.CORS_ORIGINS);
  TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);
  SCENE_MAX_NODES = parseSceneMaxNodes(process.env.SCENE_MAX_NODES, SCENE_MAX_NODES_DEFAULT);
} catch (err) {
  console.error(`[world-builder] FATAL ${err instanceof ConfigError ? err.message : "CONFIG_INVALID: startup config"}`);
  process.exit(1);
}
const MAX_GLB_BYTES = maxGlbBytes(MAX_GLB_MB);

const FORMAT_KEYS = ["glb", "fbx", "obj", "preview"];

/**
 * S3-D #141 (R1 rev2 §3) — every formats.* path must stay under DATA_ROOT; sourcePng under
 * data/inbox. Any escape → PATH_OUTSIDE_INBOX. Neither the input nor the resolved path is echoed.
 * @returns {{ abs: Record<string,string> } | { code: string, field: string, reason: string }}
 */
function guardFormats(formats) {
  /** @type {Record<string, string>} */
  const abs = {};
  if (!formats || typeof formats !== "object") return { abs };
  for (const key of FORMAT_KEYS) {
    const v = formats[key];
    if (v === undefined) continue;
    try {
      abs[key] = resolveUnder(DATA_ROOT, v, { stripPrefix: /^data\// });
    } catch (err) {
      if (err instanceof PathGuardError) {
        return { code: err.code, field: `formats.${key}`, reason: err.reason };
      }
      throw err;
    }
  }
  if (formats.sourcePng !== undefined) {
    const v = formats.sourcePng;
    try {
      const s = typeof v === "string" ? v.replace(/\\/g, "/").replace(/^data\//, "") : v;
      if (typeof s !== "string" || !s.startsWith("inbox/")) {
        throw new PathGuardError(PATH_OUTSIDE_INBOX, "sourcePng must be under inbox/");
      }
      abs.sourcePng = resolveUnder(INBOX_ROOT, s.slice("inbox/".length), { code: PATH_OUTSIDE_INBOX });
    } catch (err) {
      if (err instanceof PathGuardError) {
        return { code: PATH_OUTSIDE_INBOX, field: "formats.sourcePng", reason: err.reason };
      }
      throw err;
    }
  }
  return { abs };
}

function sendPathError(res, g) {
  return sendError(res, 400, g.code, `${g.field}: path rejected (${g.reason})`, { field: g.field });
}

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

/** S3-E #41 — `deleted: false` (or any non-true) is normalised to absent before validation. */
function normaliseTombstones(scene) {
  if (!scene || !Array.isArray(scene.nodes)) return;
  for (const n of scene.nodes) {
    if (n && typeof n === "object" && Object.prototype.hasOwnProperty.call(n, "deleted") && n.deleted !== true) {
      delete n.deleted;
    }
  }
}

/** S3-E #38 — live-node cap (tombstones excluded, Leader ruling). Returns a sent response or null. */
function sendSceneCapError(res, scene) {
  if (!scene || !Array.isArray(scene.nodes)) return null;
  const count = liveSceneNodes(scene.nodes).length;
  if (count <= SCENE_MAX_NODES) return null;
  return sendError(
    res,
    400,
    "SCENE_NODES_MAX",
    `scene has ${count} live nodes; max is ${SCENE_MAX_NODES} (SCENE_MAX_NODES)`,
    { max: SCENE_MAX_NODES, count },
  );
}

const app = express();
// S3-E #145 — exact-origin allowlist (was cors({origin:true}) = reflect any Origin).
app.use(corsAllowlist(CORS_ORIGINS));
// S3-E #139 — token bucket on mutating /api routes; GET/HEAD/OPTIONS never throttled.
app.use(rateLimiter({ perMin: RATE_LIMIT_PER_MIN, trustProxy: TRUST_PROXY }));
app.use(express.json({ limit: "2mb" }));
// S3-D R1 §0 — body-parser failures use the same envelope (no HTML error pages).
app.use((err, _req, res, next) => {
  if (!err) return next();
  if (err.type === "entity.too.large") {
    return sendError(res, 413, "PAYLOAD_TOO_LARGE", "JSON body exceeds 2mb");
  }
  if (err.type === "entity.parse.failed") {
    return sendError(res, 400, "INVALID_JSON", "request body is not valid JSON");
  }
  return next(err);
});

// Static disk assets (GLB / preview)
app.use("/data", express.static(DATA_ROOT));

app.get("/api/health", async (_req, res) => {
  /** @type {{ ok: boolean, status: string, detail?: string, error?: string, port?: number }} */
  let krita = { ok: false, status: "unchecked" };
  const strict =
    process.env.HEALTH_STRICT_KRITA === "1" || process.env.SMOKE_LIVE === "1";
  const bridgeMode = (process.env.BRIDGE || "").toLowerCase();
  const skip =
    process.env.KRITA_HEALTH_MODE === "off" ||
    process.env.SKIP_KRITA_HEALTH === "1" ||
    bridgeMode === "mock";
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
    krita = {
      ok: true,
      status: bridgeMode === "mock" ? "mock" : "skipped",
    };
  }

  // S3-A #103 — tool version badge (null when missing; API still ok)
  const tools = await probeToolVersions();

  const ok = strict ? krita.ok : true;
  const status = ok ? 200 : 503;
  // R1 nit: a 5xx body never carries absolute paths — strip tool paths/dataRoot on 503.
  const safeTools = ok
    ? tools
    : Object.fromEntries(
        Object.entries(tools).map(([k, v]) => [k, v ? { version: v.version } : null]),
      );
  res.status(status).json({
    ...(ok ? {} : { code: "KRITA_DOWN", error: "strict Krita health check failed" }),
    ok,
    mongo: Boolean(db),
    krita,
    tools: safeTools,
    blender: tools.blender?.version ?? null,
    // S3-E #38 — the scene author reads its "Nodes n / max" cap from here.
    limits: { sceneMaxNodes: SCENE_MAX_NODES },
    ...(ok ? { dataRoot: DATA_ROOT } : {}),
    strictKrita: strict,
    ...(bridgeMode === "mock" ? { bridge: "mock" } : {}),
  });
});

app.get("/api/assets", async (req, res) => {
  try {
    const col = collection();
    res.setHeader("X-Store", col ? "mongo" : "memory");
    if (process.env.MONGO_REQUIRED === "1" && !col) {
      return sendError(res, 503, "MONGO_REQUIRED", "Mongo required but unavailable");
    }

    const qList = queryStringList(req.query.q).map((s) => s.toLowerCase());
    const stageList = queryStringList(req.query.stage);
    const characterTypeList = queryStringList(req.query.characterType);
    const clipList = queryStringList(req.query.clip);
    const tagList = queryStringList(req.query.tag);
    // S3-D #94 — optional ?sort=-createdAt|createdAt and ?limit=1..100
    const sortList = queryStringList(req.query.sort);
    const limitList = queryStringList(req.query.limit);
    if (sortList.length > 1 || (sortList.length && !["-createdAt", "createdAt"].includes(sortList[0]))) {
      return sendError(res, 400, "VALIDATION", 'sort must be "-createdAt" or "createdAt"');
    }
    let limit = null;
    if (limitList.length) {
      const l = limitList[0];
      if (limitList.length > 1 || !/^[0-9]+$/.test(l) || Number(l) < 1 || Number(l) > 100) {
        return sendError(res, 400, "VALIDATION", "limit must be an integer 1..100");
      }
      limit = Number(l);
    }

    for (const stage of stageList) {
      if (!VALID_STAGES.has(stage)) {
        return sendError(
          res,
          400,
          "VALIDATION",
          `unknown stage "${stage}" (expected mvp-billboard|rigged|scene)`,
        );
      }
    }

    const all = col
      ? await col.find({}).toArray()
      : [...memoryAssets.values()];

    const filtered = all.filter((doc) => {
      // AND across all provided filter values (repeat params included)
      for (const stage of stageList) {
        if (doc.stage !== stage) return false;
      }
      for (const characterType of characterTypeList) {
        if (doc.characterType !== characterType) return false;
      }
      if (clipList.length) {
        const clips = Array.isArray(doc.clips) ? doc.clips : [];
        for (const clip of clipList) {
          if (!clips.includes(clip)) return false;
        }
      }
      if (tagList.length) {
        const tags = Array.isArray(doc.tags) ? doc.tags : [];
        for (const tag of tagList) {
          if (!tags.includes(tag)) return false;
        }
      }
      if (qList.length) {
        const name = String(doc.name || "").toLowerCase();
        const slug = String(doc.slug || "").toLowerCase();
        for (const q of qList) {
          if (!name.includes(q) && !slug.includes(q)) return false;
        }
      }
      return true;
    });

    let out = filtered;
    if (sortList.length) {
      const dir = sortList[0].startsWith("-") ? -1 : 1;
      const ts = (d) => {
        const t = Date.parse(d?.createdAt ?? "");
        return Number.isFinite(t) ? t : null;
      };
      // stable; legacy assets without a parseable createdAt always sort last
      out = filtered
        .map((d, i) => ({ d, i, t: ts(d) }))
        .sort((a, b) => {
          if (a.t == null || b.t == null) return (a.t == null) - (b.t == null) || a.i - b.i;
          return (a.t - b.t) * dir || a.i - b.i;
        })
        .map((x) => x.d);
    }
    if (limit != null) out = out.slice(0, limit);
    return res.json(out);
  } catch (err) {
    sendInternal(req, res, err);
  }
});

app.get("/api/assets/:id", async (req, res) => {
  try {
    const col = collection();
    const doc = col
      ? await col.findOne({ id: req.params.id })
      : memoryAssets.get(req.params.id) ?? null;
    if (!doc) return sendError(res, 404, "NOT_FOUND", "not found");
    res.json(doc);
  } catch (err) {
    sendInternal(req, res, err);
  }
});

app.post("/api/assets", async (req, res) => {
  try {
    const body = req.body;
    if (!body?.id || !body?.slug) {
      return sendError(res, 400, "VALIDATION", "id and slug required");
    }
    // S3-D #88 — altText normalised before schema (ALT_TEXT_TOO_LONG beats generic VALIDATION)
    if (Object.prototype.hasOwnProperty.call(body, "altText")) {
      const a = normaliseAltText(body.altText);
      if (a.error) return sendError(res, 400, ...a.error);
      if (a.value === undefined) delete body.altText;
      else body.altText = a.value;
    }
    // S3-D #94 — history needs createdAt; stamp it when the client omitted it
    if (body.createdAt == null) body.createdAt = new Date().toISOString();
    if (body.updatedAt == null) body.updatedAt = body.createdAt;
    // Soft invariant: clips ⇒ glb or fbx, never obj for anim
    if (Array.isArray(body.clips) && body.clips.length > 0) {
      if (!body.formats?.glb && !body.formats?.fbx) {
        return sendError(res, 400, "VALIDATION", "formats.glb or formats.fbx required when clips present");
      }
      if (body.formats?.obj) {
        return sendError(
          res,
          400,
          "VALIDATION",
          "formats.obj forbidden for animated assets (use GLB or FBX)",
        );
      }
    }

    // S3-D #141 — containment before any fs touch; #76 — size cap before schema/probe.
    const guard = guardFormats(body.formats);
    if ("code" in guard) return sendPathError(res, guard);
    if (guard.abs.glb && fs.existsSync(guard.abs.glb)) {
      const sizeBytes = fs.statSync(guard.abs.glb).size;
      if (sizeBytes > MAX_GLB_BYTES) {
        return sendError(
          res,
          413,
          "GLB_TOO_LARGE",
          `GLB is ${sizeBytes} bytes; max is ${MAX_GLB_BYTES} (MAX_GLB_MB=${MAX_GLB_MB})`,
          { sizeBytes, maxBytes: MAX_GLB_BYTES },
        );
      }
    }

    // S2-E: schema gates (scene stub, humanoid, formats, …)
    normaliseTombstones(body.scene);
    const parsed = safeParseAsset(body);
    if (!parsed.success) return sendValidation(res, parsed);
    if (sendSceneCapError(res, body.scene)) return;

    const col = collection();
    // S3-D #127 — a slug owned by a different id → 409 SLUG_CLASH (same id re-register is idempotent)
    {
      const owners = col
        ? await col.find({ slug: body.slug }).toArray()
        : [...memoryAssets.values()].filter((d) => d.slug === body.slug);
      const other = owners.find((d) => d.id !== body.id);
      if (other) {
        const taken = new Set(
          col
            ? (await col.find({}, { projection: { slug: 1 } }).toArray()).map((d) => d.slug)
            : [...memoryAssets.values()].map((d) => d.slug),
        );
        return sendError(res, 409, "SLUG_CLASH", `slug "${body.slug}" is already used by ${other.id}`, {
          slug: body.slug,
          existingId: other.id,
          suggestedSlug: suggestSlug(body.slug, (s) => taken.has(s)),
        });
      }
    }
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
        return sendError(res, 400, "SCENE_RESOLVE", sceneErr);
      }
    }

    if (body.assetSchemaVersion == null) {
      body.assetSchemaVersion = ASSET_SCHEMA_VERSION;
    }
    if (col) {
      await col.updateOne({ id: body.id }, { $set: body }, { upsert: true });
    } else {
      memoryAssets.set(body.id, body);
    }
    res.status(201).json(body);
  } catch (err) {
    sendInternal(req, res, err);
  }
});



app.patch("/api/assets/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body ?? {};
    const col = collection();
    const existing = col
      ? await col.findOne({ id })
      : memoryAssets.get(id) ?? null;
    if (!existing) return sendError(res, 404, "NOT_FOUND", "not found");

    for (const forbidden of ["formats", "clips", "rig", "stage", "id", "slug"]) {
      if (Object.prototype.hasOwnProperty.call(body, forbidden)) {
        return sendError(
          res,
          400,
          "PATCH_FORBIDDEN_FIELD",
          `PATCH cannot modify "${forbidden}" (use register/probe paths)`,
        );
      }
    }

    /** @type {Record<string, unknown>} */
    const patch = {};
    if (typeof body.name === "string" && body.name.trim()) {
      patch.name = body.name.trim();
    }
    if (Array.isArray(body.tags)) {
      patch.tags = body.tags.filter((x) => typeof x === "string");
    }
    if (body.clipTags !== undefined) {
      patch.clipTags = body.clipTags;
    }
    if (typeof body.characterType === "string") {
      patch.characterType = body.characterType;
    }
    if (body.clipUx !== undefined) {
      patch.clipUx = body.clipUx;
    }
    if (body.scene !== undefined) {
      patch.scene = body.scene;
    }
    // S3-B #137
    if (body.license !== undefined) {
      patch.license = body.license;
    }
    // S3-D #88 — altText: trimmed 1–280, "" or null clears, > 280 → ALT_TEXT_TOO_LONG
    let clearAltText = false;
    if (Object.prototype.hasOwnProperty.call(body, "altText")) {
      const a = normaliseAltText(body.altText);
      if (a.error) return sendError(res, 400, ...a.error);
      if (a.value === undefined) clearAltText = true;
      else patch.altText = a.value;
    }
    // S3-B #91 — merge importMeta (do not wipe unrelated fields)
    if (body.importMeta !== undefined) {
      if (body.importMeta === null || typeof body.importMeta !== "object") {
        return sendError(res, 400, "VALIDATION", "importMeta must be an object");
      }
      patch.importMeta = {
        ...(existing.importMeta || {}),
        ...body.importMeta,
      };
    }
    // S3-B #8 HARDEN — forbid inventing clipDurations via PATCH
    if (Object.prototype.hasOwnProperty.call(body, "clipDurations")) {
      return sendError(
        res,
        400,
        "PATCH_FORBIDDEN_FIELD",
        "PATCH cannot modify clipDurations (probe-only write)",
      );
    }

    const prevVer =
      typeof existing.assetSchemaVersion === "number"
        ? existing.assetSchemaVersion
        : 1;
    if (body.assetSchemaVersion != null) {
      const nextVer = Number(body.assetSchemaVersion);
      if (!Number.isFinite(nextVer) || nextVer < prevVer) {
        return sendError(res, 400, "SCHEMA_VERSION_DECREMENT", "assetSchemaVersion cannot decrement");
      }
      patch.assetSchemaVersion = nextVer;
    } else if (existing.assetSchemaVersion == null) {
      patch.assetSchemaVersion = ASSET_SCHEMA_VERSION;
    }

    const next = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    if (clearAltText) delete next.altText;

    normaliseTombstones(next.scene);
    const parsed = safeParseAsset(next);
    if (!parsed.success) return sendValidation(res, parsed);
    if (sendSceneCapError(res, next.scene)) return;

    if (next.stage === "scene" && next.scene?.nodes) {
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
      const sceneErr = await validateSceneChildren(next.scene.nodes, resolveDoc, {
        resolveAll,
        normalize: true,
      });
      if (sceneErr) {
        return sendError(res, 400, "SCENE_RESOLVE", sceneErr);
      }
    }

    if (col) {
      await col.updateOne({ id }, clearAltText ? { $set: next, $unset: { altText: "" } } : { $set: next });
    } else {
      memoryAssets.set(id, next);
    }
    res.json(next);
  } catch (err) {
    sendInternal(req, res, err);
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
    // S3-C #1 / #2 — viewer blend + timescale prefs (validated; out of range → 400).
    for (const key of ["blendMs", "timeScale"]) {
      if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
        clipUx[key] = body[key];
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "clipDurations")) {
      return sendError(res, 400, "PATCH_FORBIDDEN_FIELD", "clip-ux cannot modify clipDurations (probe-only write)");
    }
    const uxParsed = ClipUxSchema.safeParse(clipUx);
    if (!uxParsed.success) return sendValidation(res, uxParsed);
    const col = collection();
    const existing = col
      ? await col.findOne({ id })
      : memoryAssets.get(id) ?? null;
    if (!existing) return sendError(res, 404, "NOT_FOUND", "not found");
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
    sendInternal(req, res, err);
  }
});

/**
 * S3-C tip3 — DELETE /api/assets/:id (metadata only; test cleanup + orphan removal).
 * 409 when a stage=scene asset still references it (keeps V4 integrity).
 * Never deletes data/** files (media lifecycle stays with the pipeline).
 */
app.delete("/api/assets/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const col = collection();
    const existing = col ? await col.findOne({ id }) : memoryAssets.get(id) ?? null;
    if (!existing) return sendError(res, 404, "NOT_FOUND", "not found");
    const all = col ? await col.find({ stage: "scene" }).toArray() : [...memoryAssets.values()];
    // S3-E #41 (R1 §6) — tombstoned references still block (restore must not dangle).
    const hits = all
      .filter((d) => d.stage === "scene" && d.id !== id)
      .map((d) => {
        const using = (d.scene?.nodes ?? []).filter((n) => n.assetId === id || n.assetId === existing.slug);
        return { id: d.id, live: using.some((n) => n.deleted !== true), any: using.length > 0 };
      })
      .filter((h) => h.any);
    const refs = hits.map((h) => h.id);
    if (refs.length) {
      const deletedRefs = hits.filter((h) => !h.live).map((h) => h.id);
      return sendError(
        res,
        409,
        "ASSET_IN_USE",
        deletedRefs.length === refs.length
          ? `asset referenced only by deleted nodes in scene(s): ${refs.join(", ")}; purge them to free it`
          : `asset referenced by scene(s): ${refs.join(", ")}`,
        { refs, deletedRefs },
      );
    }
    if (col) await col.deleteOne({ id });
    else memoryAssets.delete(id);
    res.status(204).end();
  } catch (err) {
    sendInternal(req, res, err);
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
    if (!rel) return sendError(res, 404, "FILE_MISSING", "no file path");
    // S3-D #141 — rel must stay under DATA_ROOT; 404 bodies carry rel, never abs.
    let abs;
    try {
      abs = resolveUnder(DATA_ROOT, rel, { stripPrefix: /^data\// });
    } catch (err) {
      if (err instanceof PathGuardError) {
        return sendError(res, 400, err.code, `stored path rejected (${err.reason})`, { field: `formats.${format}` });
      }
      throw err;
    }
    if (!fs.existsSync(abs)) {
      return sendError(res, 404, "FILE_MISSING", `file missing: ${rel}`, { rel, assetId: req.params.id });
    }
    // fs errors (EACCES/EISDIR/…) surface here, not in the catch — keep them out of the body
    res.sendFile(abs, (err) => {
      if (err) sendInternal(req, res, err);
    });
  } catch (err) {
    sendInternal(req, res, err);
  }
});

app.get("/api/assets/:id/preview", async (req, res) => {
  try {
    const col = collection();
    const doc = col
      ? await col.findOne({ id: req.params.id })
      : memoryAssets.get(req.params.id) ?? null;
    const rel = doc?.formats?.preview ?? `assets/${req.params.id}/preview.png`;
    let abs;
    try {
      abs = resolveUnder(DATA_ROOT, rel, { stripPrefix: /^data\// });
    } catch (err) {
      if (err instanceof PathGuardError) {
        return sendError(res, 400, err.code, `stored path rejected (${err.reason})`, { field: "formats.preview" });
      }
      throw err;
    }
    if (!fs.existsSync(abs)) {
      return sendError(res, 404, "FILE_MISSING", `preview missing: ${rel}`, { rel, assetId: req.params.id });
    }
    // fs errors (EACCES/EISDIR/…) surface here, not in the catch — keep them out of the body
    res.sendFile(abs, (err) => {
      if (err) sendInternal(req, res, err);
    });
  } catch (err) {
    sendInternal(req, res, err);
  }
});


// S3-C openapi fix: JSON at .json (application/json), YAML at .yaml (application/yaml)
registerOpenApiRoutes(app, REPO_ROOT);

// R1 nit (tip1): JSON 404 for unknown routes (Express' HTML default echoes the URL path) and a
// terminal error handler — no stack/err.message/absolute path ever reaches a response body.
app.use((_req, res) => sendError(res, 404, "NOT_FOUND", "no such route"));
app.use((err, req, res, _next) => sendInternal(req, res, err));

fs.mkdirSync(ASSETS_DIR, { recursive: true });

await connectMongo();
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[world-builder] http://127.0.0.1:${PORT} (MAX_GLB_MB=${MAX_GLB_MB} RATE_LIMIT_PER_MIN=${RATE_LIMIT_PER_MIN} SCENE_MAX_NODES=${SCENE_MAX_NODES} CORS_ORIGINS=${CORS_ORIGINS.length})`);
});
