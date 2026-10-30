/**
 * S3-D E3 #152 — docs/error-codes.md is the code encyclopedia (R1 rev2 §12, D2 §3).
 * Fails in BOTH directions: a code in source missing from the doc, or a doc code gone from source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers/s3d-synth.mjs";
import { sourceCodes, sourceText, parseDoc, GROUPS, HEADER } from "./helpers/error-codes-scan.mjs";

const DOC = path.join(ROOT, "docs/error-codes.md");
const md = fs.readFileSync(DOC, "utf8");
const groups = parseDoc(md);
const docCodes = (gs = groups) => new Set(gs.flatMap((g) => g.rows.flatMap((r) => r.codes)));
const isV = (c) => /^V\d+[a-z]?$/.test(c);

/** source ⊆ doc and doc ⊆ source; returns {missingInDoc, missingInSource}. */
function compare(src, doc, text) {
  return {
    missingInDoc: [...src.keys()].filter((c) => !doc.has(c)).sort(),
    missingInSource: [...doc]
      .filter((c) => !src.has(c) && !(isV(c) && new RegExp(`\\b${c}\\b`).test(text)))
      .sort(),
  };
}

test("#152 D2 layout: six groups in order, one column set, rows alphabetical", () => {
  assert.deepEqual(groups.map((g) => g.group), GROUPS);
  for (const g of groups) {
    assert.equal(g.header, HEADER, `${g.group} header`);
    assert.ok(g.rows.length > 0, `${g.group} has rows`);
    const firsts = g.rows.filter((r) => r.codes.length).map((r) => r.codes[0]);
    const sorted = [...firsts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(firsts, sorted, `${g.group} alphabetical`);
    for (const r of g.rows) assert.equal(r.cells.length, 5, `${g.group}: 5 cells in ${r.line}`);
  }
});

test("#152 both directions: every source code is documented and every doc code still exists", () => {
  const src = sourceCodes();
  assert.ok(src.size >= 40, `scanned ${src.size} codes`);
  const { missingInDoc, missingInSource } = compare(src, docCodes(), sourceText());
  assert.deepEqual(missingInDoc, [], "codes raised in source but missing from docs/error-codes.md");
  assert.deepEqual(missingInSource, [], "codes in docs/error-codes.md that no longer exist in source");
});

test("#152 tamper: dropping a doc row OR adding an unknown doc code is caught", () => {
  const src = sourceCodes();
  const text = sourceText();
  const dropped = parseDoc(md.replace(/^\| `SLUG_CLASH` \| 409 .*\n/m, ""));
  assert.deepEqual(compare(src, docCodes(dropped), text).missingInDoc, [], "SLUG_CLASH still in CLI group");
  const dropBoth = parseDoc(md.replace(/^\| `SLUG_CLASH` .*\n/gm, ""));
  assert.deepEqual(compare(src, docCodes(dropBoth), text).missingInDoc, ["SLUG_CLASH"]);
  const extra = parseDoc(md.replace("### 3. Asset\n", "### 3. Asset\n").replace(
    "| `ALT_TEXT_TOO_LONG` |",
    "| `GHOST_CODE` | 400 | nowhere | gone | — |\n| `ALT_TEXT_TOO_LONG` |",
  ));
  assert.deepEqual(compare(src, docCodes(extra), text).missingInSource, ["GHOST_CODE"]);
  const src2 = new Map(src).set("NEW_UNDOCUMENTED_CODE", new Set(["apps/x.js"]));
  assert.deepEqual(compare(src2, docCodes(), text).missingInDoc, ["NEW_UNDOCUMENTED_CODE"]);
  const ghostV = parseDoc(md.replace("| `V8` |", "| `V9` / `V8` |"));
  assert.deepEqual(compare(src, docCodes(ghostV), text).missingInSource, ["V9"]);
});

test("#152 D2 placement: required codes sit in their D2 group", () => {
  const where = Object.fromEntries(groups.map((g) => [g.group, new Set(g.rows.flatMap((r) => r.codes))]));
  const need = {
    Generic: ["NOT_FOUND", "VALIDATION", "INVALID_JSON", "PAYLOAD_TOO_LARGE", "INTERNAL", "OPENAPI_PARSE", "KRITA_DOWN"],
    "Scene / V-codes": ["V1", "V4", "V4a", "V5", "V6b", "V8", "SCENE_CAMERAS_MAX", "SCENE_RESOLVE"],
    Asset: [
      "MULTI_ARMATURE", "ASSET_IN_USE", "SLUG_CLASH", "GLB_TOO_LARGE", "PATH_OUTSIDE_INBOX", "ALT_TEXT_TOO_LONG",
      "GLB_CORRUPT", "FILE_MISSING", "PATCH_FORBIDDEN_FIELD", "SCHEMA_VERSION_DECREMENT", "MONGO_REQUIRED",
      "HUMANOID_BONE_COUNT", "ARMATURE_COUNT",
    ],
    "Import warnings": ["PNG_ALPHA_PREMULT_SUSPECT", "IDLE_TPOSE_SUSPECT"],
    "CLI exits": [
      "E_BLENDER_BIN_MISSING", "E_BLENDER_BIN_UNSET", "E_BLENDER_VERSION", "E_GOLDEN_BLENDER_VERSION", "E_GOLDEN_DRIFT",
      "E_GOLDEN_FIXTURE", "E_GOLDEN_MALFORMED", "E_GOLDEN_PLACEHOLDER", "E_GOLDEN_UNSTABLE", "GLB_TOO_LARGE",
      "GLB_CORRUPT", "PATH_OUTSIDE_INBOX",
    ],
    "Test skips": ["SKIP_NO_BLENDER", "SKIP_NO_API", "SKIP_NO_UI_URL", "SKIP_NO_MONGO", "SKIP_NO_KRITA", "SKIP_PLATFORM"],
  };
  for (const [g, codes] of Object.entries(need)) for (const c of codes) assert.ok(where[g]?.has(c), `${c} in ${g}`);
});

test("#152 exits/statuses match source: GLB_CORRUPT 5, GLB_TOO_LARGE 4/413, golden 1/2/3, 409s, INTERNAL text", () => {
  const row = (g, c) => groups.find((x) => x.group === g).rows.find((r) => r.codes[0] === c).cells[1];
  assert.equal(row("CLI exits", "GLB_CORRUPT"), "exit 5");
  assert.equal(row("CLI exits", "GLB_TOO_LARGE"), "exit 4");
  assert.equal(row("CLI exits", "E_GOLDEN_DRIFT"), "exit 1");
  assert.equal(row("CLI exits", "E_GOLDEN_BLENDER_VERSION"), "exit 2");
  assert.equal(row("CLI exits", "E_GOLDEN_UNSTABLE"), "exit 3");
  assert.equal(row("CLI exits", "PATH_OUTSIDE_INBOX"), "exit 2");
  assert.equal(row("Asset", "GLB_TOO_LARGE"), "413");
  assert.equal(row("Asset", "SLUG_CLASH"), "409");
  assert.equal(row("Asset", "ASSET_IN_USE"), "409");
  assert.equal(row("Asset", "ALT_TEXT_TOO_LONG"), "400");
  assert.equal(row("Generic", "KRITA_DOWN"), "503");
  const reg = fs.readFileSync(path.join(ROOT, "apps/blender-pipeline/register_asset.mjs"), "utf8");
  assert.match(reg, /GLB_CORRUPT[\s\S]{0,400}process\.exit\(5\)/);
  assert.match(reg, /GLB_TOO_LARGE[\s\S]{0,200}process\.exit\(4\)/);
  // every sendError(res, N, "CODE") status agrees with the doc row
  const srv = fs.readFileSync(path.join(ROOT, "apps/world-builder/server/src/index.js"), "utf8");
  for (const m of srv.matchAll(/sendError\(\s*res,\s*(\d+),\s*"([A-Z_]+)"/g)) {
    const r = groups.flatMap((g) => g.rows).find((x) => x.codes[0] === m[2] && /^\d{3}$/.test(x.cells[1]));
    assert.ok(r, `${m[2]} has an HTTP row`);
    assert.equal(r.cells[1], m[1], `${m[2]} status`);
  }
  assert.match(md, /"internal error"/);
  assert.ok(!/(^|[\s'"(])\/(home|workspace|tmp|etc|usr|var)\//m.test(md), "no absolute paths in the doc");
});
