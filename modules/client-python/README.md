# brewpage-client-python

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-client-python`](https://github.com/kochetkov-ma/brewpage-client-python) -- not created yet (TaskList #2).
> Once created, this folder becomes a git submodule. Development is coordinated from `brewpage-openapi` via the `client-python-engineer` subagent (`.claude/agents/client-python-engineer.md`).

**Status:** SCAFFOLD -- repo not yet created.

**Intent.** Shared Python SDK over the BrewPage REST API. Sync + async. Foundation for `cli-python` and external Python apps / agents.

**Channel.** PyPI. Package name: `brewpage-client`.

**Depends on.** `openapi/openapi.yaml` from this repo.

**Planned surface.**
- `BrewpageClient(base_url=..., user_agent=...)` (sync).
- `AsyncBrewpageClient(...)` (async via `httpx.AsyncClient`).
- `publish_html`, `publish_markdown`, `publish_file`, `publish_site`, `update`, `delete`, `get_stats`.
- Typed exceptions: `BrewpageError`, `RateLimitError`, `NotFoundError`.
- Python 3.10+. `py.typed` marker. Fully typed.

**Release.** Inside dev repo: tag `vX.Y.Z` -> CI publishes via PyPI Trusted Publishing (no API token).

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- TBD (TaskList #2)
- Subagent -- ../../.claude/agents/client-python-engineer.md
