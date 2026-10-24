/**
 * Spawn a bash script with a reliable exit status on Linux and Windows (Git Bash).
 * spawnSync status is null when the executable is missing — surface that clearly.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const WIN_BASH_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

export function findBash() {
  if (process.platform !== "win32") {
    const r = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" });
    if (r.status === 0) return "bash";
    return null;
  }
  for (const c of WIN_BASH_CANDIDATES) {
    if (fs.existsSync(c)) return c;
  }
  const where = spawnSync("where.exe", ["bash"], { encoding: "utf8" });
  if (where.status === 0) {
    const line = (where.stdout || "").split(/\r?\n/).find((l) => l.trim());
    if (line && fs.existsSync(line.trim())) return line.trim();
  }
  return null;
}

/**
 * @param {string} scriptPath
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [opts]
 */
export function spawnBash(scriptPath, args, opts = {}) {
  const bash = findBash();
  if (!bash) {
    return {
      status: null,
      stdout: "",
      stderr: "bash not found (install Git Bash on Windows for pipeline.sh / run_mvp.sh tests)",
      error: new Error("bash not found"),
      bash: null,
    };
  }
  const r = spawnSync(bash, [scriptPath, ...args], {
    encoding: "utf8",
    ...opts,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return { ...r, bash };
}

/** Assert spawn produced an exit code (not null/spawn failure). */
export function assertExitCode(r, expected, label = "command") {
  if (r.status === null) {
    const err = r.error?.message || r.stderr || r.signal || "unknown";
    assert.fail(
      `${label}: expected exit ${expected}, got status=null (spawn failed: ${err}). ` +
        `On Windows install Git Bash or ensure bash is on PATH.`,
    );
  }
  assert.equal(r.status, expected, `${label}: exit code`);
}
