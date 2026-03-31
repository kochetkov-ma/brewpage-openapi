# BrewPage API

[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-green?logo=openapiinitiative)](openapi/openapi.yaml)
[![Docs](https://img.shields.io/badge/Docs-GitHub%20Pages-blue)](https://kochetkov-ma.github.io/brewpage-openapi/)
[![MCP Server](https://img.shields.io/badge/MCP-brewpage--mcp-gold)](mcp-server/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

OpenAPI specification, interactive documentation, and MCP server for [BrewPage](https://brewpage.app) -- HTML/KV/JSON/file hosting platform.

## Overview

**BrewPage** is a content hosting platform that lets you publish and share:

- **HTML pages** -- publish raw HTML or Markdown with instant short URLs
- **Key-value store** -- create named key-value pairs grouped in stores, up to 1,000 keys per store
- **JSON documents** -- store and retrieve arbitrary JSON with collection management
- **File hosting** -- upload files up to 5 MB with automatic MIME detection and inline preview

Every resource gets a short URL (`brewpage.app/{ns}/{id}`), optional password protection, configurable TTL (1--365 days), and tagging. Public content appears in a browsable gallery with search.

## Quick Start

**Publish an HTML page:**

```bash
curl -X POST https://brewpage.app/api/html \
  -H "Content-Type: application/json" \
  -d '{"content": "<h1>Hello, world!</h1>"}'
```

Response:

```json
{
  "id": "aBcDeFgHiJ",
  "namespace": "public",
  "link": "https://brewpage.app/public/aBcDeFgHiJ",
  "ownerLink": "https://brewpage.app/api/html/public/aBcDeFgHiJ",
  "ownerToken": "your-secret-token",
  "expiresAt": "2026-04-05T12:00:00Z",
  "sizeBytes": 22
}
```

**Get platform stats:**

```bash
curl https://brewpage.app/api/stats
```

**Publish Markdown:**

```bash
curl -X POST "https://brewpage.app/api/html?format=markdown" \
  -H "Content-Type: application/json" \
  -d '{"content": "# My Document\n\nHello **world**"}'
```

**Store a JSON document:**

```bash
curl -X POST https://brewpage.app/api/json \
  -H "Content-Type: application/json" \
  -d '{"name": "config", "version": 1}'
```

## API Reference

- **Interactive docs** -- [kochetkov-ma.github.io/brewpage-openapi](https://kochetkov-ma.github.io/brewpage-openapi/)
- **OpenAPI spec (YAML)** -- [`openapi/openapi.yaml`](openapi/openapi.yaml)
- **OpenAPI spec (JSON)** -- [`openapi/openapi.json`](openapi/openapi.json)

### Endpoints

| Tag | Description |
|-----|-------------|
| **HTML** | Publish, retrieve, update, delete HTML/Markdown pages |
| **KV** | Key-value store CRUD (get, set, list, delete keys) |
| **JSON** | JSON document CRUD with collection listing |
| **Files** | File upload, download, list, delete |
| **Gallery** | Browse public content with search and pagination |
| **Stats** | Platform-wide usage statistics |
| **Short Links** | URL shortener for published content |
| **SEO** | Sitemap and robots.txt endpoints |

## MCP Server

The `brewpage-mcp` package provides a Model Context Protocol server with 5 tools for AI-assisted content publishing. See [`mcp-server/README.md`](mcp-server/README.md) for full documentation.

### Claude Desktop

Add to `claude_desktop_config.json`:

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

Add to `settings.json`:

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

## Documentation

Full documentation is deployed to GitHub Pages:

**[kochetkov-ma.github.io/brewpage-openapi](https://kochetkov-ma.github.io/brewpage-openapi/)**

The docs site includes getting started guides, API examples, and MCP server usage instructions.

## Project Structure

```
brewpage-openapi/
  openapi/
    openapi.json          # OpenAPI 3.1 spec (JSON)
    openapi.yaml          # OpenAPI 3.1 spec (YAML)
  docs-site/              # Astro documentation site
    src/
      pages/              # Documentation pages
      components/         # Scalar API reference
  mcp-server/             # MCP server (brewpage-mcp)
    src/
      index.ts            # Server entry point
      tools/              # MCP tool implementations
  .github/
    workflows/            # CI/CD (docs deploy, releases)
  README.md
  RELEASE-NOTES.md
  LICENSE
```

## Links

- **BrewPage** -- [brewpage.app](https://brewpage.app)
- **BrewData** (alias) -- [brewdata.app](https://brewdata.app)
- **API Docs** -- [kochetkov-ma.github.io/brewpage-openapi](https://kochetkov-ma.github.io/brewpage-openapi/)
- **GitHub** -- [github.com/kochetkov-ma/brewpage-openapi](https://github.com/kochetkov-ma/brewpage-openapi)

## License

[MIT](LICENSE)
