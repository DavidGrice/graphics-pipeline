# S3-G D2: contracts, codes and behaviour notes

**Pack:** `enhancement/s3g-growth-t7` from `c560e22`, CO-0 `8e8940c` first. Bound to R1 `docs/sprint3g-brief.md`; R1 is the full contract and this doc only confirms codes and adds design notes.

## Codes (confirmed: none new)
| Code | Where reused |
|---|---|
| `CONFIG_INVALID` | #72 (`WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_ALLOW_HTTP`), #78 (`INBOX_TTL_HOURS`), names the variable, never the value |
| `LINT_FAILED` (exit 1) | CO-2 `changelog:verify` mismatch, #150 mermaid parse error (file:line) |
| `VALIDATION` | CO-3: every importMeta 400 carries `field` = first failing dotted path, e.g. `importMeta.source` |
| `SKIP_PLATFORM` | CO-2 on a shallow clone |
| `SCENE_NODES_MAX` | #29 batch restore over the cap (whole batch refused) |

Still exactly 6 `SKIP_*` codes. Schema stays 3. OpenAPI stays 0.7.0 (no routes added; #44 and #84 are client routes).

## New env
`INBOX_TTL_HOURS` (1–8760, default 168), `WEBHOOK_URL`, `WEBHOOK_SECRET` (≥ 16 chars), `WEBHOOK_ALLOW_HTTP`, `WEBHOOK_ALLOW_PRIVATE` (test-only, documented as dangerous), plus `VITE_PORT` (default 5173) and `WB_API_PORT` (default 8787) so the UI suite can run on non-default ports (approved deviation 1). All in `.env.example` and `docs/contract-changelog.md`.

## New activity kinds
`inbox.sweep {removed, kept}` (only when removed > 0), `webhook.refused {reason}`, `webhook.failed`. These three carry **no `id` or `slug`** (approved E1 interpretation 5); the parser accepts that. No URL, IP, path or secret in any entry. Added to the #128 enum.

**E2 labels (activity panel and #44 health page):**
| kind | Row text | Link |
|---|---|---|
| `inbox.sweep` | "Swept inbox: N removed" (N = `removed`) | none, plain text |
| `webhook.refused` | "Webhook refused (reason)", e.g. "Webhook refused (redirect)" | none |
| `webhook.failed` | "Webhook failed" | none |
Rows without `id` render as plain text in the muted system style (same as tombstoned targets), with the relative time and ISO `title` like every row. Unknown future kinds fall back to the raw `kind` text, never an error.

**Webhook scope:** fires on non-scene `asset.register` and `asset.delete` only, not scene saves. `WEBHOOK_ALLOW_PRIVATE=1` is test-only: logs a startup warning, never set in `.env.example` or in CI outside the guard tests.

## Behaviour notes
- **CO-0:** `yaml` root devDependency, `npm ci` in lint + secrets (`8e8940c`).
- **CO-1:** lane regex accepts `E[123]` plus one optional `[a-z]` suffix, case-insensitive, word-bounded; `E10`, `E4`, `ae1`, `node22` don't match.
- **CO-4:** `data-scene-ready` is `"1"` after first frame and scene applied, `"0"` on change. `test:ui:repeat` and the Node 24 double-run job fail on any flip.
- **#72:** fire-and-forget after the response, 3 s timeout, one retry after 1 s; redirects refused, every A/AAAA vetted and the IP pinned; HMAC header `X-Webhook-Signature: sha256=<hex>`.
- **#78:** sweep only `*.png` directly in the inbox, no symlinks, referenced files kept.
- **#36/#29:** client-only until Save; batches are one undo step; save marker drives the dirty indicator.
- **CI UI job:** root devDependency `playwright-core` drives the runner's own Chrome; no browser download step (deviation 2). The #148 test expects an S3-G section (deviation 3).
- **CO-5:** `ci.yml` gains a `push` trigger on `enhancement/**` (E3). A pack PR then runs both push and pull_request; both must be green.
- **#150:** mermaid lint uses pinned `mermaid` `parse()` under `jsdom` (offline, parse-only), since `@mermaid-js/parser` rejects flowcharts; devDependencies only, no network; covers every tracked `*.md` in the repo (Leader ruling), including the 6 existing blocks, `docs/pipeline.md`, `AGENTS.md` and any root docs.
- **CO-1 follow-up:** lane tags may be followed by `-` (`e1b-thing` maps to E1).
- **FULL PASS gate:** the tip's live CI run is green (pack pushes need `workflow_dispatch` until triggers cover `enhancement/**`).
