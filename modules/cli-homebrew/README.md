# brewpage (Homebrew tap)

> **Module stub.** Tap repo: [`kochetkov-ma/homebrew-brew`](https://github.com/kochetkov-ma/homebrew-brew) -- live; it already carries `brewpage-mcp` and `brewdoc`. The CLI formula is not added yet (TaskList #5).
> Homebrew requires the `homebrew-<tap>` repo name, so the owner tap installs as `kochetkov-ma/brew/<formula>`. This folder stays a stub or a plain snapshot (no git submodules). Development is coordinated from `brewpage-openapi` via the `cli-homebrew-maintainer` subagent (`.claude/agents/cli-homebrew-maintainer.md`).

**Status:** SCAFFOLD -- tap live, CLI formula waits for the `brewpage-cli` npm release.

**Intent.** Mac-native install via `brew install kochetkov-ma/brew/brewpage`. Thin shim formula -- no native build.

**Channel.** Homebrew tap repo `kochetkov-ma/homebrew-brew`.

**Depends on.** `brewpage-cli` release artefact (npm tarball or `pkg`/`nexe` single-binary attached to the `brewpage-cli` GitHub Release).

**Planned files (inside the tap).**
- `Formula/brewpage.rb` -- formula. `url`, `sha256`, `version` updated per `brewpage-cli` release.

**Release.** Triggered after each `brewpage-cli` `vX.Y.Z` release. CI step: bump `url` + `sha256` + `version`, commit to `homebrew-brew`. Audit clean: `brew audit --strict --new kochetkov-ma/brew/brewpage`.

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Tap repo -- https://github.com/kochetkov-ma/homebrew-brew
- Subagent -- ../../.claude/agents/cli-homebrew-maintainer.md
