# brewpage-browser-extension

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-browser-extension`](https://github.com/kochetkov-ma/brewpage-browser-extension) -- live (MIT; TaskList #7). The planned name `brewpage-chrome` was not used.
> Code, tests and releases live there; this folder stays a short stub (no git submodules).

**Status:** RELEASED -- [v1.0.0](https://github.com/kochetkov-ma/brewpage-browser-extension/releases/tag/v1.0.0) ships Firefox and Chromium builds; installable from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/brewpage-publisher/). Other stores are pending.

**Intent.** Publish the current tab, selected text (including an AI answer), an image or a file to BrewPage and get a share link.

**Channel.** Firefox Add-ons; Chromium build attached to the GitHub Release.

**Depends on.** The public REST API directly; no runtime dependencies (`brewpage-client` is unpublished).

**Manifest.** MV3; permissions `activeTab`, `scripting`, `storage`, `contextMenus`; host permission `https://brewpage.app/*` only.

**Display name.** `BrewPage Publisher`.

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- Dev repo -- https://github.com/kochetkov-ma/brewpage-browser-extension
