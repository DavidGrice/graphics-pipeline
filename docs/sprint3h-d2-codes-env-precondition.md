# Sprint 3-H — D2: codes, env and design answers

**Status:** Bound to R1 `docs/sprint3h-brief.md`. Pack `enhancement/s3h-growth-t8`.

## Codes
| Code | Status | Notes |
|---|---|---|
| `PRECONDITION_FAILED` | **new** (412) | #69. Body `{code, error, current}` where `current` is the current ETag string. Nothing written. Listed in `docs/error-codes.md` and the S3-H section of `docs/contract-changelog.md`. |
| `VALIDATION` | reuse | Malformed `If-Match` → `{field:"If-Match"}`. Bookmark cap / bad name → `{field:"view.bookmarks"}` (or existing `SCENE_CAMERAS_MAX` field if that limit already applies — Engineer confirms which; D1 uses `view.bookmarks` unless R1 says otherwise). |
| `CONFIG_INVALID` | reuse | Bad `PROBE_WORKERS` / `PROBE_TIMEOUT_MS` at boot; backup/restore refuse (non-empty without `--force`, hash mismatch, path escape) exit 2. |
| `GLB_CORRUPT` | reuse | Worker crash path (#133). |
| `INTERNAL` | reuse | Probe timeout (#133); message stays `"internal error"`. |
| `NOT_FOUND` | reuse | 404 before 412 on #69. |

Still exactly 6 `SKIP_*`. Schema stays **3**. OpenAPI → **0.8.0** (#69 headers + 412 on existing routes; no new routes).

## New env (all in `.env.example`, `NON_CODES`, contract-changelog)
| Var | Range / default | Notes |
|---|---|---|
| `PROBE_WORKERS` | int 1..8, default **2** | Bad → `CONFIG_INVALID` at startup. |
| `PROBE_TIMEOUT_MS` | int ≥1000, default **30000** | Timeout → 500 `INTERNAL`; worker replaced. |
| `FUZZ_SEED` | int, unset = random locally / fixed in CI | Printed on fuzz failure as `FUZZ_SEED=<n>`. |
| `FUZZ_RUNS` | int, default **200** per route | Overrides run count. |

`fast-check` is an **exact-pinned** `devDependency` (ruling c).

## Design answers (R1 §16)

### #69 412 dialog copy
- Title: **This scene changed elsewhere**
- Body: **Someone else saved while you were editing. Reload to take their version, or Cancel to keep editing (Save will fail again until you reload).**
- Primary: **Reload** (`data-testid: etag-reload`) — replaces the draft and clears the undo stack (S3-G E2 dev-5).
- Secondary: **Cancel** (`data-testid: etag-cancel`).
- Container: `data-testid: etag-reload-prompt`. NIT-F-1 if rendered as a popover; otherwise a centred modal is fine (modal is not a floating anchor popover).

### #32 bookmark UI + NIT-F-1
- Trigger: "Cameras" in the viewer chrome.
- Popover follows NIT-F-1 (below → flip above → clamp → bottom sheet under 600px).
- List rows: name, Restore, Rename, Delete. Footer: "Save current view". Empty: "No saved cameras yet". At cap: Save disabled, hint "8 of 8 cameras".
- Restoring is not an undo step; add/remove dirties via the view compare.

### #30 grid control placement
- Inline in the transform toolbar, immediately after the translate/rotate/scale mode buttons (S3-C #82 dock). Under 600px the pair wraps to the next toolbar row. No popover.

### #117 panel layout at 390px
- "What changed" sits **below** the stacked compare viewports and **above** the existing #84 diff table, full width.
- Collapsible `<details open>` with summary "What changed"; body is the bullet list (or "No differences").
- `data-testid: compare-probe-diff`. No extra horizontal scroll; no second popover.

## Tip order (from R1)
Tip1 = CO-1 + CO-2. #69 server before the client Save change.
