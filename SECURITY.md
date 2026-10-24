# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Email or message the maintainer (**@DavidGrice**) privately with:

- A description of the issue
- Steps to reproduce
- Impact assessment (if known)

We will acknowledge reports as soon as practical and coordinate a fix before any public disclosure.

## Scope

This repository is a local graphics pipeline (Krita MCP → Blender → MERN/R3F). Please report:

- Leaked secrets / credentials in the tree or Actions logs
- Dependency vulnerabilities with a clear exploit path in our apps
- Supply-chain issues in committed lockfiles or workflows

## Hardening (repo defaults)

- Never commit `.env`, keys (`*.pem`, `*.key`), or pipeline media under `data/`
- CI runs with `permissions: contents: read`
- Prefer GitHub **secret scanning** + **push protection** (enable in Settings → Code security)
- Dependabot version updates: see `.github/dependabot.yml`

## Environments

GitHub Environments `dev` / `test` / `prod` are intended for future deploy jobs. Sprint 1.5 is **CI-only** — no deploy secrets required yet.
