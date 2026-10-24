# Sprint 1.5 — CI/CD, Environments, Branching & Security Research

**Role:** Graphics_Bot_Researcher  
**Repo:** https://github.com/DavidGrice/graphics-pipeline  
**Local monorepo:** `/workspace/graphics-pipeline/` (npm workspaces; `npm run test:s1`)  
**Date:** 2026-10-24  
**Method:** Official GitHub docs (WebSearch + WebFetch). No invented APIs.  
**Aligns with Designer schematic:** `docs/sprint1.5-ci-branch-schematic.md` (gitflow-lite: feature/bug/enhancement → `dev` → `test` → `main`)

---

## Group-chat-ready summary

- **CI now:** one workflow `.github/workflows/ci.yml` — `pull_request` + `push` to `main`/`dev`/`test` — `npm ci` → `typecheck` → `test:s1`; optional lint; `permissions: contents: read`.
- **Envs `dev`/`test`/`prod`:** create in Settings → Environments; **CI-only** today (no deploy secrets). Later: jobs with `environment:` + protection rules (reviewers, deployment branches). Public repos get full env features; private needs Pro/Team for some env features.
- **Branches:** `feature/*` · `bug/*` · `enhancement/*` → PR into **`dev`**; promote `dev`→`test`→`main`. Protect `main` (and ideally `dev`/`test`) with required checks + PR reviews.
- **`.gitignore`:** already good baseline; harden for keys/`*.pem`, media under `data/**`, models, OS junk; keep schema/docs/scripts/`data/*/.gitkeep` tracked.
- **Security first:** enable **Dependabot** (npm + github-actions), **secret scanning** / **push protection** (free on public; Secret Protection product for private advanced), optional **CodeQL**, CODEOWNERS, never echo secrets in logs.
- **User must click:** Actions enable, create Environments, branch protection/rulesets, Dependabot + secret scanning toggles — see §6 checklist.

**Full brief:** `/workspace/sprint1.5-cicd-security-research.md`

---

## 0. Repo facts (ground truth)

| Fact | Value |
|------|--------|
| Workspaces | `packages/*`, `apps/mcp-krita`, `apps/world-builder`, `apps/world-builder/client` |
| Node | `>=20` (`.nvmrc` = `20`) |
| Key scripts | `build:schema`, `typecheck`, **`test:s1`** (`node --test tests/s1-*.test.mjs`) |
| Existing `.gitignore` | `node_modules/`, `.env`/`.env.*` (keeps `.env.example`), `data/inbox/**` + `data/assets/**` (keeps `.gitkeep`), Python venv, Blender `*.blend1/2` |
| No `.github/workflows` yet | Engineer adds in Sprint 1.5 |

---

## 1. Recommended GitHub Actions workflows

### 1.1 Primary: `ci.yml` (required for every PR)

**Official Node CI pattern:** checkout → setup-node → `npm ci` → build/test  
https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs  

**Triggers (workflow syntax):** https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax  

| Event | Branches | Why |
|-------|----------|-----|
| `pull_request` | targeting `dev`, `test`, `main` | Gate merges |
| `push` | `dev`, `test`, `main` | Verify post-merge tip |
| Optional: `workflow_dispatch` | — | Manual re-run |

**Suggested job steps (monorepo-wide — simple & reliable for this size):**

```yaml
name: CI

on:
  pull_request:
    branches: [dev, test, main]
  push:
    branches: [dev, test, main]
  workflow_dispatch:

permissions:
  contents: read   # least privilege; CI needs no write

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: ".nvmrc"
          cache: npm
      - run: npm ci
      - run: npm run build:schema --if-present
      - run: npm run typecheck --if-present
      - name: Sprint 1 acceptance tests
        run: npm run test:s1
      # Optional later:
      # - run: npm run lint --if-present
```

**Notes for this monorepo:**

- Prefer **full workspace `npm ci` + `test:s1`** over path filters for Sprint 1.5 (small repo; avoids missed shared-package breaks). Path filters can come later.
- Do **not** require Blender/Krita on the runner for `test:s1` (existing tests are Node/facade/format gates per `tests/s1-*.test.mjs`).
- Pin action major versions (`checkout@v6`, `setup-node@v7` as of current GitHub Node tutorial). Re-check tags when implementing.
- `npm ci` requires committed `package-lock.json` (already present).

