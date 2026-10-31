#!/usr/bin/env node
/**
 * S3-G E3 #150 — parse every fenced ```mermaid block in tracked docs/**.md offline with the pinned
 * `mermaid` + `jsdom` devDependencies (mermaid.parse; no DOM, no render, no images). Needs `npm ci` (CO-0).
 *   exit 0  all blocks parse — prints `OK mermaid (<n> blocks)`
 *   exit 1  `mermaid: <file>:<line>: <message>` per bad block, then `ERROR LINT_FAILED: mermaid`
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Extract `{ line, code }` for each ```mermaid fence (line = 1-based line of the opening fence). */
export function extractMermaid(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```mermaid\s*$/.test(lines[i])) {
      const start = i + 1;
      const body = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      out.push({ line: start, code: body.join("\n") });
    }
  }
  return out;
}

export async function lintMermaidFiles(cwd, files) {
  // mermaid sanitizes labels with DOMPurify, which needs a window: give it an offline jsdom one
  if (!globalThis.window) {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
  }
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false });
  const problems = [];
  let blocks = 0;
  for (const rel of files) {
    for (const b of extractMermaid(fs.readFileSync(path.join(cwd, rel), "utf8"))) {
      blocks++;
      try {
        await mermaid.parse(b.code);
      } catch (e) {
        problems.push(`${rel}:${b.line}: ${String(e?.message || e).split("\n")[0]}`);
      }
    }
  }
  return { blocks, problems };
}

export function docsMarkdown(cwd) {
  const ls = spawnSync("git", ["ls-files", "-z", "--", "docs/*.md", "docs/**/*.md"], { cwd, encoding: "utf8" });
  if (ls.status === 0) return [...new Set(ls.stdout.split("\0").filter(Boolean))].sort();
  const dir = path.join(cwd, "docs");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`).sort() : [];
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const cwd = process.cwd();
  const files = process.argv.length > 2 ? process.argv.slice(2) : docsMarkdown(cwd);
  const { blocks, problems } = await lintMermaidFiles(cwd, files);
  if (problems.length) {
    for (const p of problems) console.error(`mermaid: ${p}`);
    console.error("ERROR LINT_FAILED: mermaid");
    process.exit(1);
  }
  console.log(`OK mermaid (${blocks} blocks)`);
}
