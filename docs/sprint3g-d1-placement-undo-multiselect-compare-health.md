# S3-G D1: author power tools and viewer surfaces (undo/redo, multi-select, compare, health page) + overlay placement rule

**Pack:** `enhancement/s3g-growth-t7` from `c560e22` (CO-0 `8e8940c`), bound to R1 `docs/sprint3g-brief.md`. R1 wins on any conflict.
**Locks:** S3-C #82 dock rules (in-flow flex column, rows wrap, no overlap at 390×844, 1280×800, 1920) · hit targets ≥ 24px · state never colour-only · `prefers-reduced-motion` honoured · no absolute paths in the DOM.

## §1 Overlay placement rule (from NIT-F-1, applies to every popover and overlay)
- Open below the anchor; flip above when there's no room below.
- Left clamped to `[8px, innerWidth − width − 8px]`; reposition on resize and scroll.
- Under 600px wide: bottom sheet, `innerWidth − 16px` wide, primary content first, actions beneath.
- AC: at 390, 1280 and 1920, `left ≥ 0`, `right ≤ innerWidth`, `bottom ≤ innerHeight`, and `elementFromPoint` at each primary button's centre returns that button.

## §2 #36 Undo/redo
- Toolbar pair "Undo" / "Redo" (icon + `aria-label`, `title` shows the step label, e.g. "Undo Move 3 nodes"). Disabled state when the stack end is reached.
- Keys: Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y; ignored while focus is in an input, textarea or contenteditable.
- Dirty indicator: a "•" plus the text "Unsaved" beside Save whenever current step ≠ save marker. Undoing back to the marker clears it.
- Cap 100; no UI when the oldest drops.

## §3 #29 Multi-select
- Shift-click toggles; drag box on empty canvas (1px dashed outline, 10% fill, plus a count label). Ctrl/Cmd+A selects live nodes; Esc clears.
- Selected nodes: outline highlight plus a check badge in the outliner (not colour alone). Panel header reads "n selected".
- Batch actions row: Hide, Show, Delete, Restore. Gizmo sits on the selection centroid.
- Skips raise a toast: "2 skipped (root, already deleted)". A restore that would cross the node cap is refused whole with "Restore would exceed the N-node limit", with N read from `/api/health` `limits.sceneMaxNodes`).

## §4 #84 Compare
- Entry: "Compare…" on an asset opens a picker for the second asset, then `?compare=a,b`.
- Layout ≥ 600px: two viewports side by side, header per side (slug + stage), "Sync orbit" toggle (default on) above them, diff table below. Under 600px: stacked viewports, then the table.
- Diff table rows: tris, bones, clips, `clipRequires`, size, `characterType`, license, stage. Differing rows get a "≠" marker and bold text.
- Errors (malformed, self, unknown id) render inline in the compare area with a "Back to assets" link.

## §5 #44 Health page
- Nav link "Health" → `/health`. Cards: Bridge (status word + icon, mode), Krita port, Tools (versions), Limits, Share base, Data root ("set"/"unset" only), Recent activity (last 5, same row style as S3-F activity panel).
- "Updated 10s ago" line; shows "Paused (tab hidden)" when hidden and "Rate limited, retrying in Ns" on 429.
- Single column under 600px.

## AC hooks
`data-testid`: `undo`, `redo`, `dirty-indicator`, `select-box`, `selection-count`, `batch-actions`, `compare-left`, `compare-right`, `compare-sync`, `compare-diff`, `health-page`, `health-bridge`, `health-activity`. The viewer root carries `data-scene-ready` (CO-4).
