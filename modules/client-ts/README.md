# brewpage-client-ts

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-client-ts`](https://github.com/kochetkov-ma/brewpage-client-ts) -- not created yet (TaskList #1).
> Once created, this folder becomes a git submodule. Development is coordinated from `brewpage-openapi` via the `client-ts-engineer` subagent (`.claude/agents/client-ts-engineer.md`).

**Status:** SCAFFOLD -- repo not yet created.

**Intent.** Shared, framework-free TypeScript SDK over the BrewPage REST API. Foundation package -- consumed by `cli-node`, `ext-vscode`, `ext-chrome`.

**Channel.** npm. Package name: `brewpage-client`.

**Depends on.** `openapi/openapi.yaml` from this repo (contract source of truth).

**Planned surface.**
- `BrewpageClient({ baseUrl?, userAgent })`.
- `publishHtml`, `publishMarkdown`, `publishFile`, `publishSite`, `update`, `delete`, `getStats`.
- Typed error class with `status`, `code`, `retryAfter`.
- ESM + CJS dual build. Zero runtime deps. Node 18+ global `fetch`.

**Release.** Inside dev repo: tag `vX.Y.Z` -> CI publishes to npm with `--provenance`.

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- TBD (TaskList #1)
- Subagent -- ../../.claude/agents/client-ts-engineer.md
