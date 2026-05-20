# modules/

One folder per planned ecosystem repo. Each folder holds a stub README; when its dev repo exists, the folder becomes a git submodule (`git submodule add ...`).

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

> `mcp-server/` (at repo root, not under `modules/`) is the exception -- already released from this repo.

Work is tracked in the harness `TaskList` -- one task per module repo.
