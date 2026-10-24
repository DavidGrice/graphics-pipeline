# Contributing

Repo: https://github.com/DavidGrice/graphics-pipeline

## Branch & PR flow (Designer schematic)

```
feature/* | bug/* | enhancement/*
        │ PR (CI required)
        ▼
       dev  ──PR──►  test  ──PR──►  main (prod-ready)
```

| Prefix | Purpose | Cut from | PR into |
|--------|---------|----------|---------|
| `feature/<slug>` | New capability | `dev` | `dev` |
| `bug/<slug>` | Defect | `dev` (or `main` for hotfix) | `dev` (or `main` + backport) |
| `enhancement/<slug>` | Non-breaking improvement | `dev` | `dev` |

**Slug:** kebab-case (`enhancement/s15-cicd`, `feature/mcp-health-strict`).

**Promotion:** merge PRs `dev` → `test` → `main`. Environments map to that ladder; Sprint 1.5 is CI-only (no deploy secrets).

Full schematic: [`sprint1.5-ci-branch-schematic.md`](./sprint1.5-ci-branch-schematic.md).

## Local checks before PR

```bash
npm ci
npm run build:schema
npm run typecheck
npm run test:s1
```

## Privacy — never commit

| Pattern | Why |
|---------|-----|
| `.env`, `.env.*` (keep `.env.example`) | secrets |
| `*.pem`, `*.key`, `credentials.json`, `**/secrets/**` | keys |
| `data/inbox/**`, `data/assets/**` (except `.gitkeep`) | Krita/Blender outputs |
| `*.png` `*.glb` `*.fbx` `*.obj` `*.kra` `*.blend` | media/models |

CI fails if any matching media is **tracked** under `data/`.

## PR checklist

- [ ] Branch named `feature/*`, `bug/*`, or `enhancement/*`
- [ ] Targets **`dev`** (unless promoting `dev`→`test` or `test`→`main`)
- [ ] CI green (`build-test`: install, schema, typecheck, `test:s1`, data media guard)
- [ ] No secrets or pipeline binaries in the diff

## What maintainers enable in GitHub UI

1. Actions allowed; workflow permissions read-only by default  
2. Environments **`dev`**, **`test`**, **`prod`** (prod: required reviewers; deploy branches = `main` later)  
3. Branch protection on `main` (and ideally `dev`/`test`): require PR + status check **CI / build-test**  
4. Dependabot alerts + security updates; secret scanning + push protection  

See also [`SECURITY.md`](../SECURITY.md) and research brief [`sprint1.5-cicd-security-research.md`](./sprint1.5-cicd-security-research.md).
