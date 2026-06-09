# brewpage-action

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-action`](https://github.com/kochetkov-ma/brewpage-action) -- live.
> This folder is a reference snapshot, not a git submodule (no-submodules strategy, locked 2026-05-20). Development is coordinated from `brewpage-openapi` via the `action-engineer` subagent (`.claude/agents/action-engineer.md`).
> Note: separate dev repo keeps `@v1` semantics clean for Actions Marketplace.

**Status:** LIVE -- published to the GitHub Actions Marketplace. Current release `v1.0.2`; major ref `@v1` points to it.

**Intent.** Publish CI artefacts -- HTML reports, Playwright reports, generated docs, build outputs -- to BrewPage from GitHub Actions. One step, one live URL as a job output.

**Channel.** GitHub Actions Marketplace -- https://github.com/marketplace/actions/publish-to-brewpage

**Architecture.** A `node24` TypeScript action (`runs.using: node24`, `main: dist/index.js`, committed bundle). NOT a composite action. It calls the BrewPage REST API directly via native `fetch`/`FormData`/`Blob` (Node 24) -- zero HTTP dependencies; the only runtime dependency is `@actions/core`. It does NOT depend on `brewpage-cli` or `npx brewpage`.

**Owner-token flow.** If `owner-token` is not supplied it is auto-minted (`GET /api/owner-token`), masked via `core.setSecret`, and surfaced in the job summary so it can be persisted as a secret. Create uses `POST`; update uses `PUT` when both `owner-token` and `update-id` are set.

**Inputs** (mirrors `action.yml` exactly).
- `path` (required) -- file, directory, or `.zip`.
- `kind` (default `auto`) -- `html` | `markdown` | `site` | `file` | `auto`.
- `namespace` (default empty -> deterministic per-repo slug) -- `public` is gallery-listed on brewpage.app + search-indexed.
- `password` (default empty) -- set -> private, hidden from gallery.
- `ttl-days` (default `15`) -- 1..30.
- `tags` (default empty) -- comma-separated.
- `owner-token` (default empty) -- `X-Owner-Token`; empty -> auto-minted + surfaced.
- `update-id` (default empty) -- with `owner-token` -> updates existing resource (PUT).
- `entry` (default empty) -- site entry file override (default `index.html`).
- `show-top-bar` (default empty) -- html only; toolbar toggle.
- `brewpage-url` (default empty) -- API base override; empty -> https://brewpage.app.
- `fail-on-error` (default `true`) -- `false` -> warn instead of failing.

**Outputs** (mirrors `action.yml` exactly).
- `url` -- live URL on brewpage.app.
- `owner-url` -- API/owner URL.
- `owner-token` -- masked (`core.setSecret`); persist to a secret.
- `id` -- resource id.
- `namespace` -- resolved namespace.
- `expires-at` -- expiry timestamp.

**Release.** Automated, tag-based. Bump `package.json`, push an annotated tag `vX.Y.Z` -> `release.yml` builds/lints/tests, verifies the committed `dist/`, creates a GitHub Release (marketplace link + usage snippet + README link prepended to the changelog), and force-moves the major tag `v1`.

**Usage.**
```yaml
- uses: kochetkov-ma/brewpage-action@v1
  with:
    path: ./playwright-report
    kind: site
```

**Links.**
- BrewPage -- https://brewpage.app
- Marketplace -- https://github.com/marketplace/actions/publish-to-brewpage
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- https://github.com/kochetkov-ma/brewpage-action
- Subagent -- ../../.claude/agents/action-engineer.md
