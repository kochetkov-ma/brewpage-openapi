# brewpage-hf-space

> **Module stub.** Dev repo: [`kochetkov-ma/brewpage-hf-space`](https://github.com/kochetkov-ma/brewpage-hf-space) -- not created yet (TaskList #10).
> Once created, this folder becomes a git submodule. Development is coordinated from `brewpage-openapi` via the future `hf-space-engineer` subagent (`.claude/agents/hf-space-engineer.md`).
> Note: the dev repo's `main` branch doubles as the HuggingFace Space source -- HF clones it on every push.

**Status:** SCAFFOLD -- repo not yet created. A working draft of the three deliverable files was prepared in `hf-space/` at commit `d1fa5ca` (since reverted) and can be recovered with `git show d1fa5ca:hf-space/<file>` if the dev repo wants a seed.

**Intent.** A static HuggingFace Space that mirrors the `brewpage-mcp` README, the install snippets, and the BrewPage backlink set. The Space is a discovery + SEO surface for the AI-tooling audience that browses HuggingFace; it is not a runtime demo.

**Channel.** HuggingFace Spaces -- `https://huggingface.co/spaces/<user>/brewpage-mcp`. SDK: `static`. Pinned. License: Apache 2.0.

**Depends on.** `brewpage-mcp` (this repo's `mcp-server/`). The Space pins a specific version (`brewpage-mcp@1.4.0` at scaffold time) in its README install snippets and tool table; bumping the MCP version requires a Space content update.

**Architecture note (Docker SDK rejected).** HuggingFace's `sdk: docker` probes the container on HTTP port 7860; `brewpage-mcp` speaks the stdio MCP transport (correct for local clients like Claude Desktop, Cursor, Cline) and opens no HTTP socket, so a Docker Space would fail probe on boot. The static SDK ships pure HTML + README and is the only platform-compatible option until a Gradio shim is built (out of scope; tracked as future T9c).

**Planned content.**
- `README.md` -- HF Space frontmatter (`title`, `emoji`, `colorFrom`, `colorTo`, `sdk: static`, `pinned: true`, `license: apache-2.0`) + "What is BrewPage" intro + MCP tool table (6 tools, mirrored from `mcp-server/README.md`) + install snippets (Claude Desktop, Codex CLI TOML, Cursor, Cline, all pinned to a specific `brewpage-mcp` version) + backlink table (brewpage.app, /llms.txt, OpenAPI YAML, npm package, GitHub repo).
- `index.html` -- minimal well-formed static landing page mirroring the same backlinks; HF static SDK serves this as the Space's HTTP root.
- `LICENSE` -- Apache 2.0 verbatim from this repo's root LICENSE.

**Release.** Inside dev repo: push to `main` -> HuggingFace clones the repo and rebuilds the Space (typically <5 min). No CI workflow required for static SDK. Version bumps to the pinned `brewpage-mcp` are content-only commits.

**Pre-requisites for first push.** HuggingFace account + write-scope token. `huggingface-cli login --token $HF_TOKEN`, then `git remote add hf https://huggingface.co/spaces/<user>/brewpage-mcp` and `git push hf main`.

**Verification (post-publish).**
```bash
curl -s https://huggingface.co/spaces/<user>/brewpage-mcp | grep -c brewpage.app  # expect >= 1
```

**Links.**
- BrewPage -- https://brewpage.app
- OpenAPI contract -- https://github.com/kochetkov-ma/brewpage-openapi
- Master plan -- ../../ECOSYSTEM-PLAN.md
- MCP server source -- ../../mcp-server/
- Dev repo -- TBD (TaskList #10)
- Subagent -- ../../.claude/agents/hf-space-engineer.md (TBD)