### 1.2 Optional second workflow: `security-ci.yml` or jobs in same file

| Check | How | When |
|-------|-----|------|
| Forbid tracked binaries under `data/` | Shell: `git ls-files 'data/**'` + fail on `png|glb|fbx|obj|kra|blend` | Every PR |
| Secret scan in CI | Prefer **GitHub secret scanning / push protection** (platform); optional third-party gitleaks *if* licensed/approved — not required if platform scanning is on | Push/PR |
| Dependency review | `actions/dependency-review-action` on `pull_request` (public repos free with Code Security features) | PR only |

### 1.3 What should *not* run yet

- Deploy to hosting / Docker push (no prod targets).
- Jobs that need `environment: prod` secrets (none yet).
- Blender headless matrix (defer to later sprint when pipeline E2E is CI-ready).

---

## 2. Environments: `dev` / `test` / `prod`

### 2.1 How GitHub Environments work

Docs:

- Manage environments: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments  
- Protection rules / deployment branches: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments  

A job that sets `environment: prod` must pass that environment’s **protection rules** before running or reading **environment secrets/vars**.

**Create:** Settings → Environments → New environment → name `dev` | `test` | `prod`.

**Availability note (official):** Users with Free can configure environments for **public** repositories. Private repos need **GitHub Pro** (user) or **Team** (org) for environment configuration; converting public→private can ignore configured rules until upgraded.

### 2.2 Sprint 1.5 recommendation (CI-only)

| Environment | Create now? | Secrets | Protection (now) | Later |
|-------------|-------------|---------|------------------|-------|
| `dev` | Yes | None | Optional: deployment branches = `dev` | Auto-deploy preview |
| `test` | Yes | None | Optional: branches = `test`; 1 reviewer | Staging deploy |
| `prod` | Yes | None yet | **Required reviewers**; branches = `main` only; prevent self-review | Real deploy + secrets |

**CI-only pattern:** workflows do **not** need `environment:` keys until a deploy job exists. Creating empty Environments still documents promotion intent and matches Designer schematic.

**Promotion (no secrets):** merge PR `dev`→`test`→`main`; each merge re-runs `ci.yml`. Environment “promotion” is **branch promotion**, not a separate GitHub deploy object, until you add deploy jobs.

### 2.3 Example future deploy job (do not implement until needed)

```yaml
jobs:
  deploy-prod:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment:
      name: prod
      url: https://example.invalid   # real URL later
    permissions:
      contents: read
    steps:
      - run: echo "Deploy placeholder — secrets via environment only"
```

Required reviewers on `prod` block the job until approval (official manage-environments flow).

---

## 3. Branch conventions & flow

**Aligned with Designer:** gitflow-lite (not pure trunk-only).

```
feature/* | bug/* | enhancement/*
        │ PR
        ▼
       dev  ──PR──►  test  ──PR──►  main (prod-ready)
```

| Prefix | Purpose | Cut from | PR into |
|--------|---------|----------|---------|
| `feature/<slug>` | New capability | `dev` | `dev` |
| `bug/<slug>` | Defect | `dev` (or `main` for hotfix) | `dev` (or `main` + backport) |
| `enhancement/<slug>` | Non-breaking improvement | `dev` | `dev` |

**Slug:** kebab-case (`feature/mcp-health-strict`).

**Trunk alternative (if team prefers later):** single `main` + short-lived feature branches; Environments still map to deploy targets. Current Designer lock = **env branches** — stick with that for Sprint 1.5.

**Protection targets:**

| Branch | Require PR | Require status check `CI / build-test` | Require review |
|--------|------------|----------------------------------------|----------------|
| `main` | Yes | Yes | Yes (1+) |
| `test` | Yes | Yes | Preferred |
| `dev` | Yes | Yes | Preferred (1) |

Classic branch protection: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule  
Rulesets (org/repo scale): https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets  

---

## 4. Hardened `.gitignore` (privacy-first)

**Current file is a solid start.** Engineer should extend (not replace) toward:

### MUST ignore (secrets & PII)

```
# Env / secrets
.env
.env.*
!.env.example
!.env.*.example

# Keys & credentials
*.pem
*.key
*.p12
*.pfx
id_rsa*
*.keystore
credentials.json
**/secrets/**
**/*secret*
!**/*.md
```

