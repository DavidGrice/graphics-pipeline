# S3-D · D1 — Error boundary, slug-clash, theme & reduced motion
Base `7d3b5df` · pack `enhancement/s3d-growth-t4` · cut `/workspace/sprint3d-cut.md` · `assetSchemaVersion` stays **3** (all additive/optional). Cut-draft; rebinds to R1 `/workspace/sprint3d-brief.md`.

## 1. #89 Error boundary and error card
- There are two boundaries. The **App** boundary wraps the routes, and the **Viewer** boundary wraps the canvas and dock. A viewer failure must never blank the sidebar or list.
- The error card sits in the region of the boundary that caught the error. Its layout, top to bottom:
  1. Title: "Couldn't load <assetId>" for a viewer error, or "Something went wrong" for an app error.
  2. Line: `HTTP <status>` or `Exception: <name>`, plus the error code if there is one (from `docs/error-codes.md`).
  3. A collapsible "Last probe" `<details>` with a `<pre>` of the last probe JSON. Cap it at 20 KB and say "truncated" when it's cut.
  4. Buttons: **Retry**, which re-mounts the boundary and refetches, then **Copy details**, which copies the JSON {assetId, status, code, probe}.
- Hooks: `data-testid="error-card"`, `error-card-retry`, `error-card-copy`.
- Regress: the S3-C orphan repro (an asset whose GLB is missing) shows the card inside the viewer, and the list stays usable.

## 2. #127 Slug-clash inline rename
- On a 409 `SLUG_CLASH` from register, the register form keeps every value. The slug field gets an inline error that reads "`<slug>` is taken" and a **Use `<suggestedSlug>`** button that fills the field without auto-submitting.
- Hook: `data-testid="slug-clash-suggest"`.

## 4. #90 Reduced motion
- When `matchMedia('(prefers-reduced-motion: reduce)')` matches, autoplay spin is off and the effective crossfade is 0 ms. The stored `clipUx.blendMs` doesn't change; only the effective value does.
- Add a session-only toggle labelled "Motion: system / on / reduced" in the dock's View row, in the "Overlay (session)" group.

## 3. #86 Dark and light chrome
- The theme uses CSS custom properties on `:root[data-theme]`. It follows `prefers-color-scheme` unless the app theme overrides it.
- The 3D canvas background stays neutral (`#1a1a1f` dark, `#e9e9ee` light). The grid and ground keep a contrast ratio of at least 3:1.
- Every chrome text pair meets WCAG AA, 4.5:1. The Tester checks the dock, sidebar, badges and the error card.

## Layout guard
- New controls follow the S3-C dock rule (`/workspace/s3c-82-dock-layout.md`): everything stays in flow, rows wrap, and nothing overlaps at 1280×800 or 1920.
