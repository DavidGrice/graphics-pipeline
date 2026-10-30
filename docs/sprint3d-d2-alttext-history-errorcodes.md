# S3-D · D2 — Alt text, import history, error-code doc layout
Base `7d3b5df` · pack `enhancement/s3d-growth-t4` · cut `/workspace/sprint3d-cut.md` · `assetSchemaVersion` stays **3** (all additive/optional). Cut-draft; rebinds to R1 `/workspace/sprint3d-brief.md`.

## 1. #88 Alt text
- The register and edit form gets a textarea labelled "Alt text (optional)", max 280 characters, with a live counter "n/280".
- The viewer canvas wrapper gets `role="img"` and `aria-label` set to `altText`, falling back to "3D preview of <slug>".

## 2. #94 Import history panel
- It's a collapsible sidebar section below the asset list, titled "Recent imports", with the newest 20 first.
- Each row shows: slug · type badge (from #21) · relative time ("3 min ago"), with the absolute ISO time in `title`. Clicking a row selects the asset. The panel is read-only.
- When there's nothing to show: "No imports yet."

## 3. #152 `docs/error-codes.md` layout
- Envelope for every 4xx (additive, matches V-codes): `{ "error": { "code", "message", "details" } }`.
- One table: `code | HTTP/exit | where | meaning | fix`, grouped: V-codes · asset/scene (MULTI_ARMATURE, SCENE_CAMERAS_MAX, …) · golden/pipeline exits (E_GOLDEN_*, seed exit 2) · S3-D codes.
- Proposed S3-D names (R1 may rename): `GLB_TOO_LARGE` (413, #76), `PATH_OUTSIDE_INBOX` (400, #141), `PNG_ALPHA_PREMULT_SUSPECT` / `IDLE_TPOSE_SUSPECT` (warn-only `importMeta.warnings[]`, #49/#97), `SLUG_CLASH` (409 + `suggestedSlug`, #127), skip codes `SKIP_NO_BLENDER|SKIP_NO_API|SKIP_NO_UI_URL|SKIP_ENV_*` (#104).
- Test: every `^[A-Z][A-Z0-9_]+$` code literal in `src/` + pipeline scripts must appear in the doc (fail); doc-only codes warn.
