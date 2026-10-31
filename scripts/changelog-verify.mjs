#!/usr/bin/env node
/**
 * S3-G CO-2 — contract-changelog provenance (#148): `npm run changelog:verify`.
 *
 * For each code row in docs/error-codes.md, find the first commit that added it:
 *   git log --reverse -S'<CODE>' -- docs/error-codes.md
 * When that commit is the one that created error-codes.md (S3-D #152, the doc came later), use the
 * first source commit instead (apps/ packages/ scripts/ tests/reporters, whole-word -G match).
 * The commit maps to a sprint by its subject tag (`s3f`, `s3d-e1`, `S3-E`) or, failing that, the
 * newest docs/sprintXY-brief.md in its tree; sprints before the first section fold into it.
 * Exit 1 `LINT_FAILED` with one `{code, docSprint, gitSprint}` line per mismatch; shallow clone →
 * `SKIP_PLATFORM` exit 0. Options: --doc <path> (default docs/contract-changelog.md).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const git = (args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
const ERR_DOC = "docs/error-codes.md";
const SRC = ["apps", "packages", "scripts", "tests/reporters"];
const SRC_EXT = /\.(m?js|ts|tsx|py|sh)$/;

export const sprintKey = (s) => {
  const m = /^S(\d)-([A-Z])$/.exec(s);
  return m ? Number(m[1]) * 100 + (m[2].charCodeAt(0) - 64) : NaN;
};

/** Sprint named in a commit subject, e.g. `feat(s3d-e1)`, `docs(s3f)`, `S3-E E1` → "S3-D" / "S3-F" / "S3-E". */
export function sprintOfSubject(subject) {
  const m = /(?:^|[^a-z0-9])s([1-9])-?([a-h])(?![a-z0-9])/i.exec(subject);
  return m ? `S${m[1]}-${m[2].toUpperCase()}` : null;
}

/** Parse `## <sprint>` sections and their `- **Codes:**` lines. */
export function parseChangelog(text) {
  const sections = [];
  const codeSprint = new Map();
  let cur = null;
  for (const line of text.split("\n")) {
    const h = /^## (S\d-[A-Z])\b/.exec(line);
    if (h) {
      cur = h[1];
      sections.push(cur);
      continue;
    }
    if (cur && /^- \*\*Codes:\*\*/.test(line)) for (const [, c] of line.matchAll(/`([A-Za-z0-9_]+)`/g)) codeSprint.set(c, cur);
  }
  return { sections, codeSprint };
}

export function docCodes(text) {
  return [...new Set([...text.matchAll(/^\| `([A-Z][A-Za-z0-9_]*)`/gm)].map((m) => m[1]))];
}

/** Fold a git sprint onto the doc's sections: earlier than the first → first; else the latest section ≤ it. */
export function foldSprint(sprint, sections) {
  const k = sprintKey(sprint);
  let best = sections[0];
  for (const s of sections) if (sprintKey(s) <= k) best = s;
  return best;
}

function briefSprint(sha) {
  const r = git(["ls-tree", "--name-only", sha, "docs/"]);
  let best = null;
  for (const f of r.stdout.split("\n")) {
    const m = /^docs\/sprint(\d)([a-z])-brief\.md$/.exec(f);
    if (m) {
      const s = `S${m[1]}-${m[2].toUpperCase()}`;
      if (!best || sprintKey(s) > sprintKey(best)) best = s;
    }
  }
  return best;
}

function commitSprint(sha) {
  const subj = git(["log", "-1", "--format=%s", sha]).stdout.trim();
  return sprintOfSubject(subj) || briefSprint(sha);
}

function firstCommit(code) {
  const r = git(["log", "--reverse", "--format=%H", `-S${code}`, "--", ERR_DOC]);
  const shas = r.stdout.split("\n").filter(Boolean);
  const docBirth = git(["log", "--reverse", "--diff-filter=A", "--format=%H", "--", ERR_DOC]).stdout.split("\n")[0];
  if (shas[0] && shas[0] !== docBirth) return shas[0];
  const esc = code.replace(/[^A-Za-z0-9_]/g, "");
  const s = git(["log", "--reverse", "--format=%H", "--name-only", `-G(^|[^A-Za-z0-9_])${esc}([^A-Za-z0-9_]|$)`, "--", ...SRC]);
  // first commit whose touched files include a real source file (not artifacts like *.b64)
  let sha = null;
  for (const line of s.stdout.split("\n")) {
    if (/^[0-9a-f]{40}$/.test(line)) sha = line;
    else if (sha && SRC_EXT.test(line)) return sha;
  }
  return shas[0] || null;
}

export function verify({ doc = "docs/contract-changelog.md" } = {}) {
  const { sections, codeSprint } = parseChangelog(fs.readFileSync(path.resolve(ROOT, doc), "utf8"));
  const codes = docCodes(fs.readFileSync(path.join(ROOT, ERR_DOC), "utf8"));
  const bad = [];
  for (const code of codes) {
    const sha = firstCommit(code);
    const raw = sha ? commitSprint(sha) : null;
    // no subject tag and no brief in the tree (pre-S2 history) → the baseline section
    const gitSprint = sha ? (raw ? foldSprint(raw, sections) : sections[0]) : null;
    const docSprint = codeSprint.get(code) ?? null;
    if (gitSprint !== docSprint) bad.push({ code, docSprint, gitSprint, commit: sha?.slice(0, 7) ?? null });
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (git(["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true") {
    console.log("SKIP_PLATFORM: shallow clone — changelog:verify needs full history (fetch-depth: 0)");
    process.exit(0);
  }
  const i = process.argv.indexOf("--doc");
  const bad = verify(i > 0 ? { doc: process.argv[i + 1] } : {});
  if (bad.length) {
    for (const b of bad) console.error(JSON.stringify(b));
    console.error(`LINT_FAILED: changelog:verify — ${bad.length} code(s) in the wrong sprint section`);
    process.exit(1);
  }
  console.log("OK changelog:verify");
}
