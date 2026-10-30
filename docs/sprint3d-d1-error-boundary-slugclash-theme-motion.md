# S3-D · D1: error boundary, slug-clash, theme and reduced motion
Base `63dbf33` · pack `enhancement/s3d-growth-t4` · cut `/workspace/sprint3d-cut.md` · **bound to R1 rev 2** `/workspace/sprint3d-brief.md` · `assetSchemaVersion` stays **3**. All changes are additive and optional.

## 1. #89 Error boundary and error card (R1 §1)
- There are two React boundaries, one around the **app shell** and one around the **viewer canvas**. A viewer failure never unmounts the list, search or scene author.
- Triggers: a GLB fetch 404 or 500, or a `GLTFLoader` throw. Either one shows the card and never a blank page.
- The card renders inside the region whose boundary caught the error. Top to bottom:
  1. Title: "Couldn't load <assetId>" for the viewer, or "Something went wrong" for the app.
  2. Line: the failing URL as a repo-relative path (never absolute), then `HTTP <status>` or the loader error name, then `code` if the body has one (R1 §0).
  3. A collapsible "Probe summary" section in a `<details>` element. It holds a `<pre>` showing `clips`, `rig`, `clipDurations` and `importMeta.warnings`, read from the asset JSON. It's read-only and needs no new API.
  4. Buttons: **Retry**, which remounts and refetches. **Back to list**, which clears the selection. **Copy details**, which copies the JSON {assetId, url, status, code, probe summary}.
- Hooks: `data-testid="error-card"`, `error-card-retry`, `error-card-back`, `error-card-copy`.
- Regress: in the S3-C orphan repro (asset JSON present, GLB missing), the card appears in the viewer and the list stays usable.

## 2. #127 Slug clash inline (R1 §6)
- The API returns 409 `SLUG_CLASH` with `{ slug, existingId, suggestedSlug }`, where `suggestedSlug` is the first free one of `<slug>-2`, `-3`, and so on.
- The register form keeps all its values. Under the slug field it shows an inline error, "`<slug>` is already used by `<existingId>`", plus a **Use `<suggestedSlug>`** button. The button fills the field and doesn't submit.
- Hook: `data-testid="slug-clash-suggest"`.

## 3. #86 Dark and light chrome (R1 §8)
- Use CSS custom properties on `:root[data-theme="light"|"dark"]`. By default it follows `prefers-color-scheme`. The session override is "Theme: system / light / dark", which sits in the dock's View row under "Overlay (session)". It isn't persisted and isn't in the schema.
- The canvas clear colour follows the theme: `#1a1a1f` for dark and `#e9e9ee` for light. Grid and ground contrast against the clear colour stays at or above 3:1.
- All chrome text, including the dock labels from #82, sidebar, badges and error card, stays at or above **4.5:1** in both themes.

## 4. #90 Reduced motion (R1 §7)
- When `prefers-reduced-motion: reduce` matches, autoplay spin is off and the effective crossfade is **0 ms**. The stored `clipUx.blendMs` isn't changed. Camera-bookmark jumps are **instant**, with no tween.
- The session override is "Motion: system / on / reduced", next to Theme in the View row.

## Layout guard
- New controls follow the S3-C dock rule in `/workspace/s3c-82-dock-layout.md`: everything stays in flow, rows wrap, and nothing overlaps at 1280×800 or 1920.
