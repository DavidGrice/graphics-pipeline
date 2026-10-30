# S3-D-R1 — Contract brief

> **Rev 2 (Oct 30):** code names aligned to D `20d1bf5` (Leader-approved): `PATH_OUTSIDE_INBOX`, `IDLE_TPOSE_SUSPECT`, `SLUG_CLASH`, `GLB_TOO_LARGE`, `PNG_ALPHA_PREMULT_SUSPECT`. Thresholds §4/§5 fixed.
 (growth tranche 4: robustness first)

**Cut:** `/workspace/sprint3d-cut.md` · **Seed:** `/workspace/sprint3d-seed.md`
**Base:** `origin/dev` @ `63dbf33` (D1/D2 via #43; S3-C @ `7d3b5df`) · **Pack:** `enhancement/s3d-growth-t4` (one branch only)
**IDs:** 89, 76, 141, 49, 97 · 127, 90, 86, 88, 94 · 104, 152
**Locks:** probe wins · no media in git · fail-closed `BLENDER_BIN` · `assetSchemaVersion` stays **3** (all new fields optional/additive) · room-only · Tester opens PR after FULL PASS · R/D docs on pack only.
**Grounded on base:** `apps/world-builder/server/src/index.js` returns free-text `{error}` (no stable codes); file routes `path.join(DATA_ROOT, formats.*)` with **no containment check** and echo absolute paths in 404 bodies; register does **not** reject duplicate slugs (clash only surfaces at scene resolve, V4a).

---

## 0. Cross-cutting: stable error codes (enables #152) — MUST
- Every 4xx/5xx JSON body = `{ code: "UPPER_SNAKE", error: "<human text>", ...extra }`. Keep `error` text for back-compat; tests key on `code`.
- New 3-D codes are mandatory; existing routes retrofit codes where touched (at minimum: `NOT_FOUND`, `VALIDATION`, `ASSET_IN_USE` for the 409 DELETE, `SCENE_CAMERAS_MAX`, `MULTI_ARMATURE`).
- CLI exit codes unchanged (golden: 1 drift / 2 version / 3 unstable; seed bad → 2).
- Error bodies must **not** echo absolute filesystem paths (return repo-relative `rel` only). HARDEN — current file/preview 404s leak `abs`.

## 1. Error boundary + probe dump (#89) — E1 MUST
- Two React error boundaries: app shell and viewer canvas. Viewer failure never unmounts list/search/scene author.
- Card shows: `assetId`, failing URL + HTTP status (or loader error), last probe summary from asset JSON (`clips`, `rig`, `clipDurations`, `importMeta.warnings`), **Retry** and **Back to list**.
- GLB fetch 404/500 or GLTFLoader throw → card, not a blank page. Regress: S3-C orphan repro (asset JSON present, GLB missing).
- Probe dump is read-only; no new API.

## 2. Oversized GLB reject (#76) — E1
- Env `MAX_GLB_MB` (default **100**, integer ≥1; invalid env → server refuses to start, fail-closed).
- Register/PATCH that sets `formats.glb`: `fs.stat` under DATA_ROOT; size > limit → **413** `GLB_TOO_LARGE` `{ sizeBytes, maxBytes }`. Checked **before** probe.
- Pipeline export also checks and exits non-zero with the same code text. Test uses a sparse/truncated temp file in tmpdir — no media in git.

## 3. Path-traversal guard (#141) — E1 MUST
- Single helper `resolveUnder(root, rel)`: `path.resolve` + `fs.realpathSync` on existing prefix; result must start with `root + sep`; else **400** `PATH_OUTSIDE_INBOX` (Designer name, Leader-approved; covers every DATA_ROOT path, not only inbox).
- Applies to: register `formats.{glb,fbx,obj,preview}`, `GET /api/assets/:id/file|preview`, inbox (`data/inbox/<slug>`).
- Rejects: `..` segments, absolute paths, symlink escaping DATA_ROOT, NUL bytes. Encoded `%2e%2e` covered by decode-then-check.
- Shell side: `run_mvp.sh`/`pipeline.sh` validate slug against the schema regex `^[a-z0-9]+(-[a-z0-9]+)*$` before building `INBOX_DIR`; bad slug → exit **2**.

## 4. Alpha premultiply warn (#49) — E1
- Warn-only. **Threshold (R1, fixed):** consider semi-transparent pixels `0 < a < 255`. If count ≥ **64** and ≥ **99%** of them satisfy `max(r,g,b) ≤ a` → `importMeta.warnings[]` `{ code: "PNG_ALPHA_PREMULT_SUSPECT", detail: { semiCount, ratio } }`. Fewer than 64 semi-transparent px → no check (opaque/cutout art is fine).
- Never blocks register; deterministic (same PNG → same result). `importMeta.warnings` optional array, additive.

## 5. Reject T-pose-as-idle (#97) — E1
- In probe: for clip mapped/named `idle`, compute max per-bone rotation delta across keys. If < **0.5°** (and position delta < 1e-4) → static pose.
- Behaviour: register still succeeds; warning `{ code: "IDLE_TPOSE_SUSPECT", clip }` in `importMeta.warnings[]`; that clip is **excluded from the default actionMap idle slot** (humanoid gate S2-D then requires another idle or fails with existing humanoid error).
- **Threshold (R1, fixed):** `IDLE_MAX_ROT_DEG = 0.5`, `IDLE_MAX_POS = 1e-4` (scene units). Threshold constants exported + unit-tested with a synthetic static clip and a 1° clip.

## 6. Slug-clash conflict UI (#127) — E2
- Register with a slug already owned by a **different id** → **409** `SLUG_CLASH` `{ slug, existingId, suggestedSlug }`. `suggestedSlug` = `<slug>-2`, `-3`… first free, still kebab-valid.
- Same id + same slug (idempotent re-register) unchanged.
- **Regress risk:** existing tests that re-register a shared slug with new ids must use unique slugs — fix tests, not the rule.
- UI: inline banner on the register/import form with "Use `<suggestedSlug>`" button; scene author V4a ambiguity message links to the conflicting assets.

## 7. prefers-reduced-motion (#90) — E2
- When `matchMedia('(prefers-reduced-motion: reduce)')`: autoplay spin off, crossfade forced to 0, camera bookmark jump is instant (no tween).
- Session toggle can re-enable motion; not persisted, no schema. Stored `clipUx.blendMs` is **not** rewritten.

## 8. Dark/light viewer chrome (#86) — E2
- Follow `prefers-color-scheme`; session override (system | light | dark). CSS variables only; canvas clear colour follows theme. No schema. Must keep #82 dock contrast ≥ 4.5:1 on labels.

## 9. Alt text (#88) — E2
- Optional `asset.altText: string` (trimmed, 1–280 chars; empty string clears). Via existing `PATCH /api/assets/:id`; >280 → **400** `ALT_TEXT_TOO_LONG`.
- Viewer canvas gets `role="img"` + `aria-label` = altText ?? name. Schema stays 3 (optional field). OpenAPI updated.

## 10. Import history (#94) — E2
- Read-only panel: last **20** registered assets, newest first, by `createdAt` (add `createdAt` ISO on register if missing; legacy assets without it sort last). Shows name, stage, characterType, warnings count.
- Optional `GET /api/assets?sort=-createdAt&limit=20` (limit 1–100, else 400 `VALIDATION`). No new collection.

## 11. Skip-reason table (#104) — E3
- Every `t.skip()`/`{skip}` passes a reason string starting with a code: `SKIP_NO_BLENDER`, `SKIP_NO_API`, `SKIP_NO_UI_URL`, `SKIP_NO_MONGO`, `SKIP_NO_KRITA`, `SKIP_PLATFORM`.
- `npm run test:s1` ends with a table: code · count · tests. A skip without a known code fails the run (exit 1). Base has ~19 skip sites across 10 test files.

## 12. Error-code encyclopedia (#152) — E3/R MUST
- `docs/error-codes.md` (layout per D2): one row per code → HTTP status or exit code, where raised, meaning, fix hint.
- Test `tests/s3d-error-codes.test.mjs`: scans `apps/**` + `packages/**` + `scripts/**` for `code: "X"` / `E_*` constants, asserts each appears in the doc, **and** each doc code still exists in source (both directions).
- Must include base codes: `E_BLENDER_BIN_MISSING`, `E_BLENDER_BIN_UNSET`, `E_BLENDER_VERSION`, `E_GOLDEN_BLENDER_VERSION`, `E_GOLDEN_DRIFT`, `E_GOLDEN_FIXTURE`, `E_GOLDEN_MALFORMED`, `E_GOLDEN_PLACEHOLDER`, `E_GOLDEN_UNSTABLE`, `MULTI_ARMATURE`, `SCENE_CAMERAS_MAX` + all §0–§11 codes.

---

## Lanes → AC
| Lane | IDs | Tester rows |
|------|-----|-------------|
| E1 | 89 · 76 · 141 · 49 · 97 | T1.2 · T1.3 |
| E2 | 127 · 90 · 86 · 88 · 94 | T1.4 |
| E3 | 104 · 152 | T1.5 |
| all | regress S3-C + `check-82-overlay.mjs` 1280/1920 | T1.1 · T1.6 |

**Tester probes (suggested):** traversal set `../x`, `/etc/passwd`, `%2e%2e/x`, symlink out of DATA_ROOT, slug `../a` to `run_mvp.sh`; 413 with `MAX_GLB_MB=1` + 2 MB sparse file; orphan GLB → boundary while search still works; slug clash → 409 + suggestion accepted.
**Out of scope:** schema bump · auth · nested scenes · new storage.
