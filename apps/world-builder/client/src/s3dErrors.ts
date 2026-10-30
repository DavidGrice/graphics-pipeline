/**
 * S3-D #89 — pure helpers for the error card (no React; node-testable via ts.transpileModule).
 * D1 §1 layout · R1 §1 fields (assetId, failing URL + HTTP status or loader error, last probe).
 */

export const PROBE_DUMP_MAX_BYTES = 20 * 1024;

export type LoadErrorInfo = {
  name: string;
  message: string;
  status: number | null;
  url: string | null;
  code: string | null;
};

type ProbeSource = {
  id?: string;
  slug?: string;
  stage?: string;
  clips?: string[];
  clipDurations?: Record<string, number>;
  rig?: unknown;
  formats?: unknown;
  importMeta?: { warnings?: unknown[] } | null;
} | null | undefined;

/** Normalise anything thrown by GLTFLoader / fetch / React into card fields. */
export function describeLoadError(err: unknown, fallbackUrl: string | null = null): LoadErrorInfo {
  const e = (err ?? {}) as {
    name?: unknown;
    message?: unknown;
    response?: { status?: unknown; url?: unknown };
    status?: unknown;
    code?: unknown;
    url?: unknown;
  };
  const message = typeof e.message === "string" ? e.message : String(err);
  let status: number | null = null;
  if (typeof e.response?.status === "number") status = e.response.status;
  else if (typeof e.status === "number") status = e.status;
  else {
    // three FileLoader: `fetch for "<url>" responded with 404: Not Found`
    const m = message.match(/responded with (\d{3})/);
    if (m) status = Number(m[1]);
  }
  let url: string | null = null;
  if (typeof e.response?.url === "string" && e.response.url) url = e.response.url;
  else if (typeof e.url === "string") url = e.url;
  else {
    const m = message.match(/fetch for "([^"]+)"/);
    url = m ? m[1] : fallbackUrl;
  }
  const code = typeof e.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(e.code) ? e.code : null;
  const name = typeof e.name === "string" && e.name ? e.name : "Error";
  return { name, message, status, url, code };
}

/** D1 rev2 line: "<rel url> · HTTP 404 · FILE_MISSING" or "<rel url> · Exception: TypeError". */
export function statusLine(info: Pick<LoadErrorInfo, "status" | "name" | "code"> & { url?: string | null }): string {
  const parts: string[] = [];
  const rel = relativeUrl(info.url ?? null);
  if (rel) parts.push(rel);
  parts.push(info.status != null ? `HTTP ${info.status}` : `Exception: ${info.name}`);
  if (info.code) parts.push(info.code);
  return parts.join(" · ");
}

/** Read-only probe summary from the asset JSON (D1 rev2: clips, rig, clipDurations, importMeta.warnings). */
export function probeDump(asset: ProbeSource): Record<string, unknown> | null {
  if (!asset) return null;
  return {
    clips: asset.clips ?? [],
    rig: asset.rig ?? null,
    clipDurations: asset.clipDurations ?? {},
    warnings: asset.importMeta?.warnings ?? [],
  };
}

/** Repo-relative display form of a failing URL (origin stripped; never an absolute fs path). */
export function relativeUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)?$/i);
  return m ? m[1] || "/" : url;
}

/** Pretty JSON capped at `max` UTF-8 bytes; `truncated` tells the card to say so. */
export function capJson(value: unknown, max = PROBE_DUMP_MAX_BYTES): { text: string; truncated: boolean } {
  const text = JSON.stringify(value ?? null, null, 2) ?? "null";
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max) return { text, truncated: false };
  const cut = new TextDecoder().decode(bytes.slice(0, max)).replace(/\uFFFD+$/, "");
  return { text: `${cut}\n… (truncated)`, truncated: true };
}

/** JSON for Copy details (D1 rev2): {assetId, url, status, code, probe}. */
export function errorDetailsJson(
  assetId: string | null,
  info: LoadErrorInfo,
  probe: Record<string, unknown> | null,
): string {
  return JSON.stringify(
    { assetId, url: relativeUrl(info.url), status: info.status, code: info.code, probe },
    null,
    2,
  );
}

export type PreflightResult = { ok: true } | { ok: false; info: LoadErrorInfo };

/**
 * S3-D #89 — preflight a GLB URL before handing it to useGLTF, so a missing or non-GLB file
 * renders the error card directly instead of throwing through React (no uncaught pageerror).
 * Reads only the 12-byte GLB header (Range request; reader cancelled after the first chunk).
 * Loader throws that slip past this (e.g. a corrupt body after a valid header) still land in
 * the viewer ErrorBoundary.
 */
export async function preflightGlb(url: string, fetchImpl: typeof fetch = fetch): Promise<PreflightResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Range: "bytes=0-11" } });
  } catch (err) {
    return { ok: false, info: { ...describeLoadError(err, url), url } };
  }
  if (!res.ok) {
    let code: string | null = null;
    let message = `fetch for "${url}" responded with ${res.status}`;
    try {
      const j = await res.json();
      if (j && typeof j.code === "string") code = j.code;
      if (j && typeof j.error === "string") message = j.error;
    } catch {
      /* non-JSON body */
    }
    return { ok: false, info: { name: "HttpError", message, status: res.status, url, code } };
  }
  let head = new Uint8Array(0);
  try {
    const reader = res.body?.getReader();
    while (reader && head.length < 12) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const next = new Uint8Array(head.length + value.length);
      next.set(head);
      next.set(value, head.length);
      head = next;
    }
    await reader?.cancel().catch(() => {});
  } catch {
    /* treat as unreadable below */
  }
  const magic = String.fromCharCode(...head.slice(0, 4));
  if (head.length < 12 || magic !== "glTF") {
    return {
      ok: false,
      info: {
        name: "GlbHeaderError",
        message: `not a GLB (magic ${JSON.stringify(magic)}, ${head.length} header bytes)`,
        status: null,
        url,
        code: "GLB_CORRUPT",
      },
    };
  }
  return { ok: true };
}