(Be careful with broad `*secret*` — prefer explicit paths if false positives; Designer’s “fail closed” media guard in CI is the backstop for binaries.)

### MUST ignore (dependencies & build)

```
node_modules/
.pnpm-store/
dist/
build/
*.tsbuildinfo
.vite/
coverage/
.nyc_output/
```

### MUST ignore (pipeline media / models — privacy + repo size)

```
# Runtime data (keep placeholders)
data/inbox/**
!data/inbox/.gitkeep
data/assets/**
!data/assets/.gitkeep

# Media / 3D / DCC (anywhere accidental)
*.png
*.jpg
*.jpeg
*.webp
*.gif
*.psd
*.kra
*.glb
*.gltf
*.fbx
*.obj
*.mtl
*.blend
*.blend1
*.blend2
*.exr
*.hdr

# ML / large model weights
*.pt
*.pth
*.onnx
*.safetensors
*.ckpt
*.bin
models/**
```

**CI note:** Ignoring `*.png` globally means **tracked fixtures** under `tests/fixtures/` must use **git-forced exceptions** or non-binary fixtures. Prefer:

```
# Allow tiny test fixtures only
!tests/fixtures/**
```

Or keep media ignore scoped to `data/**` + explicit root `exports/` and allow fixtures — **Tester/Engineer decide**; recommend **scope media bans to `data/`** first (matches current gitignore) and add a CI `git ls-files` guard for accidental media elsewhere.

### OS / IDE

```
.DS_Store
Thumbs.db
Desktop.ini
.idea/
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json.example
```

### SHOULD stay tracked

| Keep | Why |
|------|-----|
| `packages/asset-schema/**` | Contract |
| `apps/**` source + READMEs | Product |
| `docs/**` | Design/QA/research |
| `tests/**` (non-huge fixtures) | `test:s1` |
| `package-lock.json` | Reproducible `npm ci` |
| `.env.example` | Document required vars **without values** |
| `data/inbox/.gitkeep`, `data/assets/.gitkeep` | Preserve dirs |
| `.github/workflows/**`, `dependabot.yml`, `CODEOWNERS` | CI/security |

---

## 5. Security (foremost)

### 5.1 Secret scanning & push protection

- Overview: https://docs.github.com/en/code-security/getting-started/github-security-features  
- Push protection: https://docs.github.com/en/code-security/concepts/secret-security/push-protection  

| Feature | Public repo | Private |
|---------|-------------|---------|
| Partner secret scanning alerts | Yes | Limited / product |
| User secret scanning alerts | Free on public | GitHub Secret Protection |
| Push protection (repo) | Available on public by default (per docs) | Secret Protection |
| Push protection for users | On by default for pushes to **public** repos | Account setting |

**Action:** Settings → Code security → enable **Secret scanning** + **Push protection** if shown. Do not bypass casually; rotate any leaked token.

### 5.2 Dependabot (npm)

Docs: https://docs.github.com/en/code-security/getting-started/github-security-features  
Config reference: https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file  

Suggested `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
```

Also enable **Dependabot alerts** + **security updates** in Settings (UI). Security updates open PRs for vulnerable deps; version updates keep npm + Actions pins current.

### 5.3 CodeQL (optional Sprint 1.5)

- Available for **public** repositories by default (Code Security features).  
- https://docs.github.com/en/code-security/getting-started/github-security-features  
- Merge protection via rulesets requiring CodeQL results: https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/set-merge-protection  

Recommend: enable default CodeQL workflow for JS/TS if repo is public; don’t block Sprint 1.5 delivery if setup lags — make it a Tester AC stretch.

### 5.4 `GITHUB_TOKEN` least privilege

- https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/use-github_token-in-workflows  
- Hardening: https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/security-hardening-for-github-actions  

For CI-only: workflow-level `permissions: contents: read`. Raise only per-job when publishing packages (`packages: write`) later. Prefer repo/org default **read-only** token.

**Never** print secrets; don’t put structured JSON blobs as a single secret (redaction can fail — official hardening guide).

### 5.5 CODEOWNERS sketch

Docs: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners  

Place `.github/CODEOWNERS` (owners need **write** access):

```
# Default
*                         @DavidGrice

# CI / security sensitive
.github/workflows/        @DavidGrice
.github/dependabot.yml    @DavidGrice
.gitignore                @DavidGrice

# Schema & contracts
packages/asset-schema/    @DavidGrice
docs/                     @DavidGrice
```

