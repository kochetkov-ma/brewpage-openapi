# modules/

One folder per ecosystem repo. Each folder is either:

- a **stub** -- single `README.md` describing the planned module (used when the dev repo doesn't exist yet), or
- a **snapshot** -- the working files that the dev repo will publish (used for small modules where carrying the tree on `main` here is cheaper than maintaining a separate dev repo right away; e.g. `hf-space/`).

No git submodules. No branches. Plain files in master. Modules are tracked here as references for cross-repo coordination; the actual release artefacts live in each module's own GitHub repo.

See `../ECOSYSTEM-PLAN.md` for strategy, repo map, naming, workflow, and open questions.

| Folder | Future repo | Channel | Phase | Status |
|---|---|---|---|---|
| `client-ts/` | `brewpage-client-ts` | npm | P1 | SCAFFOLD |
| `cli-node/` | `brewpage-cli` | npm | P1 | SCAFFOLD |
| `ext-vscode/` | `brewpage-vscode` | VS Marketplace + Open VSX | P1 | SCAFFOLD |
| `action/` | `brewpage-action` | GH Actions Marketplace | P1 | SCAFFOLD |
| `client-python/` | `brewpage-client-python` | PyPI | P2 | SCAFFOLD |
| `cli-python/` | `brewpage-cli-python` | PyPI | P2 | SCAFFOLD |
| `ext-chrome/` | `brewpage-chrome` | Chrome + Edge + AMO | P2 | SCAFFOLD |
| `cli-homebrew/` | `homebrew-tap` | Homebrew tap | P2 | SCAFFOLD |
| `docs-user/` | `brewpage-docs` | Pages (route TBD) | P2 | SCAFFOLD |
| `hf-space/` | `brewpage-hf-space` | HuggingFace Spaces (static SDK) | P3 | SCAFFOLD |

> `mcp-server/` (at repo root, not under `modules/`) is the exception -- already released from this repo.

Work is tracked in the harness `TaskList` -- one task per module repo.
