---
title: BrewPage MCP
emoji: 🍺
colorFrom: blue
colorTo: indigo
sdk: static
pinned: true
license: apache-2.0
---

# BrewPage MCP

## What is BrewPage

[BrewPage](https://brewpage.app) hosts HTML pages, multi-file static sites, KV entries, JSON documents, and binary files. Publish immediately or connect an account for account-owned publications. Share the returned HTTPS reader link. Save a newly issued anonymous owner token privately and reuse existing proof on later edits. See [`/llms.txt`](https://brewpage.app/llms.txt), [`/llms-full.txt`](https://brewpage.app/llms-full.txt), and the [OpenAPI spec](https://brewpage.app/api/openapi.yaml) for the REST API.

## Tools

The `brewpage-mcp` 3.1.3 server advertises 13 tools. Cached names from earlier versions remain callable. See the [package README](https://www.npmjs.com/package/brewpage-mcp) for the complete catalog.

| Tool | Purpose | Key parameters |
|------|---------|----------------|
| `publish` | Publish inline content, a complete site bundle, a public file URL, JSON or KV. | `kind` and its content fields |
| `update_publication` | Replace existing content. Supply all retained site files and the intended entry. | `kind`, `namespace`, `id`, replacement content and owner proof |
| `read_publication` | Read published content or an authorized owner view. | `kind`, `namespace`, `id`, optional `view` |
| `delete_publication` | Delete an owned publication or one KV key. | `kind`, `namespace`, `id`, optional `key` and owner proof |
| `read_page_data` | Read visitor data settings, entries, totals or uploads as an owner. | Publication target, optional `collection` and owner proof |
| `get_guide` | Read a workflow for publishing, Page data, templates or accounts. | `topic` |

## Install

### Remote (no install)

One remote MCP server for every client: `https://brewpage.app/mcp` (Streamable HTTP, anonymous access or optional account connection). Add it by URL in Claude (a custom connector), ChatGPT (a custom MCP server) or any Streamable HTTP client.

Claude Code: `claude mcp add --transport http brewpage --scope user https://brewpage.app/mcp` (leave out `--scope user` to add it to the current project only).

### Claude.ai and Claude Desktop

Claude calls a remote MCP server a custom connector. Add it once in Claude on the web; Claude Desktop picks it up too. Nothing to install.

1. Open **Customize** > **Connectors**.
2. Click **+ Add**, then **Add custom connector**.
3. Name it **BrewPage**, paste `https://brewpage.app/mcp` and click **Continue**.
4. Choose anonymous access for immediate publishing or connect BrewPage for account access.

The free plan includes one custom connector.

### Local package (stdio)

For clients that only start local servers (needs Node.js; the same tools). All snippets use `npx` to fetch and run the pinned version on demand.

Claude Desktop local fallback: add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp@3.1.3"]
    }
  }
}
```

#### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.brewpage]
command = "npx"
args = ["-y", "brewpage-mcp@3.1.3"]
```

#### Cursor

Open **Settings > MCP** and add:

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp@3.1.3"]
    }
  }
}
```

#### Cline (VS Code extension)

Open the Cline MCP settings panel and add:

```json
{
  "brewpage": {
    "command": "npx",
    "args": ["-y", "brewpage-mcp@3.1.3"]
  }
}
```

## Links

| Resource | URL |
|----------|-----|
| BrewPage platform | https://brewpage.app/ |
| Remote MCP server | https://brewpage.app/mcp |
| Setup for every AI tool | https://brewpage.app/integrations |
| LLM context file | https://brewpage.app/llms.txt |
| OpenAPI spec (YAML) | https://brewpage.app/api/openapi.yaml |
| npm package | https://www.npmjs.com/package/brewpage-mcp |
| GitHub repository | https://github.com/kochetkov-ma/brewpage-openapi |

## License

Apache License 2.0 -- see [LICENSE](LICENSE).
