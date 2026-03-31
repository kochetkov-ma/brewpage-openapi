# brewpage-mcp

MCP (Model Context Protocol) server for [BrewPage](https://brewpage.app) — publish and manage HTML, KV, JSON, and file content directly from AI assistants.

## Installation

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp"]
    }
  }
}
```

### Claude Code

Add to your `settings.json`:

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp"]
    }
  }
}
```

### Direct Usage

```bash
npx brewpage-mcp
```

## Tools

| Tool | Description |
|------|-------------|
| `publish_html` | Publish HTML or Markdown content. Returns URL + owner token |
| `publish_file` | Upload a file via URL |
| `delete_resource` | Delete a resource by namespace/id with owner token |
| `get_page` | Fetch published page content |
| `get_stats` | Platform statistics |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `BREWPAGE_URL` | `https://brewpage.app` | API base URL |

## Owner Token

Every publish response includes an **owner token**. This is the only way to update or delete your content later.

**Save your owner token! It cannot be recovered if lost.**

## Development

```bash
npm install
npm run dev
```

## License

MIT
