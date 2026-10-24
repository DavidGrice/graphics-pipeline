# Sprint 1.5 — CI/CD workflow + branch/PR schematic (Designer)

**Repo:** https://github.com/DavidGrice/graphics-pipeline  
**Envs:** `dev` → `test` → `prod`  
**Branch prefixes:** `feature/*` · `bug/*` · `enhancement/*`

---

## 1. Branch model

```
main  (prod-ready; protected)
  ▲
  │  PR (required checks + review)
test  (integration / staging)
  ▲
  │  PR or promote
dev   (integration tip)
  ▲
  │  PR
feature/* | bug/* | enhancement/*
```

| Branch | Purpose | Merges from |
|--------|---------|-------------|
| `feature/<slug>` | New capability | — (cut from `dev`) |
| `bug/<slug>` | Defect fix | — (cut from `dev`, or `main` for hotfix → still PR) |
| `enhancement/<slug>` | Non-breaking improvement | — (cut from `dev`) |
| `dev` | Integration | feature/bug/enhancement PRs |
| `test` | Pre-prod validation | `dev` (promote PR) |
| `main` | Production | `test` (promote PR) |

**Naming slug:** kebab-case, short (`feature/mcp-health-strict`, `bug/fake-blender-chmod`, `enhancement/fbx-schema`).

**Hotfix:** `bug/<slug>` from `main` → PR into `main` + backport PR into `dev`.

---

## 2. PR rules (schematic)

```
Open PR → CI workflow runs (required)
  ├─ lint / typecheck
  ├─ npm run test:s1
  ├─ secret scan (fail-closed)
  └─ asset/binary guard (fail if tracked PNG/GLB/FBX/OBJ under data/)
       │
       ▼
 Review (CODEOWNERS) → merge only if checks green
```

| Target | Required before merge |
|--------|------------------------|
| → `dev` | CI green; 1 review preferred |
| → `test` | CI green; Tester AC note |
| → `main` | CI green; Leader/Engineer review; Environments `prod` approval if deploy job exists |

No direct push to `main` / `test` / `dev` once protection is on (user admin action).

---

## 3. CI/CD pipeline diagram

```
[push / pull_request]
        │
        ▼
┌───────────────────────────┐
│  ci.yml (all branches)    │
│  • checkout               │
│  • npm ci                 │
│  • lint + tsc             │
│  • test:s1                │
│  • gitleaks / secret scan │
│  • forbid data/** binaries│
└─────────────┬─────────────┘
              │ pass
              ▼
┌───────────────────────────┐
│  Env: dev                 │  (on merge → dev)
│  smoke / artifact upload  │
└─────────────┬─────────────┘
              │ promote PR
              ▼
┌───────────────────────────┐
│  Env: test                │
│  fuller suite + manual QA │
└─────────────┬─────────────┘
              │ promote PR
              ▼
┌───────────────────────────┐
│  Env: prod (main)         │
│  release tag / deploy     │  (secrets only here later)
└───────────────────────────┘
```

Sprint 1.5 = **CI-only** (no deploy secrets required). Deploy jobs stay stubs until user adds Environment secrets.

---

## 4. Privacy / gitignore (design contract)

**Never commit**

| Pattern | Why |
|---------|-----|
| `.env`, `.env.*`, `!.env.example` | secrets |
| `**/*secret*`, `**/*.pem`, `**/*.key` | keys |
| `node_modules/` | install locally/CI |
| `data/inbox/**` | Krita exports |
| `data/assets/**/*.png` | previews / sources |
| `data/assets/**/*.{glb,fbx,obj,mtl,kra,blend,blend1}` | models |
| `*.glb`, `*.fbx` at repo root accidental drops | safety net |

**Do commit:** `packages/asset-schema`, apps source, docs, `.env.example`, empty `data/**/.gitkeep` if needed, LICENSE/NOTICE.

---

## 5. Per-role job lanes (repo usage)

| Role | Typical branches | CI interest |
|------|------------------|-------------|
| Researcher | `enhancement/research-*`, docs PRs → `dev` | docs-only path OK |
| Designer | `feature/design-*`, schematic/docs → `dev` | doc + schema PRs |
| Engineer | `feature/*`, `bug/*` → `dev` | full CI |
| Tester | `bug/test-*`, AC/docs → `dev`; gates promote → `test`/`main` | test suite owner |
| Leader | release PRs `test`→`main`, protection/settings | Environments |

---

## 6. User access checklist (from Leader)

1. Actions enabled on the repo  
2. Environments `dev` / `test` / `prod` created (or API-approve)  
3. Branch protection on `main` (and ideally `test`/`dev`) — admin  
4. Deploy secrets later only — not needed for CI smoke  

---

*S1-D — Designer deliverable for Sprint 1.5. Engineer implements; Tester writes AC against §2–§4.*
