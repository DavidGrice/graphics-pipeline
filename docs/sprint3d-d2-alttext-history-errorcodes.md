# S3-D · D2: alt text, import history and error-code doc layout
Base `63dbf33` · pack `enhancement/s3d-growth-t4` · cut `/workspace/sprint3d-cut.md` · **bound to R1 rev 2** `/workspace/sprint3d-brief.md` · `assetSchemaVersion` stays **3**.

## 1. #88 Alt text (R1 §9)
- `asset.altText` is optional. It's trimmed and must be 1 to 280 characters; an empty string clears it. It's set through the existing `PATCH /api/assets/:id`. More than 280 characters returns **400** `ALT_TEXT_TOO_LONG`.
- In the form, a textarea labelled "Alt text (optional)" shows a live "n/280" counter that turns to the error colour above 280. Save is disabled while it's over the limit.
- The viewer canvas wrapper gets `role="img"` and an `aria-label` of `altText ?? name`.

## 2. #94 Import history (R1 §10)
- This is a read-only sidebar section below the asset list, titled "Recent imports". It shows the **20** newest by `createdAt`, and legacy assets without `createdAt` sort last.
- Row: name · stage · characterType badge (#21) · "⚠ n" if there are any `importMeta.warnings`, then a relative time such as "3 min ago". The full ISO time goes in `title`. Clicking a row selects that asset.
- When there's nothing to show, it says "No imports yet." Data comes from the optional `GET /api/assets?sort=-createdAt&limit=20`. The limit must be 1 to 100; anything else returns 400 `VALIDATION`.

## 3. #152 `docs/error-codes.md` layout (R1 §0, §12)
- **Body shape (R1 §0 wins; flat, back-compatible):** `{ "code": "UPPER_SNAKE", "error": "<human text>", ...extra }`. No absolute paths in any body.
- **One table**, with columns `code | HTTP / exit | where raised | meaning | fix hint`. Rows are grouped under these sub-headings, alphabetical within each group:
  1. **Generic:** `NOT_FOUND`, `VALIDATION`
  2. **Scene / V-codes:** V1, V4/V4a, V5, V6b, V8, `SCENE_CAMERAS_MAX`
  3. **Asset:** `MULTI_ARMATURE`, `ASSET_IN_USE` (409 DELETE), `SLUG_CLASH` (409), `GLB_TOO_LARGE` (413), `PATH_OUTSIDE_INBOX` (400, covers every `DATA_ROOT` path), `ALT_TEXT_TOO_LONG` (400)
  4. **Import warnings (warn-only, `importMeta.warnings[]`):** `PNG_ALPHA_PREMULT_SUSPECT`, `IDLE_TPOSE_SUSPECT`
  5. **CLI exits:** `E_GOLDEN_DRIFT` (1), `E_GOLDEN_BLENDER_VERSION` (2), `E_GOLDEN_UNSTABLE` (3), bad seed or slug (2)
  6. **Test skips (#104):** `SKIP_NO_BLENDER`, `SKIP_NO_API`, `SKIP_NO_UI_URL`, `SKIP_NO_MONGO`, `SKIP_NO_KRITA`, `SKIP_PLATFORM`
- The test is **both-directions fail**, per R1 §12. A code in source that's missing from the doc fails, and a code in the doc that's missing from source fails.
