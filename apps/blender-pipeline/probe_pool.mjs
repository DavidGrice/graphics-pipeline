/**
 * S3-H #133 — worker_threads pool for GLB probing.
 * PROBE_WORKERS int 1..8 (default 2); PROBE_TIMEOUT_MS int ≥1000 (default 30000).
 * Bad env → CONFIG_INVALID (fail-closed). Crash → GLB_CORRUPT; timeout → INTERNAL.
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { GLB_CORRUPT } from "./probe_glb.mjs";

const WORKER_URL = path.join(path.dirname(fileURLToPath(import.meta.url)), "probe_worker.mjs");
export const PROBE_WORKERS_DEFAULT = 2;
export const PROBE_TIMEOUT_MS_DEFAULT = 30000;
export const INTERNAL = "INTERNAL";

function configInvalid(variable, rule) {
  const err = new Error(`CONFIG_INVALID: ${variable} ${rule}`);
  err.code = "CONFIG_INVALID";
  err.variable = variable;
  return err;
}

export function parseProbeWorkers(raw) {
  if (raw == null || String(raw).trim() === "") return PROBE_WORKERS_DEFAULT;
  const t = String(raw).trim();
  if (!/^[0-9]+$/.test(t) || !Number.isSafeInteger(Number(t))) {
    throw configInvalid("PROBE_WORKERS", "must be an integer 1..8");
  }
  const n = Number(t);
  if (n < 1 || n > 8) throw configInvalid("PROBE_WORKERS", "must be an integer 1..8");
  return n;
}

export function parseProbeTimeoutMs(raw) {
  if (raw == null || String(raw).trim() === "") return PROBE_TIMEOUT_MS_DEFAULT;
  const t = String(raw).trim();
  if (!/^[0-9]+$/.test(t) || !Number.isSafeInteger(Number(t))) {
    throw configInvalid("PROBE_TIMEOUT_MS", "must be an integer >= 1000");
  }
  const n = Number(t);
  if (n < 1000) throw configInvalid("PROBE_TIMEOUT_MS", "must be an integer >= 1000");
  return n;
}

/**
 * @param {{ workers?: number, timeoutMs?: number, workerUrl?: string }} [opts]
 */
export function createProbePool(opts = {}) {
  const size = opts.workers ?? PROBE_WORKERS_DEFAULT;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS_DEFAULT;
  const workerUrl = opts.workerUrl || WORKER_URL;
  /** @type {{ worker: Worker, busy: boolean }[]} */
  const slots = [];
  /** @type {{ filePath: string, resolve: Function, reject: Function, id: number }[]} */
  const queue = [];
  let nextId = 1;
  let closed = false;

  function spawn() {
    const worker = new Worker(workerUrl);
    worker.unref(); // CLI/tests: idle workers must not pin the event loop
    const slot = { worker, busy: false };
    worker.on("message", (msg) => onMessage(slot, msg));
    worker.on("error", (err) => onCrash(slot, err));
    worker.on("exit", (code) => {
      if (closed) return;
      if (code !== 0) onCrash(slot, new Error(`worker exited ${code}`));
    });
    slots.push(slot);
    return slot;
  }

  for (let i = 0; i < size; i++) spawn();

  function failJob(job, err) {
    job.reject(err);
  }

  function onCrash(slot, cause) {
    const job = slot._job;
    slot._job = null;
    slot.busy = false;
    // Replace the dead worker
    try {
      slot.worker.terminate();
    } catch {
      /* already dead */
    }
    const idx = slots.indexOf(slot);
    if (idx >= 0) slots.splice(idx, 1);
    if (!closed) spawn();
    if (job) {
      const err = new Error(`${GLB_CORRUPT}: worker crashed`);
      err.code = GLB_CORRUPT;
      err.reason = "worker crashed";
      err.cause = cause;
      failJob(job, err);
    }
    pump();
  }

  function onMessage(slot, msg) {
    const job = slot._job;
    slot._job = null;
    slot.busy = false;
    if (job?.timer) clearTimeout(job.timer);
    if (!job) {
      pump();
      return;
    }
    if (msg?.ok) job.resolve(msg.probed);
    else {
      const err = new Error(msg?.message || `${GLB_CORRUPT}: probe failed`);
      err.code = msg?.code || GLB_CORRUPT;
      if (msg?.reason) err.reason = msg.reason;
      failJob(job, err);
    }
    pump();
  }

  function pump() {
    while (queue.length) {
      const free = slots.find((s) => !s.busy);
      if (!free) return;
      const job = queue.shift();
      free.busy = true;
      free._job = job;
      job.timer = setTimeout(() => {
        if (free._job !== job) return;
        free._job = null;
        free.busy = false;
        try {
          free.worker.terminate();
        } catch {
          /* ignore */
        }
        const idx = slots.indexOf(free);
        if (idx >= 0) slots.splice(idx, 1);
        if (!closed) spawn();
        const err = new Error("INTERNAL: probe timed out");
        err.code = INTERNAL;
        failJob(job, err);
        pump();
      }, timeoutMs);
      free.worker.postMessage({ id: job.id, filePath: job.filePath });
    }
  }

  function probe(filePath) {
    if (closed) return Promise.reject(new Error("probe pool closed"));
    return new Promise((resolve, reject) => {
      queue.push({ id: nextId++, filePath, resolve, reject, timer: null });
      pump();
    });
  }

  async function close() {
    closed = true;
    queue.splice(0).forEach((j) => j.reject(new Error("probe pool closed")));
    await Promise.all(slots.map((s) => s.worker.terminate().catch(() => {})));
    slots.length = 0;
  }

  return { probe, close, get size() { return slots.length; }, timeoutMs };
}

/** Lazy process-wide pool from env (validated once). */
let shared;
export function sharedProbePool(env = process.env) {
  if (!shared) {
    shared = createProbePool({
      workers: parseProbeWorkers(env.PROBE_WORKERS),
      timeoutMs: parseProbeTimeoutMs(env.PROBE_TIMEOUT_MS),
    });
  }
  return shared;
}

export function resetSharedProbePoolForTests() {
  const p = shared;
  shared = undefined;
  return p?.close?.();
}
