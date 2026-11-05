/**
 * S3-H CO-2 — UI tests own their fixtures.
 * Registers an asset (optional GLB bytes on disk under WB_DATA_ROOT and/or repo data/),
 * and returns `{ id, slug, cleanup }` so the caller always removes what it created.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, billboardBody, makeRiggedGlb, runId } from "./s3d-synth.mjs";

const json = { "Content-Type": "application/json" };

/**
 * @param {string} API  base URL (e.g. http://127.0.0.1:8792)
 * @param {object} [opts]
 * @param {string} [opts.tag]         salt for runId / default slug
 * @param {string} [opts.id]          override id (must be unique)
 * @param {string} [opts.slug]        override slug
 * @param {string} [opts.createdAt]   ISO createdAt/updatedAt
 * @param {object} [opts.body]        extra/override fields merged onto billboardBody
 * @param {boolean} [opts.writeGlb]   write model.glb under data roots (default true)
 * @param {object} [opts.glb]         makeRiggedGlb options
 * @param {Buffer|Uint8Array} [opts.glbBytes] raw GLB bytes (skips makeRiggedGlb)
 */
export async function registerFixture(API, opts = {}) {
  const tag = opts.tag || "fx";
  const id = opts.id || runId(tag);
  const slug = opts.slug || `fx-${tag}-${process.pid}`;
  const body = { ...billboardBody(id, slug), ...(opts.body || {}) };
  if (opts.createdAt) {
    body.createdAt = opts.createdAt;
    body.updatedAt = opts.createdAt;
  }
  let status = 0;
  try {
    status = (await fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(body) })).status;
  } catch {
    status = 0;
  }
  if (status !== 201) {
    const err = new Error(`registerFixture POST ${status || "unreachable"}`);
    err.status = status;
    throw err;
  }

  const glbDirs = [];
  if (opts.writeGlb !== false) {
    const bytes = opts.glbBytes || makeRiggedGlb(opts.glb || { bones: 2, clips: {} });
    const roots = [...new Set([process.env.WB_DATA_ROOT, path.join(ROOT, "data")].filter(Boolean))];
    for (const root of roots) {
      const d = path.join(root, "assets", id);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "model.glb"), bytes);
      glbDirs.push(d);
    }
  }

  return {
    id,
    slug,
    body,
    cleanup: async () => {
      await fetch(`${API}/api/assets/${id}`, { method: "DELETE" }).catch(() => {});
      for (const d of glbDirs) fs.rmSync(d, { recursive: true, force: true });
    },
  };
}
