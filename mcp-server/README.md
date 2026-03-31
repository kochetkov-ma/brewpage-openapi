# brewpage-mcp

[![npm version](https://img.shields.io/npm/v/brewpage-mcp.svg)](https://www.npmjs.com/package/brewpage-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for [BrewPage](https://brewpage.app) -- publish and manage HTML, KV, JSON, and file content directly from AI assistants.

## Quick Start

```bash
npx brewpage-mcp
```

## Installation

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Add to `~/.claude/settings.json`:

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

### Global Install

```bash
npm install -g brewpage-mcp
brewpage-mcp
```

## Tools

| Tool | Description |
|------|-------------|
| `publish_html` | Publish HTML or Markdown content -> URL + owner token |
| `publish_file` | Upload file from URL -> URL + owner token |
| `delete_resource` | Delete resource with owner token |
| `get_page` | Fetch published page content |
| `get_stats` | Platform-wide statistics |

## Usage Examples

Ask Claude:

- *"Publish this HTML to BrewPage"* -> Creates a page, returns public URL
- *"Create a BrewPage with my meeting notes in Markdown"* -> Markdown page
- *"Upload this image to BrewPage"* -> File upload
- *"Delete my page demo/abc123, token tok_xyz"* -> Deletes resource
- *"Show BrewPage stats"* -> Platform statistics

## Owner Token

Every publish response includes an **owner token** -- the only way to update or delete your content. **Save it! It cannot be recovered.**

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BREWPAGE_URL` | `https://brewpage.app` | API base URL |

## What is BrewPage?

[BrewPage](https://brewpage.app) is a free content hosting platform. No signup required.

- **HTML/Markdown pages** with instant short URLs
- **Key-value store** (1,000 keys per store)
- **JSON documents** (10,000 per collection)
- **File hosting** (5 MB per file)

Both [brewpage.app](https://brewpage.app) and [brewdata.app](https://brewdata.app) serve the same API.

## Links

- [brewpage.app](https://brewpage.app) -- Live platform
- [API Documentation](https://kochetkov-ma.github.io/brewpage-openapi/) -- Interactive docs
- [API Reference](https://kochetkov-ma.github.io/brewpage-openapi/api-reference/) -- Scalar API explorer
- [OpenAPI Spec](https://github.com/kochetkov-ma/brewpage-openapi/blob/main/openapi/openapi.yaml) -- Full specification
- [Claude Skill](https://github.com/kochetkov-ma/claude-brewcode/tree/main/skills/brewpage-publish) -- `/brewpage` command
- [Brewcode Plugin](https://github.com/kochetkov-ma/claude-brewcode) -- Claude Code plugin suite

## License

[MIT](LICENSE)
