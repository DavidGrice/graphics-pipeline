# S3-F D1: author and viewer surfaces (activity panel, clip requires, QR share, featured strip, .kra echo, bridge badge)

**Pack:** `enhancement/s3f-growth-t6` (recreated from `f6a637d`), bound to R1 `docs/sprint3f-brief.md` · **Seed:** `/workspace/sprint3f-seed.md` · **Leader rulings:** (a) jsonl log, 10k-line cap with rotation · (b) register-time 400 · (c) PUT `/api/featured` is rate-limited (existing mutation limiter).
**Locks:** `assetSchemaVersion` stays 3 (additive optional fields) · dock layout rules from S3-C #82 still hold (in-flow flex column, rows wrap, no overlap at 390×844, 1280×800, 1920) · hit targets ≥ 24px · state is never colour-only · `prefers-reduced-motion` honoured.

## 1. #128 Activity panel (UI over E1 route)
- Collapsible "Activity" panel in the side column, below Assets. Under 600px it sits below the canvas with the other panels (S3-E rule).
- Rows newest-first: relative time (`title` = ISO `at`), kind verb ("Registered", "Deleted", "Imported", "Saved scene"), then the slug as a link to the asset or scene. Deleted targets render muted, no link (same tombstone style as S3-E).
- Loads `GET /api/activity?limit=20` (`{items, total}`); "Show more" asks for `limit=100` once. Kinds: `asset.register`, `asset.patch`, `asset.delete`, `scene.save`, `scene.purge`, `pack.import`. Empty state: "No activity yet." Errors use the S3-D boundary banner with the `code`.
- Refreshes after any local mutation succeeds; no polling.

## 2. #11 Clip requires (author picker)
- Data is the asset-level map `clipRequires: Record<clip, clip[]>` (R1), not a per-clip field. The clip editor's optional "Requires" multi-select (1–8, never itself) edits that clip's entry in the map.
- Picker rows for clips with requires show a small "needs: a, b" caption.
- Register errors map inline: `CLIP_REQUIRES_MISSING` highlights the clip and lists `missing`; `CLIP_REQUIRES_CYCLE` highlights every clip in `cycle` with "Circular requirement: a → b → a". Save stays enabled so the user can fix and retry.

## 3. #85 QR share
- "Share" button on asset and scene pages opens a small popover: QR (drawn client-side to `<canvas>`, ≥ 160px, quiet zone kept), the URL as selectable text, and "Copy link".
- Base is `PUBLIC_BASE_URL` when set, else `location.origin`. When the host is loopback (`localhost`, `127.0.0.1`, `::1`) show the hint "This link only works on this device."
- QR canvas has `role="img"` and `aria-label="QR code for <url>"`. No network request when opening (AC: network panel shows zero requests).

## 4. #140 Featured strip
- Viewer gets a "Featured" strip above Transport in the dock (row order: Author, Blend/Speed, View, **Featured**, Transport). Hidden when the list is empty.
- Prev / next buttons (24px+), current title, "n / N". Left/right arrow keys work when the strip has focus. Auto-advance every 8s only when `prefers-reduced-motion` is not set; it pauses on hover or focus. Stale ids from GET are simply not shown.
- Editing: an "Edit featured" dialog with a reorderable list (up/down buttons, not drag-only), add from scenes, remove. Save is PUT `/api/featured`; `FEATURED_INVALID` and `RATE_LIMITED` show inline.

## 5. #47 Krita source echo
- Asset panel Import section shows "Source: `name.kra`" when `importMeta.sourceKra` is present. Basename only; nothing shown when absent.

## 6. #52 Bridge badge
- Health badge text is "Krita: ok", "Krita: unauthorized", "Krita: down", "Krita: mock" or "Krita: skipped", from `bridge.status`, with `bridge.mode` in `title`. Icon + text, never colour alone. `unauthorized` uses the warning style, `down` the error style.

## AC hooks
- `data-testid`: `activity-panel`, `activity-row`, `clip-requires`, `share-qr`, `share-hint-loopback`, `featured-strip`, `featured-edit`, `kra-source`, `bridge-badge`.
- Layout: `elementFromPoint` check from S3-C still passes with the Featured row present at all three viewports.
