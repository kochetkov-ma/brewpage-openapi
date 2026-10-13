# brewpage-cookbook

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-cookbook`](https://github.com/kochetkov-ma/brewpage-cookbook) -- live. Local clone is the user's responsibility.
> Development happens in the dev repo with its own agent team (`.claude/agents/` there, including `cookbook-author`); this folder is a reference stub.
> Note: per `ECOSYSTEM-PLAN.md` -- per-repo + reference folder, no git submodules. Plain files in master.

**Status:** RELEASED -- the first recipe (RAG Guide) is published on `brewpage.app`; each release is an unprefixed `vX.Y.Z` tag ([releases](https://github.com/kochetkov-ma/brewpage-cookbook/releases)).

**Intent.** Standalone product brand: **BrewPage Cookbook** -- interactive guides, recipes, mini-apps and demos for AI artifact workflows. Each entry is a self-contained interactive artifact published to BrewPage. First recipe: a long-form RAG guide (12 pages, plain static HTML + vanilla JS, inline-SVG drill-down diagrams, mini-games, calculators, client-side search; EN default, RU via the language toggle). Target: ~40 recipes covering AI artifact patterns, agent workflows, content hosting, MCP integrations.

**Why a separate product.** Three reasons: (1) own release cadence, decoupled from OpenAPI/MCP `vX.Y.Z`; (2) first production consumer of `brewpage-action` -- true end-to-end dogfood, not same-repo loopback; (3) standalone SEO entity per `deep-research-report.md` (templates/starters as P1 growth lever).

**Channel.** Published to BrewPage hosting via `brewpage-action` (multi-file site publish). Each recipe is its own published URL on `brewpage.app` (or a custom subdomain when curation matures). Source on GitHub for OSS visibility.

**Stack.** Plain static HTML + minimal vanilla JavaScript (ES modules) + hand-written CSS (CSS variables). No framework, no bundler, no build step -- a recipe folder ships exactly as authored.

**Precedent.** [`anthropic-cookbook`](https://github.com/anthropics/anthropic-cookbook) (RAG + AI guides as recipes), Stripe Press (standalone editorial brand), Vercel templates.

**Depends on.**
- `brewpage-action` -- publish step in CI (released). Fallbacks: `brewpage` CLI (`modules/cli-node/`) once it ships, then direct REST.
- BrewPage REST API (this repo's `openapi/openapi.yaml`).

**Recipes.**
- `rag-guide` -- interactive RAG walkthrough with drill-down diagrams + mini-games (first recipe); live at https://brewpage.app/public/FsOfbLP4df.
- More TBD; target ~40 over time.

**Release flow.**
- Own repo, own tags `vX.Y.Z` (unprefixed), own CI workflow (`.github/workflows/publish-recipe.yml`).
- Push of a `vX.Y.Z` tag -> `kochetkov-ma/brewpage-action` pinned to an exact version (site update, no build step) -> same live URL per recipe + GitHub Release.
- A push to `main` only lands content and publishes nothing; the live site changes when a tag is pushed.

**Cross-links.** Every recipe README and published page back-links to:
- `https://brewpage.app`
- `https://github.com/kochetkov-ma/brewpage-openapi` (OpenAPI contract)
- `https://github.com/kochetkov-ma/brewpage-cookbook` (dev repo)

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- https://github.com/kochetkov-ma/brewpage-cookbook
- Agents -- https://github.com/kochetkov-ma/brewpage-cookbook/tree/main/.claude/agents
