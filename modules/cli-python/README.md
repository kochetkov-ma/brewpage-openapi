# brewpage-cli-python

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-cli-python`](https://github.com/kochetkov-ma/brewpage-cli-python) -- not created yet (TaskList #4).
> Once created, this folder holds a plain snapshot of it (no git submodules).

**Status:** SCAFFOLD -- repo not yet created.

**Intent.** Python-native CLI. Mirrors `brewpage-cli` (Node) UX byte-for-byte so docs and muscle memory transfer.

**Channel.** PyPI. Package name: `brewpage` (fallback: `brewpage-cli`).

**Discovery.**
- `pip install brewpage`
- `pipx install brewpage`
- `uv tool install brewpage`

**Depends on.** `brewpage-client` (PyPI).

**Planned commands.** Mirror `brewpage-cli` (Node), same flags. Its v0.1.0 has only `publish` (file or stdin, `--public`, `--ttl`, `--format`); site, update and delete land in the Node CLI first, on real use.

**Release.** Inside dev repo: tag `vX.Y.Z` -> CI publishes to PyPI via Trusted Publishing.

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- TBD (TaskList #4)
