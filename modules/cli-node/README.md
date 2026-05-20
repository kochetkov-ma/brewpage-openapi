# brewpage-cli (Node)

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-cli`](https://github.com/kochetkov-ma/brewpage-cli) -- not created yet (TaskList #3).
> Once created, this folder becomes a git submodule. Development is coordinated from `brewpage-openapi` via the `cli-node-engineer` subagent (`.claude/agents/cli-node-engineer.md`).

**Status:** SCAFFOLD -- repo not yet created.

**Intent.** One-shot publish from the terminal. The fastest npm-discoverable entry point for non-MCP users.

**Channel.** npm. Package name: `brewpage` (fallback: `brewpage-cli`).

**Discovery.**
- `npx brewpage publish ./report.html`
- `npm i -g brewpage && brewpage publish ...`

**Depends on.** `brewpage-client` (npm).

**Planned commands.**
- `brewpage publish <file>` -- HTML / Markdown / JSON / file -> live URL.
- `brewpage publish-site <dir|zip>` -- multi-file site.
- `brewpage update <id> <file>` -- in-place via owner token.
- `brewpage delete <id>` -- via owner token.
- `brewpage info <id>` -- stats / metadata.
- `brewpage list` -- own resources (owner-token scoped).
- Flags: `--ns`, `--password`, `--ttl-days`, `--json`. Stdin via `-`.

**Release.** Inside dev repo: tag `vX.Y.Z` -> CI publishes to npm with `--provenance`.

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- TBD (TaskList #3)
- Subagent -- ../../.claude/agents/cli-node-engineer.md
