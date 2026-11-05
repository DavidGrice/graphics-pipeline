# Sprint 3-H — D2: codes, env and design answers

**Status:** DRAFT bound to R1 `/workspace/sprint3h-brief.md`. Pack after S3-G merges: `enhancement/s3h-growth-t8`. Answers R1 §16.

## Codes
| Code | Status | Notes |
|---|---|---|
| `PRECONDITION_FAILED` | **new** (412) | #69. Body `{code, error, current}` where `current` is the current ETag string. Nothing written. Listed in `docs/error-codes.md` and the S3-H section of `docs/contract-changelog.md`. |
| `VALIDATION` | reuse | Malformed `If-Match` → `{field:"If-Match"}`. Bookmark cap / bad name → existing `SCENE_CAMERAS_MAX` / `VALIDATION` path on `scene.cameras` (E2 deviation; no `view.bookmarks`). |
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

### #32 bookmark UI (Leader ruling)
- Reuse S3-C `scene.cameras` + `SCENE_CAMERAS_MAX` = **16** (not `view.bookmarks` / cap 8). Existing error path; no new code.
- **E2:** select + save/rename/delete with D1 test ids.
- **E3:** NIT-F-1 Cameras popover; empty "No saved cameras yet"; at cap **"16 of 16 cameras"** (Save disabled).
- Restoring is not an undo step; add/remove/rename dirties via the view compare.
- Test ids: `camera-bookmarks`, `camera-bookmark-item`, `camera-bookmark-save`, `camera-bookmark-restore`, `camera-bookmark-delete`.

### #30 grid control placement
- Inline in the transform toolbar, immediately after the translate/rotate/scale mode buttons (S3-C #82 dock). Under 600px the pair wraps to the next toolbar row. No popover.

### #117 panel layout at 390px
- "What changed" sits **below** the stacked compare viewports and **above** the existing #84 diff table, full width.
- Collapsible `<details open>` with summary "What changed"; body is the bullet list (or "No differences").
- `data-testid: compare-probe-diff`. No extra horizontal scroll; no second popover.


## Behaviour notes (tip2+)
- **NIT-H-1:** after hydrate, skip `deleted === true` (tombstone is 200).
- **NIT-H-2:** `GET /api/activity?before=` ISO-8601 cursor; client pages until 20 live registers or end, max 5 pages × `limit=100`.
- **400 client echoes (Leader ruling):** 400 bodies may echo caller-sent values (e.g. `FEATURED_INVALID.invalid`, zod `received`). Never server paths or absolute paths. Cap each echoed value at **200 characters**. Fuzz allows these echoes within that cap.

## Tip order (from R1)
Tip1 = CO-1 + CO-2. #69 server before the client Save change.