Replace/add teammates (`@user`) when write access is granted. Enable “Require review from Code Owners” on protected branches when ready.

### 5.6 Branch protection on `main`

Require:

1. Pull request before merging  
2. Required status checks → job name from `ci.yml` (e.g. `build-test`)  
3. Require branches to be up to date (optional but good)  
4. Do not allow bypass without admin policy  

---

## 6. User checklist (what **you** must click)

Repo: https://github.com/DavidGrice/graphics-pipeline  

| # | Action | Where |
|---|--------|-------|
| 1 | Ensure **Actions** allowed (Allow all / Allow local actions) | Settings → Actions → General |
| 2 | Set **Workflow permissions** → Read repository contents; optionally “Require approval for first-time contributors” | Settings → Actions → General |
| 3 | Create Environments **`dev`**, **`test`**, **`prod`** | Settings → Environments |
| 4 | On **`prod`**: Required reviewers; Deployment branches = `main` only; Prevent self-review | Environment configure |
| 5 | Create branches **`dev`**, **`test`** from `main` if missing | Branches UI / git push |
| 6 | Protect **`main`** (and ideally `dev`/`test`): require PR + required check `CI` | Settings → Branches or Rulesets |
| 7 | Enable **Dependabot alerts** + **Dependabot security updates** | Settings → Code security |
| 8 | Enable **Secret scanning** + **Push protection** (if available for visibility/plan) | Settings → Code security |
| 9 | Optional: enable **CodeQL** default setup | Settings → Code security → Code scanning |
| 10 | Grant collaborators **write**; ensure CODEOWNERS users have write | Settings → Collaborators |
| 11 | After Engineer merges workflow: confirm Actions tab runs green on a sample PR | Actions |

No deploy secrets required for Sprint 1.5.

---

## 7. Thin Sprint 1.5 story titles

**Designer**

- S1.5-D1: Finalize CI/env/branch schematic in-repo (done/extend `docs/sprint1.5-ci-branch-schematic.md`)  
- S1.5-D2: PR template + commit/branch naming cheat-sheet for contributors  

**Engineer**

- S1.5-E1: Add `.github/workflows/ci.yml` (`npm ci`, typecheck, `test:s1`, `permissions: contents: read`)  
- S1.5-E2: Harden `.gitignore` + CI guard against tracked `data/**` media  
- S1.5-E3: Add `.github/dependabot.yml` (npm + github-actions)  
- S1.5-E4: Add `.github/CODEOWNERS` + `.env.example` audit (no real secrets)  

**Tester**

- S1.5-T1: AC — PR to `dev` fails without green CI; passes with `test:s1`  
- S1.5-T2: AC — committing a PNG under `data/assets/` is blocked by gitignore and/or CI guard  
- S1.5-T3: AC — Dependabot config present; document secret-scanning enablement status  
- S1.5-T4: Smoke — Actions run on `ubuntu-latest` without Blender/Krita installed  

**Leader / User**

- S1.5-L1: Execute §6 click checklist; announce `dev`/`test`/`main` protection live  

---

## 8. Primary doc URLs

| Topic | URL |
|-------|-----|
| Node.js CI tutorial | https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs |
| Workflow syntax | https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax |
| Triggering workflows | https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow |
| Manage environments | https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments |
| Deployments & environments reference | https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments |
| GITHUB_TOKEN / permissions | https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/use-github_token-in-workflows |
| Security hardening for Actions | https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/security-hardening-for-github-actions |
| GitHub security features overview | https://docs.github.com/en/code-security/getting-started/github-security-features |
| Push protection | https://docs.github.com/en/code-security/concepts/secret-security/push-protection |
| Dependabot `dependabot.yml` options | https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file |
| CODEOWNERS | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners |
| Branch protection rules | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule |
| Code scanning merge protection | https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/set-merge-protection |

---

## 9. Engineer copy-paste priorities (S1.5-E1 order)

1. Commit `ci.yml` as above; open PR `feature/ci-workflow` → `dev`.  
2. User enables required check once first run appears.  
3. `dependabot.yml` + `.gitignore` harden in follow-up PR.  
4. Leave `environment:` deploy jobs for post-MVP.

---

*End of Sprint 1.5 research. Ready for Leader to assign E/T stories; User executes §6.*
