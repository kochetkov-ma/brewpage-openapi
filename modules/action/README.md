# brewpage-action

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-action`](https://github.com/kochetkov-ma/brewpage-action) -- not created yet (TaskList #8).
> Once created, this folder becomes a git submodule. Development is coordinated from `brewpage-openapi` via the `action-engineer` subagent (`.claude/agents/action-engineer.md`).
> Note: separate dev repo keeps `@v1` semantics clean for Actions Marketplace.

**Status:** SCAFFOLD -- repo not yet created.

**Intent.** Publish CI artefacts -- HTML reports, Playwright reports, generated docs, build outputs -- to BrewPage from GitHub Actions. One step, one live URL as a job output.

**Channel.** GitHub Actions Marketplace.

**Depends on.** `brewpage-cli` (npm). Action shells out to `npx brewpage` for now; may go native JS later.

**Planned inputs.**
- `path` (required) -- file, dir, or zip.
- `kind` -- `html` | `markdown` | `site` | `file` | `auto` (default `auto`).
- `namespace` -- default `public`.
- `password` -- optional, marks private.
- `ttl-days` -- 1..30, default 15.
- `update-token` + `update-id` -- update existing resource.

**Planned outputs.**
- `url` -- live URL.
- `owner-token` -- masked via `::add-mask::`.
- `id` -- resource id.

**Release.** Inside dev repo: tag `vX.Y.Z` -> Marketplace update.

**Usage (once published).**
```yaml
- uses: kochetkov-ma/brewpage-action@v1
  with:
    path: ./playwright-report
    kind: site
```

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- TBD (TaskList #8)
- Subagent -- ../../.claude/agents/action-engineer.md
