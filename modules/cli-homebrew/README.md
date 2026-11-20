# brewpage (Homebrew tap)

> **Module stub.** Tap repo: [`kochetkov-ma/homebrew-brew`](https://github.com/kochetkov-ma/homebrew-brew) -- live; it already carries `brewpage-mcp` and `brewdoc`. The CLI formula `brewpage` comes with `brewpage-cli` v0.1.0 (TaskList #5).
> Homebrew requires the `homebrew-<tap>` repo name, so the owner tap installs as `kochetkov-ma/brew/<formula>`. The formula lives in the tap repo; this folder stays a stub or a plain snapshot (no git submodules).

**Status:** IN PROGRESS -- tap live; the CLI formula installs the `brewpage-cli` GitHub Release tarball and ships before npm (decision 2026-11-20 in the [master plan](../../ECOSYSTEM-PLAN.md)).

**Intent.** Mac-native install via `brew install kochetkov-ma/brew/brewpage`. Thin shim formula -- no native build.

**Channel.** Homebrew tap repo `kochetkov-ma/homebrew-brew`.

**Depends on.** The `brewpage-cli` GitHub Release tarball (`npm pack` output, listed in its `SHA256SUMS`) and Homebrew `node`; not the npm registry.

**Planned files (inside the tap).**
- `Formula/brewpage.rb` -- formula. `url`, `sha256`, `version` follow each `brewpage-cli` Release.

**Release.** After each `brewpage-cli` `vX.Y.Z` Release: bump `url` + `sha256` + `version`, commit to `homebrew-brew`. Audit clean: `brew audit --strict --new kochetkov-ma/brew/brewpage`.

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Tap repo -- https://github.com/kochetkov-ma/homebrew-brew
- CLI repo -- https://github.com/kochetkov-ma/brewpage-cli
