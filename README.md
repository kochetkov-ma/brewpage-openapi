# BrewPage API -- Open Source Public Layer

[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-green?logo=openapiinitiative)](openapi/openapi.yaml)
[![Docs](https://img.shields.io/badge/Docs-GitHub%20Pages-blue)](https://kochetkov-ma.github.io/brewpage-openapi/)
[![MCP Server](https://img.shields.io/badge/MCP-brewpage--mcp-gold)](mcp-server/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

> This repository is the **open-source public layer** of [BrewPage](https://brewpage.app) --
> a proprietary HTML/KV/JSON/file hosting platform.
> The backend, frontend, and infrastructure remain closed-source.

## Table of Contents

- [What's Open Here](#whats-open-here)
- [What's Proprietary](#whats-proprietary)
- [Quick Start](#quick-start)
- [API Features](#api-features)
- [API Examples](#api-examples)
- [API Reference](#api-reference)
- [MCP Server](#mcp-server)
- [Documentation](#documentation)
- [Project Structure](#project-structure)
- [Links](#links)
- [License](#license)

## What's Open Here

| Component | Description |
|-----------|-------------|
| OpenAPI 3.1 spec | Complete API contract for all public endpoints (YAML + JSON) |
| Interactive docs | Astro + Scalar documentation site (GitHub Pages) |
| MCP server | `brewpage-mcp` -- Claude Desktop/Code integration (6 tools) |
| Wiki | Code snippets, cheatsheet, tips & tricks |
| Release notes | Changelog for API and public tooling |

## What's Proprietary

| Component | Description |
|-----------|-------------|
| Backend | Spring Boot + Kotlin REST API |
| Frontend | HTML/CSS/JS + Caddy reverse proxy |
| Infrastructure | VPS deployment, CI/CD pipelines |
| E2E test suite | Playwright + Testcontainers |

## Quick Start

### Web UI

Open [brewpage.app](https://brewpage.app) -> Drop a file or paste HTML -> **Publish** -> Get a shareable link.

### Claude Skill

```
/brewpage "Hello, world!"
```

Publish content instantly via the [brewcode plugin](https://github.com/kochetkov-ma/claude-brewcode) skill.

### MCP Server

Add `brewpage-mcp` to your Claude config:

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

Then ask Claude: *"Publish this HTML to BrewPage"*.

### API

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

## API Features

**BrewPage** is a content hosting platform. Publish and share:

| Resource | Description | Limits |
|----------|-------------|--------|
| **HTML pages** | Raw HTML or Markdown with instant short URLs | 5 MB, TTL 30--365d |
| **Key-value store** | Named key-value pairs grouped in namespaces | 1,000 keys/namespace |
| **JSON documents** | Store and retrieve arbitrary JSON with collection management | 1 MB, 10,000 docs/collection |
| **Files** | Upload files with automatic MIME detection and inline preview | 5 MB, 1,000 files/namespace |
| **Sites** | Multi-file HTML sites via ZIP or individual files | 5 MB/file, 1,000 files/site, TTL 1--30d |

Every resource gets a short URL (`brewpage.app/{ns}/{id}`), optional password protection, configurable TTL, and tagging. Public content appears in a browsable gallery with search.

## API Examples

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

**Upload a site (individual files):**

```bash
curl -X POST "https://brewpage.app/api/sites" \
  -F "files=@index.html;type=text/html" \
  -F "files=@style.css;type=text/css" \
  -F "paths=index.html" \
  -F "paths=style.css"
```

**Upload a site (ZIP archive):**

```bash
curl -X POST "https://brewpage.app/api/sites" \
  -F "archive=@site.zip;type=application/zip"
```

## API Reference

- **Interactive docs** -- [kochetkov-ma.github.io/brewpage-openapi](https://kochetkov-ma.github.io/brewpage-openapi/)
- **API Reference (Scalar)** -- [kochetkov-ma.github.io/brewpage-openapi/api-reference](https://kochetkov-ma.github.io/brewpage-openapi/api-reference/)
- **OpenAPI spec (YAML)** -- [`openapi/openapi.yaml`](openapi/openapi.yaml)
- **OpenAPI spec (JSON)** -- [`openapi/openapi.json`](openapi/openapi.json)

### Endpoints

| Tag | Description |
|-----|-------------|
| **HTML** | Publish, retrieve, update, delete HTML/Markdown pages |
| **KV** | Key-value store CRUD (get, set, list, delete keys) |
| **JSON** | JSON document CRUD with collection listing |
| **Files** | File upload, download, list, delete |
| **Sites** | Multi-file site upload (ZIP or files), info, serve, delete |
| **Gallery** | Browse public content with search and pagination |
| **Stats** | Platform-wide usage statistics |
| **Short Links** | URL shortener for published content |
| **SEO** | Sitemap and robots.txt endpoints |

## MCP Server

The `brewpage-mcp` package provides a Model Context Protocol server with **6 tools** for AI-assisted content publishing. See [`mcp-server/README.md`](mcp-server/README.md) for full documentation.

| Tool | Description |
|------|-------------|
| `publish_html` | Publish HTML or Markdown content |
| `publish_file` | Upload a file from URL |
| `publish_site` | Publish a multi-file HTML site |
| `delete_resource` | Delete any resource by owner token |
| `get_page` | Fetch a published HTML page |
| `get_stats` | Get platform-wide statistics |

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
- **API Reference (Scalar)** -- [kochetkov-ma.github.io/brewpage-openapi/api-reference](https://kochetkov-ma.github.io/brewpage-openapi/api-reference/)
- **OpenAPI Spec** -- [`openapi/openapi.yaml`](openapi/openapi.yaml)
- **MCP Server** -- [`mcp-server/`](mcp-server/)
- **Claude Skill** -- [brewpage-publish](https://github.com/kochetkov-ma/claude-brewcode/tree/main/skills/brewpage-publish)
- **Skill Docs** -- [doc-claude.brewcode.app/brewdoc/brewpage](https://doc-claude.brewcode.app/brewdoc/brewpage/)
- **Brewcode Plugin** -- [github.com/kochetkov-ma/claude-brewcode](https://github.com/kochetkov-ma/claude-brewcode)
- **Wiki** -- [github.com/kochetkov-ma/brewpage-openapi/wiki](https://github.com/kochetkov-ma/brewpage-openapi/wiki)
- **Releases** -- [github.com/kochetkov-ma/brewpage-openapi/releases](https://github.com/kochetkov-ma/brewpage-openapi/releases)
- **GitHub** -- [github.com/kochetkov-ma/brewpage-openapi](https://github.com/kochetkov-ma/brewpage-openapi)

## License

[MIT](LICENSE)
