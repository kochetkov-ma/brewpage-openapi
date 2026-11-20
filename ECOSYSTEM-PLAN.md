# BrewPage Ecosystem Plan

> Strategy locked 2026-05-20. Reverses the earlier monorepo direction.

## Strategy

**Per-repo distribution + monorepo coordination from `brewpage-openapi`.**

Every module ships from its own GitHub repo (`kochetkov-ma/brewpage-*`). This repo is the coordination layer: it holds the OpenAPI contract, the existing `mcp-server`, the master plan, and one reference folder per module under `modules/<name>/`. Maintainer agents and skills live in the private BrewPage app repository, not here. No git submodules. The reference folder either holds a stub README (module not yet built) or a working snapshot of the dev repo's tree (module built and tracked here for visibility).

| Layer | Where | Why |
|---|---|---|
| OpenAPI contract (source of truth) | this repo `openapi/openapi.yaml` | Single contract, every module consumes it |
| `brewpage-mcp` (MCP server) | this repo `mcp-server/` | Already released; explicit exception |
| Every other module | dedicated repo `kochetkov-ma/brewpage-*` | One marketplace listing per repo, entity-graph SEO, clean `@v1` for Actions, per-repo issues/stars/topics |
| Module reference folder | this repo `modules/<name>/` | Stub README until dev repo exists; working snapshot once it does. Plain files in master -- no git submodules |
| Maintainer agents and skills | private BrewPage app repository | Contract sync and module work are driven from there; a module repo may carry its own (e.g. `brewpage-cookbook`) |
| Per-repo dev docs | inside each module repo | Full developer docs in the dev repo |
| User-facing full docs | separate repo `brewpage-docs` (Astro) | Distinct audience; site assembled from this repo until migration completes |
| Cross-links | every README, every package listing, every marketplace page | Link to brewpage.app + back-link to brewpage-openapi for the spec |

