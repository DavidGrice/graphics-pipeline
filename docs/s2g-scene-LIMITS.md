# S2-G scene authoring + jump — LIMITS

- **Slug resolve (E1):** child `assetId` accepts canonical `id` **or** a **unique** registered slug. Unknown → **V4**. Ambiguous slug (>1) → **V4a** (no silent first-pick). Persist normalizes to canonical `id`.
- **Authoring (E2):** minimal CRUD on `scene.nodes` (add/remove/edit assetId · transform · defaultClip). Not a world editor; no gizmos; nested `stage=scene` picker forbidden (V5).
- **Jump (E3):** `png_to_glb --mode=rigged` emits Actions `idle`+`walk`+`run`+`jump`. Schema still requires only `idle`+`walk`+`run` for `stage=rigged`; `jump` is first-class export / allowlist. Billboard claiming `jump` rejects. `clipUx.defaultClip` / scene `defaultClip` must ∈ probed `clips[]`.
- **Regress:** S2-F V4/V5/V6b/V8 · soft-env · blender-smoke A/B · no BRIDGE/OBJ/media-in-git churn · `BLENDER_BIN` fail-closed.
