/**
 * S3-H E2 (Leader) — browser console/pageerror watcher with a NARROW allowlist.
 * Only the deprecation warnings named in apps/world-builder/client/src/s3hE2.ts
 * (THREE.Clock, PCFSoftShadowMap, three-mesh-bvh) are ignored; everything else is collected.
 */
import { loadClientTs } from "./s3d-synth.mjs";

let mod;
async function allow() {
  mod ??= await loadClientTs("apps/world-builder/client/src/s3hE2.ts");
  return mod.isAllowedConsoleNoise;
}

/** Attach to a Playwright page; returns { problems, ignored } arrays filled as the page runs. */
export async function watchConsole(page) {
  const isAllowed = await allow();
  const problems = [];
  const ignored = [];
  page.on("pageerror", (e) => {
    const s = String(e);
    (isAllowed(s) ? ignored : problems).push(s);
  });
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const s = m.text();
    (isAllowed(s) ? ignored : problems).push(`${m.type()}: ${s}`);
  });
  return { problems, ignored };
}
