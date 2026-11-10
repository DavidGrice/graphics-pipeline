/**
 * S3-I E1 #143 — audit actor: every non-ops activity entry written now carries actor "local".
 * Ops kinds never do; older lines without it are read back unchanged. No new kinds.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApi, billboardBody, runId } from "./helpers/s3d-synth.mjs";
import { createActivityLog, activityEntry, opsEntry, ACTIVITY_KINDS, ACTIVITY_ACTOR } from "../apps/world-builder/server/src/activity.js";

const json = { "Content-Type": "application/json" };
let api;
before(async () => {
  api = await startApi();
});
after(async () => api && (await api.stop()));

const feed = async () => (await (await fetch(`${api.url}/api/activity?limit=100`)).json()).items;

test("#143 register, patch, scene save and delete each persist actor \"local\" and read back", async () => {
  const id = runId("i143-a");
  const slug = `i143-a-${process.pid}`;
  const r = await fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(billboardBody(id, slug)) });
  assert.equal(r.status, 201, await r.clone().text());
  const p = await fetch(`${api.url}/api/assets/${id}`, { method: "PATCH", headers: json, body: JSON.stringify({ name: "renamed" }) });
  assert.equal(p.status, 200, await p.clone().text());
  const sid = runId("i143-s");
  const scene = {
    ...billboardBody(sid, `i143-s-${process.pid}`),
    characterType: "unknown",
    stage: "scene",
    scene: { version: 1, rootId: "n0", nodes: [{ id: "n0", assetId: id, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }] },
  };
  const sr = await fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(scene) });
  assert.equal(sr.status, 201, await sr.clone().text());
  const d = await fetch(`${api.url}/api/assets/${sid}`, { method: "DELETE" });
  assert.ok(d.status === 200 || d.status === 204, `delete ${d.status}`);
  const items = (await feed()).filter((e) => e.id === id || e.id === sid);
  const kinds = new Set(items.map((e) => e.kind));
  for (const k of ["asset.register", "asset.patch", "scene.save", "asset.delete"]) assert.ok(kinds.has(k), `missing ${k}`);
  assert.ok(items.length >= 4);
  for (const e of items) assert.equal(e.actor, "local", `${e.kind} lacks actor`);
});

test("#143 pack.import (X-Activity-Kind) carries actor too", async () => {
  const id = runId("i143-p");
  const r = await fetch(`${api.url}/api/assets`, {
    method: "POST",
    headers: { ...json, "X-Activity-Kind": "pack.import" },
    body: JSON.stringify(billboardBody(id, `i143-p-${process.pid}`)),
  });
  assert.equal(r.status, 201, await r.clone().text());
  const e = (await feed()).find((x) => x.id === id);
  assert.equal(e.kind, "pack.import");
  assert.equal(e.actor, "local");
});

test("#143 no new kinds; actor value is the literal local; ops entries never get an actor", () => {
  assert.equal(ACTIVITY_ACTOR, "local");
  assert.ok(!ACTIVITY_KINDS.includes("asset.purge") && !ACTIVITY_KINDS.includes("scene.delete"));
  for (const k of ACTIVITY_KINDS) {
    if (k.startsWith("inbox.") || k.startsWith("webhook.")) {
      assert.equal(opsEntry(k, { removed: 1, kept: 2, reason: "redirect", actor: "local" })?.actor, undefined, `${k} must not carry actor`);
    } else {
      assert.equal(activityEntry(k, { id: "x", slug: "y" }).actor, "local", k);
    }
  }
});

test("#143 an older line without actor reads back without one; a junk actor is dropped; ops lines stay ops", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i143-"));
  try {
    const at = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
    fs.writeFileSync(
      path.join(dir, "activity.jsonl"),
      [
        { at: at(1), kind: "asset.register", id: "old-1", slug: "old" },
        { at: at(2), kind: "asset.patch", id: "new-1", actor: "local" },
        { at: at(3), kind: "asset.patch", id: "bad-1", actor: "/etc/passwd" },
        { at: at(4), kind: "inbox.sweep", removed: 1, kept: 2, actor: "local" },
      ]
        .map((o) => JSON.stringify(o))
        .join("\n") + "\n",
    );
    const log = createActivityLog({ dataRoot: dir, warn: () => {} });
    const { items } = await log.read(10);
    const by = Object.fromEntries(items.map((e) => [e.id ?? e.kind, e]));
    assert.equal(by["old-1"].actor, undefined);
    assert.equal(by["new-1"].actor, "local");
    assert.equal(by["bad-1"].actor, undefined);
    assert.equal(by["inbox.sweep"].actor, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