**Decision log.**
- 2026-05-20 -- monorepo proposal rejected. Per-repo wins because the SEO entity-graph + per-marketplace listing + clean `@v1` Action semantics matter more for AI-search discovery than the velocity saved by sharing one CI surface. (The source research report was not kept in any repo.)
- 2026-06-09 -- `brewpage-action` decoupled from `brewpage-cli` -- calls the BrewPage REST API directly (native `fetch`, Node 24), only runtime dep `@actions/core`. CLI dependency dropped; action is self-contained and shipped (v1.0.2 that day, current release v1.2.5; listed on the GitHub Marketplace since v1.1.2 at https://github.com/marketplace/actions/publish-to-brewpage, use it by `uses: kochetkov-ma/brewpage-action@v1.2.5`). `brewpage-cli` (`modules/cli-node/`) remains its own sibling module.
- 2026-10-28 -- Homebrew uses the existing owner tap `kochetkov-ma/homebrew-brew` (`brew install kochetkov-ma/brew/<formula>`), not a new `homebrew-tap`. It carries `brewpage-mcp` (from that day) and `brewdoc`; the CLI formula order is set by the 2026-11-20 entry.
- 2026-11-20 -- `brewpage` CLI ships on the tap first, npm later (brewpage-app issue #123, owner ruling of that day). Dev repo `kochetkov-ma/brewpage-cli` (public, Apache-2.0, Node >= 22, no runtime dependencies) attaches the `npm pack` tarball and `SHA256SUMS` to each `vX.Y.Z` GitHub Release; formula `brewpage` in the owner tap installs that tarball (`brew install kochetkov-ma/brew/brewpage`). npm `brewpage` (fallback `brewpage-cli`, command stays `brewpage`) follows after the owner's first publish of the verified Release tarball; later releases use Trusted Publishing with `--provenance`. Replaces the 2026-10-28 order (formula only after the npm CLI ships): #123 asks only that the artifact and install flow work, and the Release tarball qualifies.
- 2026-11-20 -- Apple Shortcut (brewpage-app issue #122): source, generator and inspectable action list live in `modules/shortcuts/` here, public so people can read what it does; the signed file follows the owner's signing pass.

## Repo map

| Module folder (here) | Future repo (GitHub) | Channel | Phase | Task |
|---|---|---|---|---|
| `mcp-server/` (root, NOT under modules/) | this repo | npm `brewpage-mcp` | RELEASED | -- |
| `modules/client-ts/` | `kochetkov-ma/brewpage-client-ts` | npm `brewpage-client` | P1 | #1 |
| `modules/cli-node/` | `kochetkov-ma/brewpage-cli` (GitHub Release v0.1.0, 2026-11-20) | GitHub Release + owner tap first (formula pending); npm `brewpage` after the owner's first publish | P1 | #3 |
| `modules/ext-vscode/` | `kochetkov-ma/brewpage-vscode` | VS Marketplace + Open VSX | P1 | #6 |
| `modules/action/` | `kochetkov-ma/brewpage-action` | `uses: kochetkov-ma/brewpage-action@v1.2.5` ([GitHub Marketplace](https://github.com/marketplace/actions/publish-to-brewpage)) | RELEASED (v1.2.5) | #8 |
| `modules/client-python/` | `kochetkov-ma/brewpage-client-python` | PyPI `brewpage-client` | P2 | #2 |
| `modules/cli-python/` | `kochetkov-ma/brewpage-cli-python` | PyPI `brewpage` | P2 | #4 |
| `modules/ext-chrome/` | `kochetkov-ma/brewpage-browser-extension` (planned as `brewpage-chrome`) | Firefox Add-ons + Chromium build on the GitHub Release; other stores pending | RELEASED (v1.0.0) | #7 |
| `modules/cli-homebrew/` | `kochetkov-ma/homebrew-brew` (owner tap, exists; carries `brewpage-mcp`, `brewdoc`) | `brew install kochetkov-ma/brew/brewpage` (formula from the CLI Release tarball, with v0.1.0) | P1 | #5 |
| `modules/docs-user/` | `kochetkov-ma/brewpage-docs` | Pages (route TBD) | P2 | #9 |
| `modules/hf-space/` | `kochetkov-ma/brewpage-hf-space` | HuggingFace Spaces (static SDK) | P3 | #10 |
| `modules/cookbook/` | `kochetkov-ma/brewpage-cookbook` | BrewPage hosting (publish-site via `brewpage-action`) | RELEASED | #11 |
| `modules/shortcuts/` | this repo (`modules/shortcuts/` is the source) | Apple Shortcuts: signed `.shortcut` file after the owner's signing pass | P1 | brewpage-app #122 |

**Other public repos** (no folder under `modules/`; registry state checked 2026-11-20).

| Repo (GitHub) | Surface | Status |
|---|---|---|
| `kochetkov-ma/n8n-nodes-brewpage` | n8n community node | npm `n8n-nodes-brewpage` 0.2.0 (provenance); n8n verified-node directory lists 0.1.5; tags only, no GitHub Release |
| `kochetkov-ma/langchain-brewpage` | LangChain tools | PyPI `langchain-brewpage` 0.2.0; latest GitHub Release v0.1.2 |
| `kochetkov-ma/llama-index-tools-brewpage` | LlamaIndex tool spec | PyPI `llama-index-tools-brewpage` 0.2.0; latest GitHub Release v0.1.2 |
| `kochetkov-ma/brewpage-obsidian` | Obsidian plugin `BrewPage Publisher` | GitHub Release 1.0.0; listed in Obsidian community plugins (`brewpage-publisher`) |
| `kochetkov-ma/brewpage-emacs` | Emacs package | MELPA (snapshot 20260910.1644) and MELPA Stable 0.1.2; tags only, no GitHub Release |
| `kochetkov-ma/brewpage-nvim` | Neovim plugin | No tag or release; installed from the repo (lazy.nvim, packer); not on LuaRocks |
| `kochetkov-ma/brewpage-circleci-orb` | CircleCI orb source | Orb `brewpage/publish@1.0.0`, public in the CircleCI orb registry; tag v1.0.0 |
| `kochetkov-ma/brewpage-buildkite-plugin` | Buildkite plugin | GitHub Release v1.0.0, used as `kochetkov-ma/brewpage#v1.0.0`; not in the Buildkite plugin directory |
| `kochetkov-ma/brewpage-azure-devops` | Azure Pipelines task | Visual Studio Marketplace `brewpage.publish-to-brewpage` 1.0.0 (public); GitHub Release v1.0.0 with the `.vsix` |
| `kochetkov-ma/brewpage-codex-plugin` | Codex plugin (skill + remote MCP) | GitHub Release v0.2.1 |
| `kochetkov-ma/brewpage-publish-plugins` | Publishing skill packages for AI coding hosts | GitHub Release v1.1.3 with per-host packages and `SHASUMS256.txt`; its README claims no vendor-catalog acceptance; Zapier listing pending |

## Workflow

**Development.**
- Work is coordinated from the private BrewPage app repository and its maintainer agents; this repo carries no agents.
- When a module repo exists: its maintainer develops in the dev repo independently and refreshes `modules/<name>/` here with the latest snapshot (manual copy or scripted sync). No submodules, no commit-SHA tracking.
- For modules small enough to fit in a few files (e.g. `hf-space` -- 3 static files), `modules/<name>/` IS the canonical working tree; the dev repo is bootstrapped from it once needed.
- For larger modules, the dev repo stays authoritative and the reference folder under `modules/` is informational (stub README + links).

**Release.**
- Each module repo owns its own release flow, CI workflow, and tags.
- Tags inside each repo are unprefixed: `v1.2.3`. Keeps Action `@v1` semantics clean.
- `mcp-server` continues its existing release flow from this repo.

**Cross-links.** Mandatory in every artefact:
- Link to `https://brewpage.app` (home).
- Link to `https://github.com/kochetkov-ma/brewpage-openapi` (contract source of truth).
- Link to the module's own dev repo.
- Link to user-facing docs (`brewpage-docs` once it exists).

Match the existing `brewpage-mcp` README pattern.

## Per-module folder contents (here)

Each `modules/<name>/` here is one of two shapes:

- **Stub** -- single `README.md`: compact summary, one page max (intent, channel, install command, planned commands/features, links). Use until the dev repo exists or until the module accrues enough surface to mirror.
- **Snapshot** -- the actual working files the dev repo will publish (e.g. `hf-space/`: HF Space `README.md` + `index.html` + `LICENSE`). Use for small modules where copying the tree is cheaper than maintaining a stub plus a separate repo. The reference snapshot stays on `main` in this repo; the dev repo is bootstrapped from it on demand.

No submodules. No branches. Plain files in master.

## Build order

```
client-ts --- ext-vscode
ext-chrome (released -- direct REST, no client-ts)
cli-node -- cli-homebrew  (direct REST; no client-ts first; tap from the Release tarball, npm later)
action    (independent -- direct REST since 2026-06-09)
client-python -- cli-python
docs-user (independent)
hf-space  (independent -- depends only on mcp-server content; P3 backlink surface)
cookbook  (independent -- consumes brewpage-action for publish; first production consumer / dogfood)
shortcuts (independent -- direct REST; owner signs the file)
```

Reflected in the TaskList via `blockedBy` edges.

## Naming conventions

| Surface | Convention |
|---|---|
| Repo name | `brewpage-<module>` (exceptions: owner tap `homebrew-brew` -- Homebrew `homebrew-<tap>` naming requirement; `n8n-nodes-brewpage`, `langchain-brewpage`, `llama-index-tools-brewpage` follow their host's package naming) |
| npm package | `brewpage`, `brewpage-client`, `brewpage-mcp`, `n8n-nodes-brewpage` |
| PyPI package | `brewpage`, `brewpage-client`, `langchain-brewpage`, `llama-index-tools-brewpage` |
| VS Code extension id | `kochetkov-ma.brewpage` |
| Chrome extension display name | `BrewPage Publisher` |
| Homebrew formula | `kochetkov-ma/brew/brewpage` (tap `kochetkov-ma/homebrew-brew`) |
| Action ref | `kochetkov-ma/brewpage-action@v1.2.5` |
| Release tag | `vX.Y.Z` (unprefixed -- one repo per package) |

## Out of scope

- Flutter / Dart CLI -- no relevant audience for AI artifact hosting.
- JetBrains plugin -- Gradle complexity; defer.
- Safari extension -- separate Xcode/signing path; defer.
- Repo-internal monorepo packaging (pnpm workspaces etc.) -- explicitly rejected on 2026-05-20.

## Open questions

1. **`brewpage` name availability** on npm and PyPI. npm: settled at the owner's first publish, after the tap ships (2026-11-20); PyPI: claim before the P2 Python CLI ships. Fallback: `brewpage-cli` (command stays `brewpage`).
2. **`docs/` migration to `brewpage-docs`.** Existing `docs/` deploys to GitHub Pages via `.github/workflows/docs.yml`. Migrate after `brewpage-docs` ships; needs Pages source switch + redirect plan.
3. **Public surface for module stubs.** Options: (a) GitHub tree only; (b) routed under `brewpage.app/modules/<name>` for SEO. Decide before P1 ship.
4. **Snapshot sync cadence.** For modules carried as `modules/<name>/` snapshots (e.g. `hf-space/`), how often the dev repo and the in-tree snapshot are reconciled. Default: manual, on every dev repo tag. Automate only if drift becomes painful.

## Update protocol

Edit this file when phase changes, modules are added/removed, naming conventions shift, or an open question is resolved (move to Decision log). Per-module README stays short and points at the dev repo.
