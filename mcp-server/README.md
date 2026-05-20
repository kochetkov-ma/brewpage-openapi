# brewpage-mcp

[![npm version](https://img.shields.io/npm/v/brewpage-mcp.svg)](https://www.npmjs.com/package/brewpage-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for [BrewPage](https://brewpage.app) -- publish and manage HTML, KV, JSON, and file content directly from AI assistants.

## What is BrewPage

[BrewPage](https://brewpage.app) is a free instant hosting platform designed for AI agents and developers. One `POST` request publishes HTML, Markdown, a multi-file site, a JSON document, or a binary file and returns a stable HTTPS short URL -- no accounts, no API keys, no infrastructure setup. Every resource carries an **owner token** returned at creation time: use it to update content in place (keeping the same URL), delete the resource, or authenticate list operations across sessions. `brewpage-mcp` exposes this API as six typed MCP tools so any compatible agent -- Claude, Codex, Gemini, Cursor, Cline -- can publish and manage BrewPage content without leaving the conversation.

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

### Cursor

Open **Settings > MCP** and add:

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

### Cline (VS Code extension)

Open the Cline MCP settings panel and add:

```json
{
  "brewpage": {
    "command": "npx",
    "args": ["-y", "brewpage-mcp"]
  }
}
```

### Global Install

```bash
npm install -g brewpage-mcp
brewpage-mcp
```

## Tools

Six tools are available. All write operations return an owner token; keep it to modify or delete the resource later.

### `publish_html`

Publish HTML or Markdown content to BrewPage. Returns a public URL and owner token.

Parameters: `content` (string), `format` (`HTML` | `MARKDOWN`, default `HTML`), `namespace` (optional, defaults to `public`), `password` (optional), `ttlDays` (1--30, default 15), `filename` (optional, used as title fallback), `showTopBar` (optional boolean -- adds a toolbar with filename, Download button, and theme toggle).

Example prompt that invokes this tool:

> "Save this HTML report so I can share the link with my team."

```
publish_html(content="<h1>Report</h1>...", format="HTML", ttlDays=15)
```

---

### `publish_file`

Upload a file to BrewPage by fetching it from a URL. Returns a public URL and owner token. Supports images, PDFs, video, audio, code files, and archives.

Parameters: `url` (string, the source URL to fetch), `namespace` (optional), `filename` (optional custom filename).

Example prompt:

> "Upload this PNG and give me a shareable link."

```
publish_file(url="https://example.com/diagram.png")
```

---

### `publish_site`

Publish a single-page or multi-file HTML site. Pass `entryContent` for a single page or `files` (array of `{path, content}`) for a multi-file site. Supports password protection, TTL, and owner token grouping.

Parameters: `entryContent` (string, mutually exclusive with `files`), `files` (array of `{path, content}`, mutually exclusive with `entryContent`), `entry` (optional entry file path, default `index.html`), `namespace` (optional), `password` (optional), `ttlDays` (1--30, default 15), `ownerToken` (optional, groups site under an existing owner).

Example prompt:

> "Deploy this static site with index.html and style.css."

```
publish_site(files=[{"path": "index.html", "content": "..."}, {"path": "style.css", "content": "..."}])
```

---

### `delete_resource`

Delete a BrewPage resource (HTML page, KV store, JSON collection, or file) using the owner token received at creation.

Parameters: `type` (`html` | `kv` | `json` | `file`), `namespace` (string), `id` (string), `ownerToken` (string).

Example prompt:

> "Delete the page I just published -- namespace public, id aBcDeFgHiJ."

```
delete_resource(type="html", namespace="public", id="aBcDeFgHiJ", ownerToken="tok_...")
```

---

### `get_page`

Fetch the content of a published BrewPage HTML page by namespace and ID.

Parameters: `namespace` (string), `id` (string), `password` (optional, if the page is password-protected).

Example prompt:

> "Retrieve the content of my published page so I can continue editing it."

```
get_page(namespace="public", id="aBcDeFgHiJ")
```

---

### `get_stats`

Get platform-wide BrewPage usage statistics (page count, file count, storage, daily totals). Supports an optional IANA timezone for the "today" boundary.

Parameters: `tz` (optional IANA timezone string, e.g. `Europe/Lisbon`, defaults to UTC).

Example prompt:

> "How many pages are currently hosted on BrewPage?"

```
get_stats()
```

## Common LLM Query to BrewPage Tool Mapping

| LLM query / intent | Tool | Notes |
|--------------------|------|-------|
| "Publish this HTML so I can share it" | `publish_html` | `format=HTML`; save `ownerToken` |
| "Share these meeting notes as a link" | `publish_html` | `format=MARKDOWN`; readable rendered output |
| "Host this AI-generated artifact" | `publish_html` | `namespace` optional; public by default |
| "Upload this image / PDF / video" | `publish_file` | Fetches from URL; inline preview on short URL |
| "Deploy this static site" | `publish_site` | Pass `files` array or `entryContent` |
| "Fix a typo in the page I shared -- same link" | Use `PUT /api/html/{ns}/{id}` directly | MCP `delete_resource` + `publish_html` is the workaround via MCP |
| "Remove the page I published" | `delete_resource` | Requires `ownerToken` from creation |
| "Read back the page I published" | `get_page` | Returns raw content for editing |
| "How many pages are on BrewPage?" | `get_stats` | Returns platform totals |
| "Store JSON state between turns" | Use REST `POST /api/json` directly | KV and JSON not yet wrapped in MCP tools |

## Owner Token

Every publish response includes an **owner token** -- the only credential that allows updating or deleting your content. **Save it. It cannot be recovered.**

- Reuse it via `X-Owner-Token` on subsequent creates to group resources under one owner.
- Pass it to `delete_resource` to remove content.
- Pass it to `get_page` (not needed for reads, but required for listing your own resources via the REST API).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BREWPAGE_URL` | `https://brewpage.app` | API base URL |

## Links

- [brewpage.app](https://brewpage.app) -- Live platform
- [brewpage.app/llms.txt](https://brewpage.app/llms.txt) -- LLM context file
- [brewpage.app/llms-full.txt](https://brewpage.app/llms-full.txt) -- Full LLM reference
- [API Documentation](https://kochetkov-ma.github.io/brewpage-openapi/) -- Interactive docs
- [API Reference](https://kochetkov-ma.github.io/brewpage-openapi/api-reference/) -- Scalar API explorer
- [OpenAPI Spec](https://github.com/kochetkov-ma/brewpage-openapi/blob/main/openapi/openapi.yaml) -- Full specification
- [Claude Skill](https://github.com/kochetkov-ma/claude-brewcode/tree/main/skills/brewpage-publish) -- `/brewpage` slash command
- [Brewcode Plugin](https://github.com/kochetkov-ma/claude-brewcode) -- Claude Code plugin suite

## Changelog

## 1.4.0 -- 2026-05-12

- Sync to spec 1.31.0 -- adds raw `text/*` and `application/octet-stream` variants on `POST /api/html`; PUT mirror; 422 with `supportedTypes`.

## License

[MIT](LICENSE)
