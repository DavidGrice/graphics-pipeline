# S3-A-D2 — Clip tags + search/PATCH + viewer chrome wire

**Role:** Graphics_Bot_Designer  
**Lane:** Design → Engineer E2/E3/E4 · Tester T1.4–T1.7  
**Brief:** `/workspace/sprint3a-brief.md` (**R1 bound**) · Companion: `docs/sprint3a-d1-persist-gizmo-visibility.md`  
**Status:** Bound to R1  
**Cut:** `/workspace/sprint3a-cut.md` · **Base:** `a8b32c8` · **Pack:** `enhancement/s3a-growth-t1`

---

## 1. Clip tags (#5)

```ts
clipTags?: Record<string, Array<"locomotion" | "emote" | "combat">>;
// key ∈ probed clips[]
```

| Case | UI / contract |
|------|----------------|
| Known clip + enum tag | accept; picker may filter by tag |
| Unknown clip key | **reject** |
| Unknown tag string | **reject** |
| Missing `clipTags` | OK |

Suggested defaults (optional UX): `idle|walk|run|jump` → locomotion; `wave` → emote.

---

## 2. Humanoid bone gate (#13) — UI note

When `characterType=humanoid`, register/schema requires `rig.boneCount >= 8` (probe preferred). Prop ~2-bone → reject. Show bone count in stats (#83) when available.

```ts
rig: { hasArmature: boolean; hasWeights: boolean; boneCount?: number; … }
```

---

## 3. PATCH + search (#67, #71)

### PATCH metadata (no re-upload)

Allowed: `name`, `tags[]`, `clipTags`, `characterType` (honesty-gated), `clipUx`  
Forbidden via PATCH alone: GLB bytes, forging `clips`/`rig`/`stage` vs probe  
`assetSchemaVersion` server-managed (#75) — no decrement

### Search

`GET /api/assets?clip=&stage=&characterType=&tag=&q=`

| Param | Match |
|-------|-------|
| clip | clips includes |
| stage / characterType | exact |
| tag | metadata tags includes |
| q | name/slug substring |

Unknown stage → 400.

### Schema version (#75)

`assetSchemaVersion: 3` on S3-A create; older missing → coerce 1|2 in readers.

---

## 4. Viewer chrome (#79, #83)

```
┌─ Viewer ──────────────────────────────┐
│  [Fullscreen] [Stats ▾]               │
│  canvas…                              │
│  Stats: tris · verts · bones · clips  │
│         stage · characterType         │
└───────────────────────────────────────┘
```

| Control | Behavior |
|---------|----------|
| Fullscreen | browser FS on canvas/container; Esc exits; no clip loss |
| Stats | toggleable; missing mesh → `—`; no crash |

---

## 5. CI / health notes (#50, #103) — docs for E4

| ID | Wire |
|----|------|
| #50 | `BRIDGE=mock` health OK without Krita; export fixture/skip; don’t break vendor\|firstparty |
| #103 | health `tools.blender|krita` path+version; box SoT `/home/box/tools/{blender,krita}` |

---

## 6. Handoffs / AC

| To | Use |
|----|-----|
| E2 | clipTags · schemaVersion · boneCount |
| E3 | PATCH · search |
| E4 | fullscreen · stats · mock · health badge |
| Tester T1.4–T1.7 | tags · bone · PATCH/search · chrome/CI |

| Cut AC | This doc |
|--------|----------|
| T1.4–T1.7 | §1–§5 |
| T1.8 | this file on **pack** |

**Locks:** room-only · Tester opens PR · no `*-docs` · stretch 91/62/135 only if tip eats clean.
