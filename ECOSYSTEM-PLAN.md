# BrewPage Ecosystem Plan

> Strategy locked 2026-05-20. Reverses the earlier monorepo direction.

## Strategy

**Per-repo distribution + monorepo coordination from `brewpage-openapi`.**

Every module ships from its own GitHub repo (`kochetkov-ma/brewpage-*`). This repo is the coordination layer: it holds the OpenAPI contract, the existing `mcp-server`, agents and skills, the master plan, and one reference folder per module under `modules/<name>/`. No git submodules. The reference folder either holds a stub README (module not yet built) or a working snapshot of the dev repo's tree (module built and tracked here for visibility).

| Layer | Where | Why |
|---|---|---|
| OpenAPI contract (source of truth) | this repo `openapi/openapi.yaml` | Single contract, every module consumes it |
| `brewpage-mcp` (MCP server) | this repo `mcp-server/` | Already released; explicit exception |
| Every other module | dedicated repo `kochetkov-ma/brewpage-*` | One marketplace listing per repo, entity-graph SEO, clean `@v1` for Actions, per-repo issues/stars/topics |
| Module reference folder | this repo `modules/<name>/` | Stub README until dev repo exists; working snapshot once it does. Plain files in master -- no git submodules |
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
| `modules/cookbook/` | `kochetkov-ma/brewpage-cookbook` | BrewPage hosting (publish-site via `brewpage-action`) | P1 | #11 |

## Workflow

**Development.**
- All work coordinated from this repo. Each agent in `.claude/agents/` owns exactly one module.
- When a module repo exists: the agent maintains the dev repo independently and refreshes `modules/<name>/` here with the latest snapshot (manual copy or scripted sync). No submodules, no commit-SHA tracking.
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
client-ts ---+--- cli-node -----+--- cli-homebrew
             |                  +--- action
             +--- ext-vscode
             +--- ext-chrome
client-python -- cli-python
docs-user (independent)
hf-space  (independent -- depends only on mcp-server content; P3 backlink surface)
cookbook  (independent -- consumes brewpage-action for publish; first production consumer / dogfood)
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
4. **Snapshot sync cadence.** For modules carried as `modules/<name>/` snapshots (e.g. `hf-space/`), how often the dev repo and the in-tree snapshot are reconciled. Default: manual, on every dev repo tag. Automate only if drift becomes painful.

## Update protocol

Edit this file when phase changes, modules are added/removed, naming conventions shift, or an open question is resolved (move to Decision log). Per-module README stays short and points at the dev repo.
