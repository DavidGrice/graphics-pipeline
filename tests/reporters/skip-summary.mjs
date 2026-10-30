/**
 * S3-D #104 — node:test reporter that prints a skip-reason table (code · count · tests) at the
 * end of `npm run test:s1` and fails the run (exit 1) when any skip reason does not start with a
 * known SKIP_* code. Used next to the TAP reporter:
 *   node --test --test-reporter=tap --test-reporter-destination=stdout \
 *        --test-reporter=./tests/reporters/skip-summary.mjs --test-reporter-destination=stdout …
 */
export const SKIP_CODES = [
  "SKIP_NO_BLENDER",
  "SKIP_NO_API",
  "SKIP_NO_UI_URL",
  "SKIP_NO_MONGO",
  "SKIP_NO_KRITA",
  "SKIP_PLATFORM",
];

/** Table bucket for a skip with no code, and the run-failing marker line. */
export const UNCODED = "UNCODED";
export const SKIP_CODE_MISSING = "SKIP_CODE_MISSING";

const CODE_RE = /^(SKIP_[A-Z0-9_]+):/;

/** Classify one skip reason → { code, known }. `true`/empty reasons are unknown. */
export function classifySkip(reason) {
  const m = typeof reason === "string" ? CODE_RE.exec(reason.trim()) : null;
  if (!m) return { code: UNCODED, known: false };
  return { code: m[1], known: SKIP_CODES.includes(m[1]) };
}

/** Pure: skips [{name, reason}] → { rows: [{code, count, tests}], bad: [{name, reason}] }. */
export function summarizeSkips(skips) {
  const by = new Map();
  const bad = [];
  for (const s of skips) {
    const { code, known } = classifySkip(s.reason);
    if (!known) bad.push(s);
    if (!by.has(code)) by.set(code, []);
    by.get(code).push(s.name);
  }
  const rows = [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, tests]) => ({ code, count: tests.length, tests }));
  return { rows, bad };
}

export function renderTable({ rows, bad }) {
  const out = ["", "# skip summary (#104): code · count · tests"];
  if (rows.length === 0) out.push("# (no skips)");
  for (const r of rows) out.push(`# ${r.code} · ${r.count} · ${r.tests.join(" | ")}`);
  if (bad.length) {
    out.push(`# ${SKIP_CODE_MISSING}: ${bad.length} skip(s) without a known code (${SKIP_CODES.join(", ")}):`);
    for (const b of bad) out.push(`#   ${b.name} — ${String(b.reason)}`);
  }
  return out.join("\n") + "\n";
}

export default async function* skipSummary(source) {
  const skips = [];
  for await (const ev of source) {
    if ((ev.type === "test:pass" || ev.type === "test:fail") && ev.data?.skip !== undefined && ev.data.skip !== false) {
      skips.push({ name: ev.data.name, reason: ev.data.skip });
    }
  }
  const summary = summarizeSkips(skips);
  yield renderTable(summary);
  if (summary.bad.length) process.exitCode = 1;
}
