# brewpage-chrome

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-chrome`](https://github.com/kochetkov-ma/brewpage-chrome) -- not created yet (TaskList #7).
> Once created, this folder becomes a git submodule. Development is coordinated from `brewpage-openapi` via the `ext-chrome-engineer` subagent (`.claude/agents/ext-chrome-engineer.md`).

**Status:** SCAFFOLD -- repo not yet created.

**Intent.** Capture the current tab as HTML (or selection / image) and publish to BrewPage. Use cases: "share this AI chat output", "share this generated page", "mirror this report to a stable URL".

**Channel.** Chrome Web Store + Edge Add-ons. Same Manifest V3 build ships to both. Firefox via `webextension-polyfill` as a separate build target inside the same dev repo (no separate dir).

**Depends on.** `brewpage-client` (npm).

**Planned features.**
- Browser action popup: "Publish this tab as HTML".
- Context menu on selection: "Publish selection".
- Context menu on image: "Mirror image to BrewPage".
- Options page: default namespace, TTL, owner-token storage (`chrome.storage.local`).
- Auto-copy URL to clipboard, toast notification with the link.

**Manifest.** MV3, minimal permissions: `activeTab`, `clipboardWrite`, `storage`, `contextMenus`. NO `<all_urls>` host permission.

**Release.** Inside dev repo: tag `vX.Y.Z` -> CI builds and uploads via Chrome Web Store API, Edge Add-ons API, and AMO for Firefox.

**Display name.** `BrewPage Publisher`.

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- TBD (TaskList #7)
- Subagent -- ../../.claude/agents/ext-chrome-engineer.md
