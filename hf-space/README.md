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

[BrewPage](https://brewpage.app) is a free instant hosting platform for HTML pages, multi-file static sites, KV entries, JSON documents, and binary files. One `POST` returns a stable HTTPS short URL with no accounts or API keys; every resource carries an **owner token** for in-place updates, deletes, and cross-session listing. BrewPage is built as an LLM-friendly surface: it ships [`/llms.txt`](https://brewpage.app/llms.txt), [`/llms-full.txt`](https://brewpage.app/llms-full.txt), an [OpenAPI spec](https://brewpage.app/api/openapi.yaml), and the [`brewpage-mcp`](https://www.npmjs.com/package/brewpage-mcp) Model Context Protocol server so AI agents (Claude, Codex, Gemini, Cursor, Cline) can publish and manage content without leaving the conversation.

## Tools

The `brewpage-mcp` server exposes six typed MCP tools. All write operations return an owner token; keep it to modify or delete the resource later.

| Tool | Purpose | Key parameters |
|------|---------|----------------|
| `publish_html` | Publish HTML or Markdown content; returns public URL + owner token. | `content`, `format` (`HTML` \| `MARKDOWN`), `namespace`, `password`, `ttlDays` (1-30, default 15), `filename`, `showTopBar` |
| `publish_file` | Upload a file by fetching it from a URL (images, PDFs, video, audio, code, archives). | `url`, `namespace`, `filename` |
| `publish_site` | Publish a single-page or multi-file static HTML site. | `entryContent` *or* `files` (`[{path, content}]`), `entry` (default `index.html`), `namespace`, `password`, `ttlDays`, `ownerToken` |
| `delete_resource` | Delete an HTML page, KV entry, JSON collection, or file using the owner token. | `type` (`html` \| `kv` \| `json` \| `file`), `namespace`, `id`, `ownerToken` |
| `get_page` | Fetch the content of a published HTML page by namespace + ID. | `namespace`, `id`, `password` (optional) |
| `get_stats` | Platform-wide usage statistics (page count, file count, storage, daily totals). | `tz` (optional IANA timezone, default UTC) |

## Install

The MCP server is published to npm as [`brewpage-mcp`](https://www.npmjs.com/package/brewpage-mcp) (pinned to `1.4.0`). All snippets below use `npx` to fetch and execute the pinned version on demand.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp@1.4.0"]
    }
  }
}
```

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.brewpage]
command = "npx"
args = ["-y", "brewpage-mcp@1.4.0"]
```

### Cursor

Open **Settings > MCP** and add:

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp@1.4.0"]
    }
  }
}
```

### Cline (VS Code extension)

Open the Cline MCP settings panel and add:

```json
{
  "brewpage": {
    "command": "npx",
    "args": ["-y", "brewpage-mcp@1.4.0"]
  }
}
```

## Links

| Resource | URL |
|----------|-----|
| BrewPage platform | https://brewpage.app/ |
| LLM context file | https://brewpage.app/llms.txt |
| OpenAPI spec (YAML) | https://brewpage.app/api/openapi.yaml |
| npm package | https://www.npmjs.com/package/brewpage-mcp |
| GitHub repository | https://github.com/kochetkov-ma/brewpage-openapi |

## License

Apache License 2.0 -- see [LICENSE](LICENSE).
