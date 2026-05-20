# brewpage-vscode

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-vscode`](https://github.com/kochetkov-ma/brewpage-vscode) -- not created yet (TaskList #6).
> Once created, this folder becomes a git submodule. Development is coordinated from `brewpage-openapi` via the `ext-vscode-engineer` subagent (`.claude/agents/ext-vscode-engineer.md`).

**Status:** SCAFFOLD -- repo not yet created.

**Intent.** Publish the current file, selection, or workspace folder to BrewPage from inside VS Code. Owner tokens stored in `vscode.SecretStorage`.

**Channel.** VS Marketplace + Open VSX. Extension id: `kochetkov-ma.brewpage`.

**Depends on.** `brewpage-client` (npm).

**Planned features.**
- Command `BrewPage: Publish Current File` (HTML / Markdown / JSON).
- Command `BrewPage: Publish Selection as HTML`.
- Command `BrewPage: Publish Workspace as Site` (zip + upload).
- Command `BrewPage: Update Existing` -- pick from owner-token resource list.
- Status bar item with last published URL, copy-on-click.
- Per-workspace settings: default namespace, TTL, privacy.

**Release.** Inside dev repo: tag `vX.Y.Z` -> CI runs `vsce publish` (Marketplace) AND `ovsx publish` (Open VSX).

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- TBD (TaskList #6)
- Subagent -- ../../.claude/agents/ext-vscode-engineer.md
