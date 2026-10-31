/**
 * S3-F #128 activity panel + #52 bridge badge helpers (D1 §1, §6). Pure functions, unit-tested.
 */
export type ActivityKind = "asset.register" | "asset.patch" | "asset.delete" | "scene.save" | "scene.purge" | "pack.import";
export type ActivityItem = { at: string; kind: ActivityKind | string; id?: string; slug?: string; removed?: number; kept?: number; reason?: string };

const VERBS: Record<string, string> = {
  "asset.register": "Registered",
  "asset.patch": "Edited",
  "asset.delete": "Deleted",
  "scene.save": "Saved scene",
  "scene.purge": "Purged scene",
  "pack.import": "Imported",
};

/** S3-G D2 — id-less system kinds: plain muted text, no link. null = an asset row. */
export function systemActivityLabel(it: ActivityItem): string | null {
  if (it.kind === "inbox.sweep") return `Swept inbox: ${Number.isFinite(Number(it.removed)) ? Number(it.removed) : 0} removed`;
  if (it.kind === "webhook.refused") return `Webhook refused (${typeof it.reason === "string" && it.reason ? it.reason.slice(0, 40) : "unknown"})`;
  if (it.kind === "webhook.failed") return "Webhook failed";
  // unknown kind without an id → raw kind text, never an error
  if (!it.id && !(it.kind in VERBS)) return String(it.kind ?? "unknown");
  return null;
}

export function activityVerb(kind: string): string {
  return VERBS[kind] ?? kind;
}

export type BridgeInfo = { mode?: string; status?: string; httpStatus?: number };
export type BadgeTone = "ok" | "warn" | "err" | "muted";

/** D1 §6 — text is the state (never colour alone); mode goes in the title. */
export function bridgeBadge(b: BridgeInfo | null | undefined): { text: string; tone: BadgeTone; icon: string; title: string } {
  const status = b?.status ?? "unknown";
  const tone: BadgeTone =
    status === "ok" ? "ok" : status === "unauthorized" ? "warn" : status === "down" ? "err" : "muted";
  const icon = status === "ok" ? "●" : status === "unauthorized" ? "⚠" : status === "down" ? "✖" : "○";
  const http = b?.httpStatus != null ? ` · HTTP ${b.httpStatus}` : "";
  return { text: `Krita: ${status}`, tone, icon, title: `bridge mode: ${b?.mode ?? "unknown"}${http}` };
}
