#!/usr/bin/env node
/**
 * S3-E E3 #122 — changelog from SHAs, used as the PR body. Local git only (no network).
 *
 *   node scripts/changelog.mjs <from>..<to>     (or: <from> [to=HEAD])
 *
 * Commits in (from, to], oldest first, no merges, grouped by the lane tag in the subject:
 * E1, E2, E3 (a standalone `E1`/`E2`/`E3` token, optional suffix `e1b` — S3-G CO-1), then docs, test (subject type prefix), other.
 * One line per commit: `- <short sha> <subject>`. Empty groups are omitted.
 *   exit 2  ERROR CHANGELOG_RANGE: a ref is missing, not a commit, or looks like an option.
 */
import { spawnSync } from "node:child_process";

const GROUPS = ["E1", "E2", "E3", "docs", "test", "other"];
const git = (args) => spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });

function fail(msg) {
  console.error(`ERROR CHANGELOG_RANGE: ${msg}`);
  process.exit(2);
}

/** S3-G CO-1: `E1`..`E3` with an optional one-letter suffix (`e1b`, `E2a`), any case; `-` is a left
 * boundary too (`s3f-e1b`). Never inside a word: `E10`, `E4`, `ae1`, `node22` don't match.
 * S3-G E3 nit: `-` is a right boundary too (`e1b-thing` → E1). */
export function laneOf(subject) {
  const lane = subject.match(/(?:^|[\s(\[:/-])(E[123])[a-z]?(?=$|[\s)\]:/,.-])/i);
  if (lane) return lane[1].toUpperCase();
  if (/^docs\b/i.test(subject)) return "docs";
  if (/^tests?\b/i.test(subject)) return "test";
  return "other";
}

function parseRange(argv) {
  if (argv.length === 1 && argv[0].includes("..")) {
    if (argv[0].includes("...")) fail("use <from>..<to> (three-dot ranges are not supported)");
    const [from, to] = argv[0].split("..");
    return [from, to || "HEAD"];
  }
  if (argv.length === 1 || argv.length === 2) return [argv[0], argv[1] || "HEAD"];
  fail("usage: changelog.mjs <from>..<to> | <from> [to]");
}

function verify(ref) {
  if (!ref || ref.startsWith("-") || /\s/.test(ref)) fail(`bad ref ${JSON.stringify(ref ?? "")}`);
  const r = git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  if (r.status !== 0) fail(`unknown commit ${JSON.stringify(ref)}`);
  return r.stdout.trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fromRef, toRef] = parseRange(process.argv.slice(2));
  const from = verify(fromRef);
  const to = verify(toRef);
  const log = git(["log", "--no-merges", "--reverse", "--format=%h%x09%s", `${from}..${to}`]);
  if (log.status !== 0) fail("git log failed for the range");
  const lines = log.stdout.split("\n").filter(Boolean);
  const grouped = Object.fromEntries(GROUPS.map((g) => [g, []]));
  for (const l of lines) {
    const tab = l.indexOf("\t");
    const sha = l.slice(0, tab);
    const subject = l.slice(tab + 1);
    grouped[laneOf(subject)].push(`- ${sha} ${subject}`);
  }
  const out = [`## Changelog ${from.slice(0, 7)}..${to.slice(0, 7)} (${lines.length} commit${lines.length === 1 ? "" : "s"})`, ""];
  if (!lines.length) out.push("_No commits in range._", "");
  for (const g of GROUPS) {
    if (!grouped[g].length) continue;
    out.push(`### ${g}`, ...grouped[g], "");
  }
  process.stdout.write(out.join("\n"));
}
