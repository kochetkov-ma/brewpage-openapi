# BrewPage Ecosystem Plan

> Strategy locked 2026-05-20. Reverses the earlier monorepo direction.

## Strategy

**Per-repo distribution + monorepo coordination from `brewpage-openapi`.**

Every module ships from its own GitHub repo (`kochetkov-ma/brewpage-*`). This repo is the coordination layer: it holds the OpenAPI contract, the existing `mcp-server`, agents and skills, the master plan, and one stub folder per module under `modules/<name>/`. When a module's dev repo exists, that folder becomes a git submodule mount.

| Layer | Where | Why |
|---|---|---|
| OpenAPI contract (source of truth) | this repo `openapi/openapi.yaml` | Single contract, every module consumes it |
| `brewpage-mcp` (MCP server) | this repo `mcp-server/` | Already released; explicit exception |
| Every other module | dedicated repo `kochetkov-ma/brewpage-*` | One marketplace listing per repo, entity-graph SEO, clean `@v1` for Actions, per-repo issues/stars/topics |
| Module stubs | this repo `modules/<name>/` | Folder + summary README; becomes git submodule once dev repo exists |
| Agents, skills, CLAUDE.md | this repo `.claude/` | Single dev coordination point -- all work driven from here |
| Per-repo dev docs | inside each module repo | Full developer docs in the dev repo |
| User-facing full docs | separate repo `brewpage-docs` (Astro) | Distinct audience; site assembled from this repo until migration completes |
| Cross-links | every README, every package listing, every marketplace page | Link to brewpage.app + back-link to brewpage-openapi for the spec |

**Decision log.**
- 2026-05-20 -- monorepo proposal rejected. Per-repo wins because the SEO entity-graph + per-marketplace listing + clean `@v1` Action semantics matter more for AI-search discovery than the velocity saved by sharing one CI surface. Source: `.claude/features/deep-research-report.md`.

## Repo map

| Module folder (here) | Future repo (GitHub) | Channel | Phase | Task |
|---|---|---|---|---|
| `mcp-server/` (root, NOT under modules/) | this repo | npm `brewpage-mcp` | RELEASED | -- |
| `modules/client-ts/` | `kochetkov-ma/brewpage-client-ts` | npm `brewpage-client` | P1 | #1 |
| `modules/cli-node/` | `kochetkov-ma/brewpage-cli` | npm `brewpage` | P1 | #3 |
| `modules/ext-vscode/` | `kochetkov-ma/brewpage-vscode` | VS Marketplace + Open VSX | P1 | #6 |
| `modules/action/` | `kochetkov-ma/brewpage-action` | Actions Marketplace | P1 | #8 |
| `modules/client-python/` | `kochetkov-ma/brewpage-client-python` | PyPI `brewpage-client` | P2 | #2 |
| `modules/cli-python/` | `kochetkov-ma/brewpage-cli-python` | PyPI `brewpage` | P2 | #4 |
| `modules/ext-chrome/` | `kochetkov-ma/brewpage-chrome` | Chrome Web Store + Edge + AMO | P2 | #7 |
| `modules/cli-homebrew/` | `kochetkov-ma/homebrew-tap` | `brew install kochetkov-ma/tap/brewpage` | P2 | #5 |
| `modules/docs-user/` | `kochetkov-ma/brewpage-docs` | Pages (route TBD) | P2 | #9 |
| `modules/hf-space/` | `kochetkov-ma/brewpage-hf-space` | HuggingFace Spaces (static SDK) | P3 | #10 |

## Workflow

**Development.**
- All work coordinated from this repo. Each agent in `.claude/agents/` owns exactly one module.
- When a module repo exists: `git submodule add https://github.com/kochetkov-ma/<repo> modules/<name>` replaces the placeholder folder.
- Agents edit code inside the submodule path (`modules/<name>/src/...`). Commits land in the submodule's repo, not this one.
- This repo records submodule pointers (commit SHA per module). Bumping a module = bump the submodule SHA here.

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

Each `modules/<name>/` here:
- `README.md` -- compact summary, one page max: intent, channel, install command, planned commands/features, links.
- Once the dev repo is added as a submodule, this folder mirrors the dev repo content; the user-facing summary stays in the dev repo's `README.md`.

Until then: stub README only. No code, no dependencies, no CI configs.

## Build order

```
client-ts ---+--- cli-node -----+--- cli-homebrew
             |                  +--- action
             +--- ext-vscode
             +--- ext-chrome
client-python -- cli-python
docs-user (independent)
hf-space  (independent -- depends only on mcp-server content; P3 backlink surface)
```

Reflected in the TaskList via `blockedBy` edges.

## Naming conventions

| Surface | Convention |
|---|---|
| Repo name | `brewpage-<module>` (exception: `homebrew-tap` -- Homebrew naming requirement) |
| npm package | `brewpage`, `brewpage-client`, `brewpage-mcp` |
| PyPI package | `brewpage`, `brewpage-client` |
| VS Code extension id | `kochetkov-ma.brewpage` |
| Chrome extension display name | `BrewPage Publisher` |
| Homebrew formula | `kochetkov-ma/tap/brewpage` |
| Action ref | `kochetkov-ma/brewpage-action@v1` |
| Release tag | `vX.Y.Z` (unprefixed -- one repo per package) |

## Out of scope

- Flutter / Dart CLI -- no relevant audience for AI artifact hosting.
- JetBrains plugin -- Gradle complexity; defer.
- Safari extension -- separate Xcode/signing path; defer.
- Repo-internal monorepo packaging (pnpm workspaces etc.) -- explicitly rejected on 2026-05-20.

## Open questions

1. **`brewpage` name availability** on npm and PyPI. Claim before P1 ship. Fallback: `brewpage-cli`.
2. **`docs/` migration to `brewpage-docs`.** Existing `docs/` deploys to GitHub Pages via `.github/workflows/docs.yml`. Migrate after `brewpage-docs` ships; needs Pages source switch + redirect plan.
3. **Public surface for module stubs.** Options: (a) GitHub tree only; (b) routed under `brewpage.app/modules/<name>` for SEO. Decide before P1 ship.
4. **Submodule update cadence.** Manual bumps vs. automated PR via Renovate / a workflow on submodule release tag. Default: manual until friction proves automation worth it.

## Update protocol

Edit this file when phase changes, modules are added/removed, naming conventions shift, or an open question is resolved (move to Decision log). Per-module README stays short and points at the dev repo.
