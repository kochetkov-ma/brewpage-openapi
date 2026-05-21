# brewpage-mcp

[![npm version](https://img.shields.io/npm/v/brewpage-mcp.svg)](https://www.npmjs.com/package/brewpage-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for [BrewPage](https://brewpage.app) -- publish and manage HTML, KV, JSON, and file content directly from AI assistants.

## What is BrewPage

[BrewPage](https://brewpage.app) is a free instant hosting platform designed for AI agents and developers. One `POST` request publishes HTML, Markdown, a multi-file site, a JSON document, or a binary file and returns a stable HTTPS short URL -- no accounts, no API keys, no infrastructure setup. Every resource carries an **owner token** returned at creation time: use it to update content in place (keeping the same URL), delete the resource, or authenticate list operations across sessions. `brewpage-mcp` exposes this API as fourteen typed MCP tools so any compatible agent -- Claude, Codex, Gemini, Cursor, Cline -- can publish, update, fetch, and manage BrewPage HTML, JSON, KV, and file content without leaving the conversation.

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

Fourteen tools are available, grouped by resource: **HTML**, **JSON**, **KV**, **Files**, **Sites**, and **Discovery**. All write operations return an owner token; keep it to modify or delete the resource later. Any update (`PUT`) operation requires the original `ownerToken` -- it is the backend's authorization gate. `password` is optional on reads/creates; if set, it is sent as the `X-Password` header.

### HTML

### `publish_html`

Publish HTML or Markdown content to BrewPage. Returns a public URL and owner token.

Parameters: `content` (string), `format` (`HTML` | `MARKDOWN`, default `HTML`), `namespace` (optional, defaults to `public`), `password` (optional), `ttlDays` (1--30, default 15), `filename` (optional, used as title fallback), `showTopBar` (optional boolean -- adds a toolbar with filename, Download button, and theme toggle).

Example prompt that invokes this tool:

> "Save this HTML report so I can share the link with my team."

```
publish_html(content="<h1>Report</h1>...", format="HTML", ttlDays=15)
```

---

### `update_html`

Update an existing HTML or Markdown page in place, preserving its short URL. Requires the original `ownerToken` returned at creation.

Parameters: `namespace` (string), `id` (string), `content` (string, the new body), `ownerToken` (string), `format` (optional `HTML` | `MARKDOWN` | `code`, defaults to `HTML`).

Example prompt:

> "Fix the typo in the report I published earlier -- same link."

```
update_html(namespace="public", id="aBcDeFgHiJ", content="<h1>Updated</h1>...", ownerToken="tok_...")
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

### Files

### `publish_file`

Upload a file to BrewPage by fetching it from a URL. Returns a public URL and owner token. Supports images, PDFs, video, audio, code files, and archives.

Parameters: `url` (string, the source URL to fetch), `namespace` (optional), `filename` (optional custom filename).

Example prompt:

> "Upload this PNG and give me a shareable link."

```
publish_file(url="https://example.com/diagram.png")
```

---

### Sites

### `publish_site`

Publish a single-page or multi-file HTML site. Pass `entryContent` for a single page or `files` (array of `{path, content}`) for a multi-file site. Supports password protection, TTL, and owner token grouping.

Parameters: `entryContent` (string, mutually exclusive with `files`), `files` (array of `{path, content}`, mutually exclusive with `entryContent`), `entry` (optional entry file path, default `index.html`), `namespace` (optional), `password` (optional), `ttlDays` (1--30, default 15), `ownerToken` (optional, groups site under an existing owner).

Example prompt:

> "Deploy this static site with index.html and style.css."

```
publish_site(files=[{"path": "index.html", "content": "..."}, {"path": "style.css", "content": "..."}])
```

---

### JSON

### `publish_json`

Publish a JSON document to BrewPage. Returns a public URL and owner token. The body may be passed as a JSON string or as a structured object.

Parameters: `json` (string or object, the JSON payload), `namespace` (optional, defaults to `public`), `password` (optional), `ttlDays` (optional, 1--30, default 15), `tags` (optional `string[]`).

Example prompt:

> "Save this config blob as a JSON document I can fetch later."

```
publish_json(json={"mode": "dark", "version": 3}, ttlDays=15)
```

---

### `get_json`

Fetch a published JSON document by namespace and ID.

Parameters: `namespace` (string), `id` (string), `password` (optional, sent as `X-Password` if set).

Example prompt:

> "Read back the JSON document I just stored."

```
get_json(namespace="public", id="aBcDeFgHiJ")
```

---

### `update_json`

Update an existing JSON document in place, preserving its short URL. Requires the original `ownerToken`.

Parameters: `namespace` (string), `id` (string), `json` (string or object, the new payload), `ownerToken` (string).

Example prompt:

> "Bump the version field in that JSON doc to 4."

```
update_json(namespace="public", id="aBcDeFgHiJ", json={"mode": "dark", "version": 4}, ownerToken="tok_...")
```

---

### KV

### `publish_kv`

Create a new KV (key/value) entry. Returns a public URL and owner token. The KV entry is addressed by `(namespace, id, key)`; this tool creates the entry and emits the generated `id` along with the owner token.

Parameters: `key` (string), `value` (string), `namespace` (optional, defaults to `public`), `password` (optional), `ttlDays` (optional, 1--30, default 15), `tags` (optional `string[]`).

Example prompt:

> "Store the API key under the label 'staging-token' so I can reuse it next session."

```
publish_kv(key="staging-token", value="abc123")
```

---

### `set_kv`

Set or replace the value at an existing `(namespace, id, key)` slot. Requires the original `ownerToken`.

Parameters: `namespace` (string), `id` (string), `key` (string), `value` (string), `ownerToken` (string).

Example prompt:

> "Update the staging-token value to the new secret."

```
set_kv(namespace="public", id="aBcDeFgHiJ", key="staging-token", value="def456", ownerToken="tok_...")
```

---

### `get_kv`

Fetch the value stored at `(namespace, id, key)`.

Parameters: `namespace` (string), `id` (string), `key` (string), `password` (optional, sent as `X-Password` if set).

Example prompt:

> "What did I store under staging-token?"

```
get_kv(namespace="public", id="aBcDeFgHiJ", key="staging-token")
```

---

### Discovery

### `search_gallery`

Browse the public gallery of BrewPage pages, or list resources you own. Returns a paged result with metadata (id, title, view count, created date). All parameters are optional; with no parameters this returns the most recent public pages.

Parameters: `q` (optional search query), `page` (optional, 0-indexed), `size` (optional page size), `sort` (optional `date` | `views`), `mine` (optional boolean -- list only resources owned by `ownerToken`), `ownerToken` (required only when `mine=true`).

Example prompt:

> "What did I publish last week?"

```
search_gallery(mine=true, ownerToken="tok_...", sort="date")
```

---

### Management

### `delete_resource`

Delete a BrewPage resource (HTML page, KV store, JSON collection, or file) using the owner token received at creation.

Parameters: `type` (`html` | `kv` | `json` | `file`), `namespace` (string), `id` (string), `ownerToken` (string).

Example prompt:

> "Delete the page I just published -- namespace public, id aBcDeFgHiJ."

```
delete_resource(type="html", namespace="public", id="aBcDeFgHiJ", ownerToken="tok_...")
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
| "Fix a typo in the page I shared -- same link" | `update_html` | Requires `ownerToken`; URL stays the same |
| "Remove the page I published" | `delete_resource` | Requires `ownerToken` from creation |
| "Read back the page I published" | `get_page` | Returns raw content for editing |
| "How many pages are on BrewPage?" | `get_stats` | Returns platform totals |
| "Store JSON state between turns" | `publish_json` | Returns short URL + owner token |
| "Read that JSON document back" | `get_json` | By `namespace` + `id` |
| "Update the JSON I stored" | `update_json` | Requires `ownerToken`; preserves URL |
| "Save a value under a label / key" | `publish_kv` | Create a new KV slot |
| "Change the KV value I stored" | `set_kv` | Requires `ownerToken` |
| "What did I store under that key?" | `get_kv` | By `namespace` + `id` + `key` |
| "List my published pages" / "What did I publish?" | `search_gallery` | Set `mine=true` + `ownerToken` |
| "Browse the public BrewPage gallery" | `search_gallery` | Optional `q`, `sort=date\|views` |

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

## 1.5.0 -- 2026-05-21

- Add 8 new MCP tools: `update_html`, `publish_json`, `get_json`, `update_json`, `publish_kv`, `set_kv`, `get_kv`, `search_gallery`.
- Tool count: 6 -> 14. Full coverage of HTML update, JSON CRUD, KV CRUD, and gallery discovery (incl. owner-scoped listing via `mine=true`).
- Update operations (`update_html`, `update_json`, `set_kv`) require the original `ownerToken`; `password` (when set) is forwarded as `X-Password`.

## 1.4.0 -- 2026-05-12

- Sync to spec 1.31.0 -- adds raw `text/*` and `application/octet-stream` variants on `POST /api/html`; PUT mirror; 422 with `supportedTypes`.

## License

[MIT](LICENSE)
