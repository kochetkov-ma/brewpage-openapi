# BrewPage API -- Open Source Public Layer

[![npm](https://img.shields.io/npm/v/brewpage-mcp?label=brewpage-mcp)](https://www.npmjs.com/package/brewpage-mcp)
[![GitHub Stars](https://img.shields.io/github/stars/kochetkov-ma/brewpage-openapi)](https://github.com/kochetkov-ma/brewpage-openapi/stargazers)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-green?logo=openapiinitiative)](openapi/openapi.yaml)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE)
[![MCP Server](https://img.shields.io/badge/MCP-brewpage--mcp-gold)](mcp-server/)

> This repository is the **open-source public layer** of [BrewPage](https://brewpage.app) --
> a proprietary HTML/KV/JSON/file hosting platform.
> The backend, frontend, and infrastructure remain closed-source.

**Docs:** https://kochetkov-ma.github.io/brewpage-openapi/ | **API Reference:** https://kochetkov-ma.github.io/brewpage-openapi/api-reference/

## What is BrewPage

[BrewPage](https://brewpage.app) is a free instant hosting service for HTML pages, Markdown documents,
multi-file sites, AI artifacts, JSON documents, key-value stores, and binary files.
No signup or API key required. Every published resource gets a short HTTPS URL
(`brewpage.app/{namespace}/{id}`) within seconds.

Key characteristics:

- **HTML and Markdown pages** -- publish raw HTML or Markdown rendered to styled HTML, up to 5 MB, with instant short URLs.
- **Multi-file sites** -- upload a ZIP archive or individual files (up to 20 MB / 100 files) and get a fully served static site.
- **Key-value store** -- namespace-scoped KV pairs, up to 1,000 keys per namespace, mutable in place via the owner token.
- **JSON documents** -- store and retrieve arbitrary JSON, up to 1 MB per document, 10,000 documents per collection.
- **File hosting** -- upload any safe file type (images, PDFs, video, audio, archives, code), up to 5 MB (video 20 MB), with inline preview.
- **Public namespace** -- omitting `?ns=` publishes to the shared `public` namespace, which is listed on the homepage gallery and indexed by search engines. Pass a custom namespace or `X-Password` header to keep content private.
- **Owner tokens** -- every publish response includes an `ownerToken`. Use it to update content in place (stable URL), delete it, or list your own resources. No accounts, no sessions.
- **TTL** -- content expires automatically. Default 15 days, maximum 30 days, configurable per request via `ttl_days`.
- **No auth required** for reads. Writes are open (rate-limited to 60 uploads/hr per IP). All requests require a `User-Agent` header.

Both `brewpage.app` and `brewdata.app` serve the same API.

## Why this matters for LLMs and agents

AI agents frequently need to share structured outputs -- reports, artifacts, generated HTML, intermediate JSON state -- with users or downstream systems via a stable URL. BrewPage provides that as a zero-setup REST API: one `POST` call, one URL back. No OAuth, no S3 bucket configuration, no infrastructure. The MCP server (`brewpage-mcp`) wraps the API into six typed tools that any MCP-compatible agent (Claude, Codex, Gemini, Cursor) can call directly.

## Quick Start

Publish an HTML page and get a shareable link:

```bash
curl -X POST https://brewpage.app/api/html \
  -H "Content-Type: application/json" \
  -H "User-Agent: MyAgent/1.0" \
  -d '{"content": "<h1>Hello, world!</h1>", "ttlDays": 15}'
```

Response:

```json
{
  "id": "aBcDeFgHiJ",
  "namespace": "public",
  "link": "https://brewpage.app/public/aBcDeFgHiJ",
  "ownerLink": "https://brewpage.app/api/html/public/aBcDeFgHiJ",
  "ownerToken": "your-secret-token",
  "expiresAt": "2026-06-04T02:00:00Z",
  "sizeBytes": 22
}
```

Open `link` in any browser -- no further steps required.

## Use Cases for LLMs and Agents

| Scenario | API call |
|----------|----------|
| An AI agent generates a shareable HTML report and needs a stable URL to return to the user | `POST /api/html` -- returns link immediately |
| A GPT pipeline needs to persist JSON state between conversation turns without external storage | `POST /api/json?ns=myproject` then `GET /api/json/myproject/{id}` |
| A code-generation tool produces a downloadable file (PDF, archive, script) and needs to host it | `POST /api/files` -- file served with correct MIME type and inline preview |
| An agent publishes an artifact and later refines it without invalidating the shared URL | `PUT /api/html/{ns}/{id}` with `X-Owner-Token` -- content replaced, URL unchanged |
| A multi-step pipeline deploys a complete static site (HTML + CSS + JS) from a ZIP | `POST /api/sites` with `archive=@site.zip` -- all files served with relative links intact |

## API Features

| Resource | Description | Limits |
|----------|-------------|--------|
| **HTML pages** | Raw HTML or Markdown with instant short URLs | 5 MB, TTL 1--30d |
| **Key-value store** | Named key-value pairs grouped in namespaces | 1,000 keys/namespace |
| **JSON documents** | Store and retrieve arbitrary JSON with collection management | 1 MB, 10,000 docs/collection |
| **Files** | Upload files with automatic MIME detection and inline preview | 5 MB (video 20 MB), 1,000 files/namespace |
| **Sites** | Multi-file HTML sites via ZIP or individual files | 20 MB total, 100 files, 5 MB/file, TTL 1--30d |

Every resource gets a short URL (`brewpage.app/{ns}/{id}`), optional password protection, configurable TTL, and tagging. Public content appears in a browsable gallery with full-text search.

## API Examples

**Publish Markdown:**

```bash
curl -X POST "https://brewpage.app/api/html?format=markdown" \
  -H "Content-Type: application/json" \
  -H "User-Agent: MyAgent/1.0" \
  -d '{"content": "# My Document\n\nHello **world**"}'
```

**Store a JSON document:**

```bash
curl -X POST https://brewpage.app/api/json \
  -H "Content-Type: application/json" \
  -H "User-Agent: MyAgent/1.0" \
  -d '{"name": "config", "version": 1}'
```

**Upload a site (ZIP archive):**

```bash
curl -X POST "https://brewpage.app/api/sites" \
  -H "User-Agent: MyAgent/1.0" \
  -F "archive=@site.zip;type=application/zip"
```

**Update content in place (stable URL):**

```bash
curl -X PUT "https://brewpage.app/api/html/public/aBcDeFgHiJ" \
  -H "Content-Type: application/json" \
  -H "User-Agent: MyAgent/1.0" \
  -H "X-Owner-Token: your-secret-token" \
  -d '{"content": "<h1>Updated content</h1>"}'
```

**Get platform stats:**

```bash
curl https://brewpage.app/api/stats
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
| **Reports** | Abuse reports for published content |
| **Namespace** | Collision-free namespace suggestions |

## MCP Server

The `brewpage-mcp` package provides a Model Context Protocol server with **6 tools** for AI-assisted content publishing. See [`mcp-server/README.md`](mcp-server/README.md) for full documentation.

| Tool | Description |
|------|-------------|
| `publish_html` | Publish HTML or Markdown content with optional password, TTL, filename, and top toolbar |
| `publish_file` | Upload a file from a URL |
| `publish_site` | Publish a single-page or multi-file HTML site |
| `delete_resource` | Delete any resource (HTML, KV, JSON, file) by owner token |
| `get_page` | Fetch a published HTML page and its content |
| `get_stats` | Get platform-wide usage statistics |

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

## Resources

| Resource | URL |
|----------|-----|
| Live platform | https://brewpage.app |
| LLM context file | https://brewpage.app/llms.txt |
| Full LLM reference | https://brewpage.app/llms-full.txt |
| OpenAPI spec (YAML) | [`openapi/openapi.yaml`](openapi/openapi.yaml) |
| MCP server | [`mcp-server/`](mcp-server/) |
| npm package | https://www.npmjs.com/package/brewpage-mcp |
| Interactive API docs | https://kochetkov-ma.github.io/brewpage-openapi/ |
| Claude skill | https://github.com/kochetkov-ma/claude-brewcode/tree/main/skills/brewpage-publish |
| BrewCode plugin suite | https://github.com/kochetkov-ma/claude-brewcode |
| Wiki | https://github.com/kochetkov-ma/brewpage-openapi/wiki |
| Releases | https://github.com/kochetkov-ma/brewpage-openapi/releases |

BrewPage is described using [schema.org/SoftwareApplication](https://schema.org/SoftwareApplication) structured data on the platform homepage.

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
  .github/
    workflows/            # CI/CD (docs deploy, releases)
  README.md
  RELEASE-NOTES.md
  LICENSE
```

## License

[Apache 2.0](LICENSE)

