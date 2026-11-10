#!/usr/bin/env node
/**
 * S3-H CO-2 — seed N billboard fixtures into WORLD_API for the populated-store UI pass.
 * Default N=40. Prints one id per line; exits 1 if any POST fails.
 *
 *   WORLD_API=http://127.0.0.1:8788 node scripts/seed-ui-populated.mjs [N]
 */
import { billboardBody, runId } from "../tests/helpers/s3d-synth.mjs";

const API = process.env.WORLD_API || "http://127.0.0.1:8788";
const N = Math.max(1, Number(process.argv[2] || 40) || 40);
const json = { "Content-Type": "application/json" };
// Older createdAt so newest-first pickers (Replace cap 30) still surface just-registered fixtures.
const iso = (i) => new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString();

const ids = [];
for (let i = 0; i < N; i++) {
  const id = runId(`seed-pop-${i}`);
  const body = { ...billboardBody(id, `seed-pop-${i}-${process.pid}`), createdAt: iso(i), updatedAt: iso(i) };
  const r = await fetch(`${API}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(body) });
  if (r.status !== 201) {
    console.error(`seed-ui-populated: POST ${i} → ${r.status}`);
    process.exit(1);
  }
  ids.push(id);
  console.log(id);
}
console.error(`seed-ui-populated: ${ids.length} ok on ${API}`);
