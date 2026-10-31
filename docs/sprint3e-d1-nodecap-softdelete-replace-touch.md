# S3-E · D1: scene-author node cap, soft-delete, replace child, touch orbit
Base `132f0dc` · pack `enhancement/s3e-growth-t5` · seed and cut `/workspace/sprint3e-seed.md` · **bound to R1** `docs/sprint3e-brief.md` · `assetSchemaVersion` stays **3**. Every field is additive and optional, and every error body is `{code, error, ...extra}`.

## 1. #38 Node cap
- `SCENE_MAX_NODES` defaults to 256 and must be an integer of at least 1. An invalid value refuses start, so it fails closed.
- POST or PATCH of a scene with more than the cap of **live** nodes returns **400** `SCENE_NODES_MAX` with `{ count, max }`. Tombstoned nodes (#41) **don't count**, per the Leader's ruling.
- UI:
  - The author header shows the counter "Nodes n / max". It turns to the warning colour at 90% or more and the error colour at the cap.
  - At the cap, **Add node** and **Duplicate** (#26) are disabled and have the `title` "Node limit reached (max)".
  - Restoring a tombstone (#41) at the cap is also disabled, with the same title.
- Hooks: `data-testid="node-count"`, `node-add`, `node-duplicate`.

## 2. #41 Soft-delete, Restore and Purge
- **Delete** on a node sets `deleted: true`. The node keeps its id and its transform.
- The viewer doesn't render it, and resolve (V4/V4a) skips it.
- **In the author's node list:**
  - Tombstoned rows stay in place and are shown struck through in the muted text colour (not opacity, so AA contrast holds), with a "deleted" pill.
  - Each tombstoned row has a **Restore** button that clears the flag, unless the cap would be exceeded.
  - The list header has a toggle, "Show deleted (n)", which is on by default whenever n > 0.
- **Purge:**
  - **Purge deleted (n)** sits in the list header and is styled as danger.
  - It confirms inline with the text "Permanently remove n nodes? This can't be undone." and **Purge** / **Cancel** buttons. There's no modal.
  - Purge removes the tombstones from the draft. They're only gone from storage after Save, under the S3-A dirty rules.
  - Save on its own **never** purges.
- **R1 invariants, shown in the UI:**
  - Delete is disabled on the `rootId` node, with the `title` "Root node can't be deleted". The API returns 400 `SCENE_ROOT_DELETE`.
  - Delete is disabled when it would leave no live nodes. The API returns 400 `SCENE_NO_LIVE_NODES`.
  - Tombstoned nodes can't be selected by a gizmo, can't be duplicated and can't be replaced.
- **Asset delete:** a tombstoned reference still blocks `DELETE /api/assets/:id`, with 409 `ASSET_IN_USE`. The asset panel's hint for that case reads "Used by deleted nodes in <scene>, purge to free".
- **Delete asset… (tip3):** the asset panel has a "Delete asset…" button with an inline confirm. A 409 `ASSET_IN_USE` there shows the purge hint.
- `SCENE_ROOT_DELETE` checks the explicit `rootId` only.
- The UI reads the cap from `/api/health` → `limits.sceneMaxNodes`.
- Hooks: `node-restore-<id>`, `nodes-purge`, `nodes-purge-confirm`, `nodes-show-deleted`.

## 3. #35 Replace child asset and keep its transform
- The node inspector gets a **Replace asset…** action. It opens the existing asset search (S3-A tags and search chrome) in picker mode, and the current asset is excluded from the results.
- Picking an asset swaps `assetId` only. `transform`, `visible` and the node id are kept, and `defaultClip` resets to the new asset's default.
- The swap marks the scene dirty and runs V4/V4a resolve on the draft. A missing or ambiguous target shows the existing V4 or V4a inline error on that node row. Picking a `stage:"scene"` asset is also rejected, with the existing no-nested error, and so is picking the scene itself, and Save stays disabled until it's fixed.
- One undo step: until Save, an inline "Replaced X → Y · Undo" chip lets you undo the swap.
- Hooks: `node-replace-<id>`, `node-replace-undo`.

## 4. #87 Touch orbit
- On the canvas only (`touch-action: none` on the canvas element, not on the page):
  - One finger rotates.
  - Two fingers pinch to zoom and drag to pan.
- Outside the canvas, the page scrolls normally. Inside the canvas, a two-finger pinch never zooms the page.
- The dock (#82 rule) stays usable at **390×844**.
  - Rows wrap and the dock keeps `max-height: 45vh` with internal scroll.
  - Touch targets are at least 44×44 px below 600 px width, and stay at least 24 px at desktop sizes.
  - Nothing overlaps.
- AC viewport: headless 390×844 with touch emulation, plus the existing 1280×800 and 1920 checks.

## 5. Narrow viewports (below 600 px)
- The overlay panels (import/actionMap) move into flow **below** the canvas so they never cover it or catch touch.
- The canvas `touch-action: none` is `!important`, because three.js writes an inline `auto` when the controls remount.

## Layout guard
- Everything new follows `/workspace/s3c-82-dock-layout.md`: in-flow layout, wrapping rows, and no overlap at 390×844, 1280×800 or 1920. AA contrast (4.5:1) holds in both #86 themes, including the struck-through tombstone rows.
