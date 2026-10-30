/**
 * S3-C openapi fix — honest content-types.
 *   GET /api/openapi.json → JSON (application/json), parsed from docs/openapi.yaml
 *   GET /api/openapi.yaml → raw YAML (application/yaml)
 * Source of truth stays docs/openapi.yaml (hand-written, S3-B #74).
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export function openApiYamlPath(repoRoot) {
  return path.join(repoRoot, "docs", "openapi.yaml");
}

/** @returns {{ yaml: string, json: object } | null} */
export function loadOpenApi(repoRoot) {
  const p = openApiYamlPath(repoRoot);
  if (!fs.existsSync(p)) return null;
  const yaml = fs.readFileSync(p, "utf8");
  const json = parseYaml(yaml);
  if (!json || typeof json !== "object" || typeof json.openapi !== "string") {
    throw new Error("docs/openapi.yaml did not parse to an OpenAPI document");
  }
  return { yaml, json };
}

/** Mount both routes on an Express app. */
export function registerOpenApiRoutes(app, repoRoot) {
  const handler = (format) => (_req, res) => {
    let doc;
    try {
      doc = loadOpenApi(repoRoot);
    } catch (err) {
      console.error(`[world-builder] OPENAPI_PARSE GET ${_req.path}`, err);
      return res.status(500).json({ code: "OPENAPI_PARSE", error: "docs/openapi.yaml failed to parse" });
    }
    if (!doc) return res.status(404).json({ code: "NOT_FOUND", error: "docs/openapi.yaml missing" });
    if (format === "json") {
      return res.type("application/json").send(JSON.stringify(doc.json, null, 2));
    }
    return res.type("application/yaml").send(doc.yaml);
  };
  app.get("/api/openapi.json", handler("json"));
  app.get("/api/openapi.yaml", handler("yaml"));
}
