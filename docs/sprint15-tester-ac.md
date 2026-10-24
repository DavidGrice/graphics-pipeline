# Sprint 1.5 Acceptance Criteria — S15-T1–T4

**Role:** Graphics_Bot_Tester  
**Against:** `docs/sprint1.5-cicd-security-research.md` + `docs/sprint1.5-ci-branch-schematic.md`  
**Repo:** https://github.com/DavidGrice/graphics-pipeline  
**Date:** 2026-10-24

## S15-T1 — CI green on PR

1. PR into `dev` (promotion path `dev` → `test` → `main`) from `feature/*` · `bug/*` · `enhancement/*` runs `.github/workflows/ci.yml`.
2. Job: `npm ci` → typecheck/build schema → `npm run test:s1` (`contents: read` only).
3. PR **fails** if any non-skipped test fails; API skips OK without a service container.
4. Required check on `main` (once user enables branch protection): this CI job.

**Pass:** `enhancement/s15-cicd` (or similar) PR shows green CI.  
**Fail:** Missing workflow, red with no tests, or CI not triggered.

## S15-T2 — Fail-closed on secrets & assets

1. `.gitignore` blocks: `.env*`, keys/`*.pem`, `node_modules/`, `data/inbox/**` & `data/assets/**` media (`png/glb/fbx/obj/kra/blend`) while keeping `.gitkeep`.
2. CI `git ls-files` guard **fails** if a forbidden path is tracked (deliberate bad commit cannot stay green).
3. Secret scanning / push protection documented; gitleaks or native scanning as implemented — fixtures allowlisted only if explicit.
4. Workflows do not print secret material.

**Pass:** Planting `data/assets/x/model.glb` or `.env` in a PR fails CI or is untrackable via ignore+guard.  
**Fail:** Bad asset/secret PR is green.

## S15-T3 — Security baseline present

1. Dependabot config for npm (+ Actions if in brief) is in-repo.
2. CODEOWNERS covers `.github/workflows/**` and `.gitignore` (or documented equivalent).
3. Docs state Environments `dev`/`test`/`prod` and user enablement checklist (secret scanning, branch protection).
4. LICENSE/NOTICE intact; no GPL plugin sources in MIT server tree.

**Pass:** Files exist and match research brief.  
**Fail:** Missing Dependabot/CODEOWNERS with no doc exception.

## S15-T4 — CI smoke without Blender/Krita

1. Actions on `ubuntu-latest` completes without installing Blender or Krita.
2. T3.4/T3.5 style pipeline error tests still pass; live Krita/Blender paths remain deferred.

**Pass:** Green CI on GitHub-hosted runner with no graphics apps.  
**Fail:** Workflow requires `blender`/`krita` on PATH.

## DoD

Execute T1–T4 against the `enhancement/s15-cicd` PR once Engineer lands E1–E3; write `docs/sprint15-qa-results.md`.
