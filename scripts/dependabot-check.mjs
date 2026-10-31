/**
 * S3-F #106 — YAML parse + shape check for .github/dependabot.yml (used by `npm run lint:ci`).
 * Returns a list of problems (empty = ok). Rules (D2): version 2; every update targets `dev`, keeps
 * the semver-major ignore; npm has groups `npm-minor-patch` (patterns "*", minor+patch) and
 * `npm-dev` (development deps); github-actions has group `actions` (patterns "*").
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export const DEPENDABOT_PATH = ".github/dependabot.yml";

export function dependabotProblems(text) {
  let doc;
  try {
    doc = parse(text);
  } catch (err) {
    return [`not valid YAML (${String(err?.message ?? err).split("\n")[0]})`];
  }
  const out = [];
  if (!doc || typeof doc !== "object") return ["top level must be a mapping"];
  if (doc.version !== 2) out.push("version must be 2");
  if (!Array.isArray(doc.updates) || doc.updates.length === 0) return [...out, "updates must be a non-empty list"];
  const by = (eco) => doc.updates.find((u) => u?.["package-ecosystem"] === eco);
  for (const [i, u] of doc.updates.entries()) {
    const at = `updates[${i}]`;
    if (!u || typeof u !== "object") {
      out.push(`${at} must be a mapping`);
      continue;
    }
    if (typeof u["package-ecosystem"] !== "string") out.push(`${at}.package-ecosystem missing`);
    if (typeof u.directory !== "string") out.push(`${at}.directory missing`);
    if (typeof u.schedule?.interval !== "string") out.push(`${at}.schedule.interval missing`);
    if (u["target-branch"] !== "dev") out.push(`${at}.target-branch must be "dev"`);
    const majorIgnored = (u.ignore ?? []).some(
      (r) => r?.["dependency-name"] === "*" && (r["update-types"] ?? []).includes("version-update:semver-major"),
    );
    if (!majorIgnored) out.push(`${at} must ignore version-update:semver-major for "*"`);
  }
  const same = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x));
  const npm = by("npm");
  if (!npm) out.push("npm update missing");
  else {
    const g = npm.groups ?? {};
    if (!g["npm-minor-patch"] || !same(g["npm-minor-patch"].patterns, ["*"]) || !same(g["npm-minor-patch"]["update-types"], ["minor", "patch"])) {
      out.push('npm groups.npm-minor-patch must have patterns ["*"] and update-types [minor, patch]');
    }
    if (g["npm-dev"]?.["dependency-type"] !== "development") out.push("npm groups.npm-dev must have dependency-type development");
  }
  const gha = by("github-actions");
  if (!gha) out.push("github-actions update missing");
  else if (!same(gha.groups?.actions?.patterns, ["*"])) out.push('github-actions groups.actions must have patterns ["*"]');
  return out;
}

export function checkDependabotFile(cwd = process.cwd()) {
  const f = path.join(cwd, DEPENDABOT_PATH);
  if (!fs.existsSync(f)) return [`${DEPENDABOT_PATH} missing`];
  return dependabotProblems(fs.readFileSync(f, "utf8"));
}
