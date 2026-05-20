# brewpage-docs (user-facing full docs)

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-docs`](https://github.com/kochetkov-ma/brewpage-docs) -- not created yet (TaskList #9).
> Once created, this folder becomes a git submodule. No subagent owns this yet -- the existing `astro-content-writer` and `astro-platform-engineer` agents (team `brewpage-openapi`) will likely cover it during migration.

**Status:** SCAFFOLD -- repo not yet created.

**Intent.** User-facing full documentation for the BrewPage ecosystem. Astro + Tailwind + Scalar (same stack as the existing `docs/` site in this repo). Targets end users, not developers integrating the API -- developer docs live inside each module repo.

**Channel.** GitHub Pages or Cloudflare Pages. Route TBD (see Open question 3 in `../../ECOSYSTEM-PLAN.md`): either `brewpage.app/docs` or `docs.brewpage.app`.

**Migration plan.** The existing `docs/` site in this repo currently deploys to GitHub Pages via `.github/workflows/docs.yml`. Migration steps (open question 2 in the master plan):
1. Create `brewpage-docs` repo with current `docs/` content as starting commit.
2. Replicate the Pages workflow inside `brewpage-docs`.
3. Cut over Pages source.
4. Remove `docs/` from this repo (or leave as redirect stub).

**Content scope.**
- Getting started / quickstart.
- API reference (rendered from `brewpage-openapi/openapi/openapi.yaml`).
- Module pages -- one per module, summarizing the dev repo.
- Category landing pages from `.claude/features/deep-research-report.md` (host-claude-artifacts, host-chatgpt-canvas-html, etc.).
- Cross-links to brewpage.app and to every module's marketplace listing.

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Existing docs site source (pre-migration) -- ../../docs/
- Dev repo -- TBD (TaskList #9)
