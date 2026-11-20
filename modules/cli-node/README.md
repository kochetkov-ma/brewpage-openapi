# brewpage-cli (Node)

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-cli`](https://github.com/kochetkov-ma/brewpage-cli) -- not created yet (TaskList #3).
> Once created, this folder holds a plain snapshot of it (no git submodules). Development is coordinated from `brewpage-openapi` via the `cli-node-engineer` subagent (`.claude/agents/cli-node-engineer.md`).

**Status:** SCAFFOLD -- repo not yet created.

**Intent.** One-shot publish from the terminal. The fastest npm-discoverable entry point for non-MCP users.

**Channel.** npm. Package name: `brewpage` (fallback: `brewpage-cli`).

**Discovery.**
- `npx brewpage publish ./report.html`
- `npm i -g brewpage && brewpage publish ...`

**Depends on.** The public REST API directly (reads `/api/limits`); reuses the `brewpage-mcp` HTTP publish client and login behaviour. No new SDK first: `brewpage-client` is unpublished.

**First release.** `brewpage publish <file|->` -- file or stdin with explicit visibility and TTL -> prints the returned `link` unchanged. Tokens never as arguments, on stdout or in logs.

**Later, on real use.** Site folder/ZIP, structured output, update/delete.

**Release.** Inside dev repo: tag `vX.Y.Z` -> CI publishes to npm with `--provenance` (Trusted Publishing). Homebrew formula in `kochetkov-ma/homebrew-brew` follows ([cli-homebrew](../cli-homebrew/README.md)).

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- TBD (TaskList #3)
- Subagent -- ../../.claude/agents/cli-node-engineer.md
