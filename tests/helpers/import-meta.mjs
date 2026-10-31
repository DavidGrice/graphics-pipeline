/**
 * S3-G CO-3 — shared minimal importMeta (the S3-F #47 probe trap: `source` is required).
 * `makeImportMeta({ sourceKra: "a.kra" })` → `{ source: "unknown", sourceKra: "a.kra" }`; overrides win,
 * and an override of `undefined` drops the key (to build a deliberately invalid body).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const IMPORTMETA_MINIMAL_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "importmeta-minimal.json");

export function makeImportMeta(overrides = {}) {
  const out = { ...JSON.parse(fs.readFileSync(IMPORTMETA_MINIMAL_PATH, "utf8")), ...overrides };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
