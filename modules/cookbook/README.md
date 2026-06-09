# brewpage-cookbook

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-cookbook`](https://github.com/kochetkov-ma/brewpage-cookbook) -- created, empty. Local clone is the user's responsibility.
> Development is coordinated from `brewpage-openapi`. Subagent: TBD (`cookbook-author`). During bootstrap, `astro-content-writer` + `astro-platform-engineer` cover MDX/Astro work.
> Note: per `ECOSYSTEM-PLAN.md` -- per-repo + reference folder, no git submodules. Plain files in master.

**Status:** SCAFFOLD -- repo created, no content yet.

**Intent.** Standalone product brand: **BrewPage Cookbook** -- interactive guides, recipes, mini-apps and demos for AI artifact workflows. Each entry is a self-contained interactive artifact published to BrewPage. First recipe: a long-form RAG guide (~15 pages, Astro + React, C4 with drill-down, mini-games, client-side search). Target: ~40 recipes covering AI artifact patterns, agent workflows, content hosting, MCP integrations.

**Why a separate product.** Three reasons: (1) own release cadence -- content ships weekly, decoupled from OpenAPI/MCP `vX.Y.Z`; (2) first production consumer of `brewpage-action` -- true end-to-end dogfood, not same-repo loopback; (3) standalone SEO entity per `deep-research-report.md` (templates/starters as P1 growth lever).

**Channel.** Published to BrewPage hosting via `brewpage-action` (multi-file site publish). Each recipe is its own published URL on `brewpage.app` (or a custom subdomain when curation matures). Source on GitHub for OSS visibility.

**Stack.** Astro 5 + React (interactive islands) + Tailwind + daisyUI. Mirrors `docs/` patterns in `brewpage-openapi` where applicable.

**Precedent.** [`anthropic-cookbook`](https://github.com/anthropics/anthropic-cookbook) (RAG + AI guides as recipes), Stripe Press (standalone editorial brand), Vercel templates.

**Depends on.**
- `brewpage-action` -- publish step in CI. While the action is pre-release, recipes publish via `brewpage` CLI (`modules/cli-node/`) or direct REST.
- BrewPage REST API (this repo's `openapi/openapi.yaml`).

**Planned recipes (initial slate).**
- `rag-guide` -- interactive RAG walkthrough with C4 drill-down + mini-games (first recipe).
- More TBD; target ~40 over time.

**Release flow (planned).**
- Own repo, own tags `vX.Y.Z` (unprefixed), own CI workflow.
- Push to `main` -> `npm run build` -> `kochetkov-ma/brewpage-action@v1` -> live URL per recipe.
- Content-only PRs do not require a new tag; tag bumps mark curated milestones.

**Cross-links.** Every recipe README and published page back-links to:
- `https://brewpage.app`
- `https://github.com/kochetkov-ma/brewpage-openapi` (OpenAPI contract)
- `https://github.com/kochetkov-ma/brewpage-cookbook` (dev repo)

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- https://github.com/kochetkov-ma/brewpage-cookbook
- Subagent -- TBD (`cookbook-author`)
