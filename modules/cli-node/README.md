# brewpage-cli (Node)

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-cli`](https://github.com/kochetkov-ma/brewpage-cli) (public, Apache-2.0; TaskList #3). Code, tests, CI and releases live there.
> This folder stays a short stub until a plain snapshot is worth carrying (no git submodules).

**Status:** IN PROGRESS -- repo created, v0.1.0 not released yet.

**Intent.** One-shot publish from the terminal: a file or stdin in, one share link out. For people who do not use MCP.

**Channel.** GitHub Release + owner Homebrew tap first: `brew install kochetkov-ma/brew/brewpage` ([cli-homebrew](../cli-homebrew/README.md)). npm package `brewpage` (fallback `brewpage-cli`, command stays `brewpage`) after the owner's first publish (decision 2026-11-20 in the [master plan](../../ECOSYSTEM-PLAN.md)).

**Usage.**
- `brewpage ./report.html` or `... | brewpage -`
- `npx brewpage ...` / `npm i -g brewpage` only once npm `brewpage` is published.

**Depends on.** The public REST API directly (reads `/api/limits` first); Node >= 22, no runtime dependencies. Copies a few `brewpage-mcp` patterns (multipart upload, `Retry-After` errors, file-permission checks) instead of depending on that package. No new SDK first: `brewpage-client` is unpublished.

**First release.** `brewpage [publish] <file|-> [--public] [--ttl N] [--format html|markdown|text]` -- unlisted by default; prints the returned `link` unchanged on stdout, expiry, access and notices on stderr. The owner token and management link go to a private `0600` receipts file, never to arguments, stdout or logs. No login in v1.

**Later, on real use.** Site folder/ZIP, structured output, update/delete, Page data `--state`.

**Release.** Inside the dev repo: tag `vX.Y.Z` -> CI tests, then a GitHub Release with the `npm pack` tarball and `SHA256SUMS`; the tap formula installs that tarball. npm: the owner publishes the verified tarball once, then Trusted Publishing with `--provenance`.

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- https://github.com/kochetkov-ma/brewpage-cli
