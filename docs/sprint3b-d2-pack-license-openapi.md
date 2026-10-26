# S3-B-D2 — pack zip + license + OpenAPI + duration_ms notes

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E2/E3/E4 · Tester T1.4–T1.7  
**Brief:** `/workspace/sprint3b-brief.md` (rebind when R1 lands) · Companion: `docs/sprint3b-d1-actionmap-gizmo-snap.md`  
**Status:** Cut-draft — **R1 pending rebind**  
**Cut:** `/workspace/sprint3b-cut.md` · **Base:** `0f21a43` · **Pack:** `enhancement/s3b-growth-t2`

---

## 1. Golden GLB hashes (#62)

| Rule | Detail |
|------|--------|
| Store | CI golden hashes for billboard + rigged smoke GLBs |
| Drift | mismatch → **fail** smoke |
| Scope | byte-stable exports under fixed seed/flags |

---

## 2. Pack zip export / import (#135 / #136)

```
pack.zip
├── manifest.json      # schemaVersion + asset ids/slugs + SPDX
├── assets/*.glb
└── LICENSE            # or per-asset SPDX refs
```

| Op | Contract |
|----|----------|
| Export | selected assets → zip; **no** `data/**` secrets; include schema version |
| Import | inverse; re-run honesty gates (V4–V8, humanoid, clips) |
| Fail-closed | corrupt zip / missing GLB / bad SPDX → reject with named error |

---

## 3. License SPDX (#137)

```ts
license?: string; // SPDX id, e.g. "MIT", "CC0-1.0", "LicenseRef-…"
```

- Optional on asset; pack manifest echoes it.  
- Unknown SPDX string → warn or reject per R1 (prefer reject unknown bare strings without `LicenseRef-`).

---

## 4. Clip duration_ms (#8)

```ts
clipMeta?: Record<string, { duration_ms: number }>; // key ∈ clips[]
```

- Probe from GLB Actions; UI stats/picker may show length.  
- Dishonest duration (claim without Action) → reject.

---

## 5. OpenAPI stub (#74)

- Generate/serve OpenAPI 3 stub from routes (`/api/openapi.json` or repo `docs/openapi.yaml`).  
- Cover register, PATCH, search, health, pack import/export at stub depth.  
- Stub ≠ full codegen client this sprint.

---

## 6. Handoffs / AC

| To | Use |
|----|-----|
| E2 | #62 golden · #8 duration_ms |
| E3 | #135/#136 pack · #137 SPDX |
| E4 | #74 OpenAPI + S3-A regress |
| Tester T1.4–T1.6 | hash drift · pack+SPDX · duration + OpenAPI |

| Cut AC | This doc |
|--------|----------|
| T1.4–T1.6 | §1–§5 |
| T1.7 | this file on **pack** |

**Locks:** room-only · Tester opens PR · no media in git · `BLENDER_BIN` fail-closed.
