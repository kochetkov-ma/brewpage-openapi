# brewpage (Homebrew tap)

> **Module stub.** Dev repo: [`kochetkov-ma/homebrew-tap`](https://github.com/kochetkov-ma/homebrew-tap) -- not created yet (TaskList #5).
> Repo name MUST be `homebrew-<tap>` (Homebrew naming requirement) -- so `homebrew-tap`, not `brewpage-homebrew`. Once created, this folder becomes a git submodule. Development is coordinated from `brewpage-openapi` via the `cli-homebrew-maintainer` subagent (`.claude/agents/cli-homebrew-maintainer.md`).

**Status:** SCAFFOLD -- repo not yet created.

**Intent.** Mac-native install via `brew install kochetkov-ma/tap/brewpage`. Thin shim formula -- no native build.

**Channel.** Homebrew tap repo `kochetkov-ma/homebrew-tap`.

**Depends on.** `brewpage-cli` release artefact (npm tarball or `pkg`/`nexe` single-binary attached to the `brewpage-cli` GitHub Release).

**Planned files (inside dev repo).**
- `Formula/brewpage.rb` -- formula. `url`, `sha256`, `version` updated per `brewpage-cli` release.

**Release.** Triggered after each `brewpage-cli` `vX.Y.Z` release. CI step: bump `url` + `sha256` + `version`, commit to `homebrew-tap`. Audit clean: `brew audit --strict --new brewpage`.

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- TBD (TaskList #5)
- Subagent -- ../../.claude/agents/cli-homebrew-maintainer.md
